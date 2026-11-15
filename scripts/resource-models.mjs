import { access, readFile, writeFile, rename, mkdtemp, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createClipEmbedder, embeddingSourceText, meanVectors } from './embed-library.mjs';
import { createTextEmbedder } from './embed-text.mjs';
import { parseSemanticIndex, vectorFor, cosineSimilarity, embeddingInput, embeddingInputHash, textEmbeddingInputHash, validateSemanticIndex } from '../shared/semantic.mjs';
import { resourceFolderPath } from '../shared/resource-routing.mjs';
import { normalizeTags } from '../shared/taxonomy.mjs';

let clip, textModel;
const indexes = new Map();
const runtimeBase = process.env.CHARTA_MODEL_DIR || [path.join(os.tmpdir(), 'jelly-embeddings-runtime'), '/tmp/jelly-embeddings-runtime'].find(directory => existsSync(directory)) || path.join(os.tmpdir(), 'jelly-embeddings-runtime');
const settings = () => ({ runtime: process.env.CHARTA_MODEL_RUNTIME || path.join(runtimeBase, 'node_modules/@huggingface/transformers/dist/transformers.node.mjs'), clipDir: process.env.CHARTA_CLIP_MODEL || path.join(runtimeBase, 'model'), textDir: process.env.CHARTA_TEXT_MODEL || path.join(runtimeBase, 'text-model') });
export async function embedSearchQuery(query) {
  const config = settings();
  textModel ||= createTextEmbedder({ runtime: config.runtime, modelDir: config.textDir });
  try { return (await (await textModel).text(query)).vector; }
  catch (error) { textModel = null; throw error; }
}
export async function disposeResourceModels() {
  await Promise.allSettled([clip, textModel].filter(Boolean).map(async pending => (await pending).dispose()));
  clip = null; textModel = null; indexes.clear();
}

async function index(root) {
  if (!indexes.has(root)) indexes.set(root, (async () => {
    const base = path.join(root, 'content/embeddings');
    const [manifest, vectors, textBuffer] = await Promise.all([readFile(path.join(base, 'index.json'), 'utf8'), readFile(path.join(base, 'vectors.bin')), readFile(path.join(base, 'text-vectors.bin'))]);
    return parseSemanticIndex(JSON.parse(manifest), vectors, { textBuffer });
  })());
  return indexes.get(root);
}

/** Append one saved resource without recomputing the owner's existing vectors. */
export async function indexImportedResource(root, block, total) {
  const config = settings();
  await Promise.all([access(config.runtime), access(path.join(config.clipDir, 'config.json')), access(path.join(config.textDir, 'config.json'))]);
  const base = path.join(root, 'content/embeddings');
  const manifest = JSON.parse(await readFile(path.join(base, 'index.json'), 'utf8'));
  const inputHash = await embeddingInputHash(block);
  if (manifest.entries.some(entry => entry.id === block.id && entry.inputHash === inputHash)) return;
  if (manifest.entries.some(entry => entry.id === block.id)) throw new Error('The existing resource embedding needs rebuilding.');
  const input = embeddingInput(block), source = await embeddingSourceText(root, block);
  clip ||= createClipEmbedder({ runtime: config.runtime, modelDir: config.clipDir });
  textModel ||= createTextEmbedder({ runtime: config.runtime, modelDir: config.textDir });
  const clipper = await clip, reader = await textModel;
  const [clipText, text] = await Promise.all([clipper.text(source.text), reader.text(source.text)]);
  const imagePath = input.image ? path.posix.join(path.posix.dirname(block.path), input.image.path) : null;
  const imageSha256 = imagePath ? createHash('sha256').update(await readFile(path.join(root, imagePath))).digest('hex') : null;
  if (input.image && input.image.sha256 !== imageSha256) throw new Error('The uploaded preview changed before indexing.');
  const vector = imagePath ? meanVectors([await clipper.image(path.join(root, imagePath)), clipText.vector], [input.weights.image, input.weights.text]) : clipText.vector;
  const [oldVisual, oldText] = await Promise.all([readFile(path.join(base, 'vectors.bin')), readFile(path.join(base, 'text-vectors.bin'))]);
  const serialize = values => { const bytes = Buffer.alloc(values.length * 4); for (let i = 0; i < values.length; i++) bytes.writeFloatLE(values[i], i * 4); return bytes; };
  const visual = Buffer.concat([oldVisual, serialize(vector)]), reading = Buffer.concat([oldText, serialize(text.vector)]);
  manifest.entries.push({ id: block.id, row: manifest.entries.length, inputHash, type: block.type, method: imagePath ? 'clip-preview-text' : 'clip-text', source: { textFields: source.textFields, textChunks: clipText.chunks, textCharacters: source.text.length, extractedText: source.extractedText, imagePath, imageSha256, weights: input.weights }, textSource: { inputHash: await textEmbeddingInputHash(block), textChunks: text.chunks, textCharacters: source.text.length, textFields: source.textFields, extractedText: source.extractedText, method: 'minilm-mean-pooled-text' } });
  const date = new Date().toISOString();
  manifest.generatedAt = date;
  manifest.coverage = { expected: total, indexed: manifest.entries.length, complete: manifest.entries.length === total };
  manifest.vectors.bytes = visual.length; manifest.vectors.sha256 = createHash('sha256').update(visual).digest('hex');
  manifest.textIndex.generatedAt = date; manifest.textIndex.coverage = manifest.coverage;
  manifest.textIndex.vectors.bytes = reading.length; manifest.textIndex.vectors.sha256 = createHash('sha256').update(reading).digest('hex');
  const files = [['vectors.bin', visual], ['text-vectors.bin', reading], ['index.json', JSON.stringify(manifest, null, 2) + '\n']];
  const backups = files.map(([file], index) => [file, [oldVisual, oldText, null][index]]);
  backups[2][1] = await readFile(path.join(base, 'index.json'));
  try {
    for (const [file, bytes] of files) {
      const temporary = path.join(base, `.${file}.${randomUUID()}.tmp`);
      try { await writeFile(temporary, bytes); await rename(temporary, path.join(base, file)); }
      finally { await rm(temporary, { force: true }); }
    }
  } catch (error) { for (const [file, bytes] of backups) await writeFile(path.join(base, file), bytes); throw error; }
  indexes.delete(root);
}

/** Reuse the library's local CLIP and MiniLM models. No source data leaves this process. */
export async function semanticResourceDestination({ resource, image, catalog, root }) {
  const config = settings();
  const saved = await index(root);
  await validateSemanticIndex(saved, catalog.blocks);
  await access(config.runtime);
  let vector, space;
  if (image) {
    await access(path.join(config.clipDir, 'config.json'));
    clip ||= createClipEmbedder({ runtime: config.runtime, modelDir: config.clipDir });
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'charta-resource-image-'));
    try {
      const file = path.join(temporary, path.basename(image.asset.path));
      await writeFile(file, image.bytes);
      vector = await (await clip).image(file); space = 'multimodal';
    } finally { await rm(temporary, { recursive: true, force: true }); }
  } else {
    await access(path.join(config.textDir, 'config.json'));
    textModel ||= createTextEmbedder({ runtime: config.runtime, modelDir: config.textDir });
    vector = (await (await textModel).text([resource.title, resource.description, resource.body].filter(Boolean).join('\n').slice(0, 16000))).vector;
    space = 'text';
  }
  const scores = new Map();
  for (const block of catalog.blocks) {
    if (image ? block.type !== 'image' : !['link', 'text', 'file'].includes(block.type)) continue;
    if (!(space === 'text' ? saved.validTextIds : saved.validIds)?.has(block.id)) continue;
    const candidate = vectorFor(saved, block.id, space);
    if (candidate) scores.set(block.id, cosineSimilarity(vector, candidate));
  }
  const ranked = catalog.collections.filter(collection => collection.source?.arena?.importScope !== 'reference' && !collection.source?.external).map(collection => {
    const best = collection.items.filter(item => item.kind === 'block' && scores.has(item.id)).map(item => scores.get(item.id)).sort((a, b) => b - a).slice(0, 3);
    return { collection, score: best.length ? best.reduce((sum, value) => sum + value, 0) / best.length : 0 };
  }).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < (image ? .55 : .42) || best.score - (ranked[1]?.score || 0) < .015) return null;
  const destinationPath = resourceFolderPath(catalog, best.collection.id);
  return { path: destinationPath, category: destinationPath[0], tags: normalizeTags([resource.type, ...destinationPath.map(part => part.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-'))]).slice(0, 8), confidence: Math.min(.9, best.score), method: image ? 'local-clip-v1' : 'local-minilm-v1', reason: image ? 'The image resembles visual resources already saved in this folder.' : 'The text is semantically similar to resources already saved in this folder.' };
}
