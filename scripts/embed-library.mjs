import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadLibrary } from './library.mjs';
import {
  CLIP_MODEL, SEMANTIC_VERSION, embeddingInput, embeddingInputHash, embeddingText, embeddingTextFields,
  normalizeVector, parseSemanticIndex, validateSemanticIndex,
} from '../shared/semantic.mjs';

export const MODEL_FILES = Object.freeze({
  'config.json': '493ef57ff783e42d1530c91b53469b7fdf8db8a9c1408e86998fcb7899a4f495',
  'preprocessor_config.json': '6f638fb9401a6d6296feff533ee7efe657b787c49f954f82f5906b36ef2a1b1f',
  'tokenizer.json': 'f7f3b7af117d467b58374797691a6438d3e6b9e9cef800dfd5dced7f697a90cd',
  'tokenizer_config.json': '60ba2912bc6344c94bc16bbdec27fa1209409167b6f2fdf3cfe9e65462ea3967',
  'special_tokens_map.json': 'c4864a9376a8401918425bed71fc14fc0e81f9b59ec45c1cf96cccb2df508eac',
  'onnx/text_model_quantized.onnx': '73baab855d406190da9faa498cfedf65f15cf309f4cc7385b7b032e6d08e5c3a',
  'onnx/vision_model_quantized.onnx': '583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299',
});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function json(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function atomic(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, file);
}

/** The network is used only by this explicit preparation step, never inference. */
export async function prepareModel(directory, { download = false, log = console.log } = {}) {
  for (const [file, expected] of Object.entries(MODEL_FILES)) {
    const target = path.join(directory, file);
    let bytes;
    try { bytes = await readFile(target); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!download) throw new Error(`Missing ${target}. Run with --download-model once to fetch the pinned public model.`);
      const url = `https://huggingface.co/${CLIP_MODEL.id}/resolve/${CLIP_MODEL.revision}/${file}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Model download failed (${response.status}): ${file}`);
      bytes = Buffer.from(await response.arrayBuffer());
      if (sha256(bytes) !== expected) throw new Error(`Model integrity check failed: ${file}`);
      await atomic(target, bytes);
      log(`Prepared ${file} (${(bytes.length / 1024 / 1024).toFixed(1)} MiB)`);
    }
    if (sha256(bytes) !== expected) throw new Error(`Model integrity check failed: ${file}`);
  }
}

export function tokenChunks(tokens, size = 75) {
  if (!Number.isInteger(size) || size < 1 || size > 75) throw new Error('CLIP chunks must contain 1–75 content tokens.');
  const chunks = [];
  for (let i = 0; i < tokens.length; i += size) chunks.push(tokens.slice(i, i + size));
  return chunks.length ? chunks : [[]];
}

export function meanVectors(vectors, weights = vectors.map(() => 1)) {
  if (!vectors.length || vectors.length !== weights.length) throw new Error('Vectors and weights must match.');
  const dimensions = vectors[0].length, mean = new Float32Array(dimensions);
  for (let i = 0; i < vectors.length; i++) {
    if (vectors[i].length !== dimensions || !Number.isFinite(weights[i]) || weights[i] < 0) throw new Error('Invalid vector pooling input.');
    const vector = normalizeVector(vectors[i]);
    for (let d = 0; d < dimensions; d++) mean[d] += vector[d] * weights[i];
  }
  return normalizeVector(mean);
}

export async function embeddingSourceText(root, block) {
  if (!block.artifact?.textPath) return { text: embeddingText(block), textFields: embeddingTextFields(block).map(entry => entry.field), extractedText: null };
  const relative = block.artifact.textPath;
  if (typeof relative !== 'string' || !relative || relative.startsWith('/') || relative.includes('\\') || /[\u0000-\u001f%?#]/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..') || !/\.(?:txt|md)$/i.test(relative)) throw new Error(`${block.id}: unsafe extracted text path.`);
  const file = path.posix.join(path.posix.dirname(block.path), relative);
  const bytes = await readFile(path.join(root, file)), actual = sha256(bytes);
  if (!block.artifact.textSha256 || actual !== block.artifact.textSha256) throw new Error(`${block.id}: extracted text SHA-256 does not match canonical metadata.`);
  const fullText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const expanded = { ...block, artifact: { ...block.artifact, text: fullText } };
  return {
    text: embeddingText(expanded),
    textFields: embeddingTextFields(expanded).map(entry => entry.field === 'artifact.text' ? 'artifact.textPath' : entry.field),
    extractedText: { path: file, sha256: actual, characters: fullText.length, complete: true },
  };
}

export async function createClipEmbedder({ runtime, modelDir }) {
  const module = runtime ? await import(pathToFileURL(path.resolve(runtime)).href) : await import('@huggingface/transformers');
  const { AutoTokenizer, AutoProcessor, CLIPTextModelWithProjection, CLIPVisionModelWithProjection, RawImage, Tensor, env } = module;
  if (env.version !== '3.8.1') throw new Error(`Expected @huggingface/transformers@3.8.1, received ${env.version || 'an unversioned runtime'}.`);
  env.allowRemoteModels = false;
  const [tokenizer, processor, textModel, visionModel] = await Promise.all([
    AutoTokenizer.from_pretrained(modelDir), AutoProcessor.from_pretrained(modelDir),
    CLIPTextModelWithProjection.from_pretrained(modelDir, { dtype: 'q8', device: 'cpu' }),
    CLIPVisionModelWithProjection.from_pretrained(modelDir, { dtype: 'q8', device: 'cpu' }),
  ]);
  return {
    async text(text) {
      const chunks = tokenChunks(tokenizer.encode(text, { add_special_tokens: false }));
      const vectors = [];
      for (let start = 0; start < chunks.length; start += 8) {
        const batch = chunks.slice(start, start + 8), length = Math.max(...batch.map(chunk => chunk.length)) + 2;
        const ids = new BigInt64Array(batch.length * length), mask = new BigInt64Array(ids.length);
        for (let i = 0; i < batch.length; i++) {
          const values = [tokenizer.bos_token_id, ...batch[i], tokenizer.eos_token_id];
          for (let j = 0; j < length; j++) {
            ids[i * length + j] = BigInt(values[j] ?? tokenizer.eos_token_id);
            mask[i * length + j] = j < values.length ? 1n : 0n;
          }
        }
        const result = await textModel({ input_ids: new Tensor('int64', ids, [batch.length, length]), attention_mask: new Tensor('int64', mask, [batch.length, length]) });
        for (let i = 0; i < batch.length; i++) vectors.push(result.text_embeds.data.slice(i * 512, (i + 1) * 512));
      }
      return { vector: meanVectors(vectors, chunks.map(chunk => Math.max(1, chunk.length))), chunks: chunks.length };
    },
    async image(file) {
      const image = await RawImage.read(file);
      const output = await visionModel(await processor(image));
      return normalizeVector(output.image_embeds.data);
    },
    async dispose() { await textModel.dispose(); await visionModel.dispose(); },
  };
}

export async function checkEmbeddings(root, out = path.join(root, 'content/embeddings')) {
  const catalog = await loadLibrary(root), manifest = await json(path.join(out, 'index.json'));
  if (!manifest) throw new Error('No semantic index has been generated.');
  if (!manifest.textIndex) throw new Error('The MiniLM text index is missing. Regenerate both semantic indexes.');
  const bytes = await readFile(path.join(out, 'vectors.bin'));
  if (sha256(bytes) !== manifest.vectors.sha256) throw new Error('Semantic vector integrity check failed.');
  const textBuffer = manifest.textIndex ? await readFile(path.join(out, 'text-vectors.bin')) : undefined;
  if (textBuffer && sha256(textBuffer) !== manifest.textIndex.vectors.sha256) throw new Error('Text semantic vector integrity check failed.');
  const index = parseSemanticIndex(manifest, bytes, { textBuffer });
  const status = await validateSemanticIndex(index, catalog.blocks);
  if (status.state !== 'ready' || status.orphanIds.length) throw new Error(`Semantic index needs regeneration: ${status.valid}/${status.total} valid, ${status.missingIds.length} missing, ${status.staleIds.length} stale, ${status.orphanIds.length} orphaned.`);
  for (const block of catalog.blocks) {
    await embeddingSourceText(root, block);
    const image = embeddingInput(block).image;
    if (image && sha256(await readFile(path.join(root, path.posix.dirname(block.path), image.path))) !== image.sha256) throw new Error(`${block.id}: source image integrity check failed.`);
  }
  return status;
}

export async function embedLibrary({ root, out, modelDir, runtime, cacheDir, limit = Infinity, log = console.log }) {
  root = path.resolve(root); out ||= path.join(root, 'content/embeddings');
  cacheDir ||= path.join(os.tmpdir(), 'jelly-clip-embedding-cache');
  await prepareModel(modelDir);
  const catalog = await loadLibrary(root), blocks = [...catalog.blocks].sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit);
  const embedder = await createClipEmbedder({ runtime, modelDir });
  const entries = [], vectors = [];
  try {
    for (const block of blocks) {
      const input = embeddingInput(block), inputHash = await embeddingInputHash(block);
      const sourceText = await embeddingSourceText(root, block);
      const cacheFile = path.join(cacheDir, `${inputHash}.json`);
      let cached = await json(cacheFile);
      if (cached?.inputHash !== inputHash || !Array.isArray(cached?.vector) || cached.vector.length !== CLIP_MODEL.dimensions ||
          !Number.isInteger(cached?.textChunks) || cached.textChunks < 1 ||
          cached.vector.some(value => !Number.isFinite(value)) || Math.abs(Math.hypot(...cached.vector) - 1) > 0.002) cached = null;
      let imagePath = null, imageSha256 = null;
      if (input.image) {
        imagePath = path.posix.join(path.posix.dirname(block.path), input.image.path);
        imageSha256 = sha256(await readFile(path.join(root, imagePath)));
        if (!input.image.sha256 || imageSha256 !== input.image.sha256) throw new Error(`${block.id}: image SHA-256 does not match canonical metadata.`);
      }
      let vector, chunks;
      if (cached) { vector = Float32Array.from(cached.vector); chunks = cached.textChunks; }
      else {
        const text = await embedder.text(sourceText.text);
        chunks = text.chunks;
        vector = input.image ? meanVectors([await embedder.image(path.join(root, imagePath)), text.vector], [input.weights.image, input.weights.text]) : text.vector;
        await atomic(cacheFile, JSON.stringify({ inputHash, textChunks: chunks, vector: Array.from(vector) }));
      }
      entries.push({
        id: block.id, row: entries.length, inputHash,
        method: input.image ? block.type === 'image' ? 'clip-image-text' : 'clip-preview-text' : 'clip-text',
        source: {
          textFields: sourceText.textFields,
          textChunks: chunks, textCharacters: sourceText.text.length, extractedText: sourceText.extractedText, imagePath, imageSha256,
          weights: input.weights,
          ...(block.type === 'video' ? { limitation: 'Representative still and saved text; no motion or audio analysis.' } : {}),
          ...(block.type === 'audio' ? { limitation: 'Saved text and cover image when present; no audio analysis.' } : {}),
          ...(block.type === 'file' ? { limitation: 'Saved extracted text and representative preview when present.' } : {}),
        },
      });
      vectors.push(vector);
      if (entries.length % 25 === 0 || entries.length === blocks.length) log(`Embedded ${entries.length}/${blocks.length}${cached ? ' (cached)' : ''}`);
    }
  } finally { await embedder.dispose(); }
  // Detect concurrent edits before publishing a new index: stale vectors are never silently current.
  const current = await loadLibrary(root), currentById = new Map(current.blocks.map(block => [block.id, block]));
  for (const entry of entries) if (!currentById.has(entry.id) || entry.inputHash !== await embeddingInputHash(currentById.get(entry.id))) throw new Error(`Content changed during embedding: ${entry.id}. Rerun to reuse completed work.`);
  if (limit === Infinity && current.blocks.length !== entries.length) throw new Error('Materials changed during embedding. Rerun to include the new items.');
  const bytes = Buffer.alloc(vectors.length * CLIP_MODEL.dimensions * 4);
  for (let row = 0; row < vectors.length; row++) for (let d = 0; d < CLIP_MODEL.dimensions; d++) bytes.writeFloatLE(vectors[row][d], (row * CLIP_MODEL.dimensions + d) * 4);
  const manifest = {
    schemaVersion: 1, inputVersion: SEMANTIC_VERSION, generatedAt: new Date().toISOString(),
    model: { ...CLIP_MODEL, architecture: 'CLIP ViT-B/32', runtime: '@huggingface/transformers@3.8.1', files: MODEL_FILES },
    coverage: { expected: catalog.blocks.length, indexed: entries.length, complete: entries.length === catalog.blocks.length },
    pooling: 'L2-normalized projected CLIP chunks, weighted by token count; fused normalized image/text vectors use per-entry weights (0.75/0.25 for visual media; 0.25/0.75 for text documents).',
    relationType: 'inferred-semantic-similarity',
    vectors: { path: 'vectors.bin', encoding: 'float32-le', dimensions: CLIP_MODEL.dimensions, bytes: bytes.length, sha256: sha256(bytes) },
    entries,
  };
  // The manifest is the commit marker; readers verify the binary digest if interrupted between writes.
  await atomic(path.join(out, 'vectors.bin'), bytes);
  await atomic(path.join(out, 'index.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function main() {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (['--download-model', '--prepare', '--check', '--clip-only'].includes(key)) options[key.slice(2)] = true;
    else if (['--root', '--out', '--model-dir', '--text-model-dir', '--runtime', '--cache-dir', '--limit'].includes(key)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${key}`);
      options[key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = args[++i];
    } else throw new Error(`Unknown argument: ${key}`);
  }
  options.root = path.resolve(options.root || fileURLToPath(new URL('../', import.meta.url)));
  options.modelDir = path.resolve(options.modelDir || path.join(os.tmpdir(), 'jelly-clip-model'));
  options.textModelDir = path.resolve(options.textModelDir || path.join(os.tmpdir(), 'jelly-minilm-model'));
  if (options.limit !== undefined) {
    options.limit = Number(options.limit);
    if (!Number.isInteger(options.limit) || options.limit <= 0) throw new Error('--limit must be a positive integer.');
  }
  if (options.check) { const status = await checkEmbeddings(options.root, options.out); console.log(`Semantic index verified: ${status.valid}/${status.total} current embeddings.`); return; }
  const { prepareTextModel, embedTextLibrary } = await import('./embed-text.mjs');
  const includeText = !options['clip-only'] && options.limit === undefined;
  if (options['download-model'] || options.prepare) {
    await prepareModel(options.modelDir, { download: !!options['download-model'] });
    if (includeText) await prepareTextModel(options.textModelDir, { download: !!options['download-model'] });
  }
  if (options.prepare) return;
  if (includeText) await prepareTextModel(options.textModelDir);
  const manifest = await embedLibrary(options);
  if (includeText) await embedTextLibrary({ ...options, modelDir: options.textModelDir, cacheDir: undefined });
  console.log(`Generated ${manifest.coverage.indexed} genuine 512-dimensional CLIP embeddings → ${options.out || 'content/embeddings/'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
