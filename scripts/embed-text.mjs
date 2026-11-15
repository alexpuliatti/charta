import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadLibrary } from './library.mjs';
import { embeddingSourceText, meanVectors } from './embed-library.mjs';
import { TEXT_MODEL, TEXT_SEMANTIC_VERSION, textEmbeddingInputHash, embeddingInputHash, normalizeVector } from '../shared/semantic.mjs';

export const TEXT_MODEL_FILES = Object.freeze({
  'config.json': '7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7',
  'tokenizer.json': 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0',
  'tokenizer_config.json': '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3',
  'special_tokens_map.json': 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3',
  'onnx/model_quantized.onnx': 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1',
});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function atomic(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes); await rename(temporary, file);
}

export async function prepareTextModel(directory, { download = false, log = console.log } = {}) {
  for (const [file, expected] of Object.entries(TEXT_MODEL_FILES)) {
    const target = path.join(directory, file);
    let bytes;
    try { bytes = await readFile(target); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!download) throw new Error(`Missing ${target}. Prepare the text model with --download-model --prepare.`);
      const response = await fetch(`https://huggingface.co/${TEXT_MODEL.id}/resolve/${TEXT_MODEL.revision}/${file}`);
      if (!response.ok) throw new Error(`Text model download failed (${response.status}): ${file}`);
      bytes = Buffer.from(await response.arrayBuffer());
      if (sha256(bytes) !== expected) throw new Error(`Text model integrity check failed: ${file}`);
      await atomic(target, bytes); log(`Prepared MiniLM ${file}`);
    }
    if (sha256(bytes) !== expected) throw new Error(`Text model integrity check failed: ${file}`);
  }
}

export function sentenceTokenChunks(tokens) {
  const chunks = [];
  for (let i = 0; i < tokens.length; i += 254) chunks.push(tokens.slice(i, i + 254));
  return chunks.length ? chunks : [[]];
}

export async function createTextEmbedder({ runtime, modelDir }) {
  const module = runtime ? await import(pathToFileURL(path.resolve(runtime)).href) : await import('@huggingface/transformers');
  const { AutoTokenizer, AutoModel, Tensor, env } = module;
  if (env.version !== '3.8.1') throw new Error('Text inference requires @huggingface/transformers@3.8.1.');
  env.allowRemoteModels = false;
  const [tokenizer, model] = await Promise.all([
    AutoTokenizer.from_pretrained(modelDir), AutoModel.from_pretrained(modelDir, { dtype: 'q8', device: 'cpu' }),
  ]);
  const special = tokenizer.encode(''), startToken = special[0], endToken = special.at(-1);
  return {
    async text(text) {
      const chunks = sentenceTokenChunks(tokenizer.encode(text, { add_special_tokens: false }));
      const vectors = [];
      for (let offset = 0; offset < chunks.length; offset += 8) {
        const batch = chunks.slice(offset, offset + 8), length = Math.max(...batch.map(chunk => chunk.length)) + 2;
        const ids = new BigInt64Array(batch.length * length), mask = new BigInt64Array(ids.length);
        for (let i = 0; i < batch.length; i++) {
          const tokens = [startToken, ...batch[i], endToken];
          for (let j = 0; j < tokens.length; j++) { ids[i * length + j] = BigInt(tokens[j]); mask[i * length + j] = 1n; }
        }
        const shape = [batch.length, length];
        const output = await model({ input_ids: new Tensor('int64', ids, shape), attention_mask: new Tensor('int64', mask, shape), token_type_ids: new Tensor('int64', new BigInt64Array(ids.length), shape) });
        const hidden = output.last_hidden_state;
        if (hidden.dims[2] !== TEXT_MODEL.dimensions) throw new Error('Unexpected MiniLM output dimensions.');
        for (let i = 0; i < batch.length; i++) {
          const mean = new Float32Array(TEXT_MODEL.dimensions), valid = batch[i].length + 2;
          for (let t = 0; t < valid; t++) for (let d = 0; d < mean.length; d++) mean[d] += hidden.data[(i * length + t) * mean.length + d] / valid;
          vectors.push(normalizeVector(mean));
        }
      }
      return { vector: meanVectors(vectors, chunks.map(chunk => Math.max(1, chunk.length))), chunks: chunks.length };
    },
    async dispose() { await model.dispose(); },
  };
}

export async function embedTextLibrary({ root, out, modelDir, runtime, cacheDir, log = console.log }) {
  root = path.resolve(root); out ||= path.join(root, 'content/embeddings');
  cacheDir ||= path.join(os.tmpdir(), 'jelly-minilm-embedding-cache');
  await prepareTextModel(modelDir);
  const catalog = await loadLibrary(root), manifest = JSON.parse(await readFile(path.join(out, 'index.json'), 'utf8'));
  const byId = new Map(catalog.blocks.map(block => [block.id, block]));
  if (manifest.entries.length !== catalog.blocks.length || manifest.entries.some(entry => !byId.has(entry.id))) throw new Error('Generate complete CLIP coverage before adding text embeddings.');
  const embedder = await createTextEmbedder({ runtime, modelDir }), vectors = [], hashes = new Map();
  try {
    for (const entry of manifest.entries) {
      const block = byId.get(entry.id);
      if (entry.inputHash !== await embeddingInputHash(block)) throw new Error(`${entry.id}: regenerate stale CLIP inputs before text embedding.`);
      const inputHash = await textEmbeddingInputHash(block), source = await embeddingSourceText(root, block);
      hashes.set(block.id, inputHash);
      const cacheFile = path.join(cacheDir, `${inputHash}.json`);
      let cached;
      try { cached = JSON.parse(await readFile(cacheFile, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      if (cached?.inputHash !== inputHash || !Array.isArray(cached.vector) || cached.vector.length !== TEXT_MODEL.dimensions || !Number.isInteger(cached.textChunks) || cached.textChunks < 1 || cached.vector.some(value => !Number.isFinite(value)) || Math.abs(Math.hypot(...cached.vector) - 1) > 0.002) cached = null;
      let vector, chunks;
      if (cached) { vector = Float32Array.from(cached.vector); chunks = cached.textChunks; }
      else {
        const result = await embedder.text(source.text); vector = result.vector; chunks = result.chunks;
        await atomic(cacheFile, JSON.stringify({ inputHash, textChunks: chunks, vector: Array.from(vector) }));
      }
      vectors.push(vector); entry.type = block.type;
      entry.textSource = { inputHash, textChunks: chunks, textCharacters: source.text.length, textFields: source.textFields, extractedText: source.extractedText, method: 'minilm-mean-pooled-text' };
      if (vectors.length % 50 === 0 || vectors.length === manifest.entries.length) log(`Text embedded ${vectors.length}/${manifest.entries.length}${cached ? ' (cached)' : ''}`);
    }
  } finally { await embedder.dispose(); }
  const current = await loadLibrary(root);
  if (current.blocks.length !== manifest.entries.length) throw new Error('Materials changed during text embedding. Rerun to reuse completed work.');
  for (const block of current.blocks) if (hashes.get(block.id) !== await textEmbeddingInputHash(block)) throw new Error(`Text changed during embedding: ${block.id}. Rerun to reuse completed work.`);
  const bytes = Buffer.alloc(vectors.length * TEXT_MODEL.dimensions * 4);
  for (let row = 0; row < vectors.length; row++) for (let d = 0; d < TEXT_MODEL.dimensions; d++) bytes.writeFloatLE(vectors[row][d], (row * TEXT_MODEL.dimensions + d) * 4);
  manifest.textIndex = {
    inputVersion: TEXT_SEMANTIC_VERSION, generatedAt: new Date().toISOString(),
    model: { ...TEXT_MODEL, runtime: '@huggingface/transformers@3.8.1', files: TEXT_MODEL_FILES },
    vectors: { path: 'text-vectors.bin', encoding: 'float32-le', dimensions: TEXT_MODEL.dimensions, bytes: bytes.length, sha256: sha256(bytes) },
    coverage: { expected: catalog.blocks.length, indexed: vectors.length, complete: true },
    pooling: 'Attention-mask mean pooling over 254-token content chunks plus CLS/SEP, then token-count-weighted pooling of normalized chunk vectors and final L2 normalization.',
    candidateTypes: ['link', 'text', 'file'],
    ranking: 'Reading/document anchors use only MiniLM cosine among reading/document candidates. Visual/media anchors retain CLIP cosine across all materials. Scores from different spaces are never mixed.',
  };
  await atomic(path.join(out, 'text-vectors.bin'), bytes);
  await atomic(path.join(out, 'index.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function main() {
  const options = {}, args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (['--download-model', '--prepare'].includes(key)) options[key.slice(2)] = true;
    else if (['--root', '--out', '--runtime', '--model-dir', '--cache-dir'].includes(key) && args[i + 1] && !args[i + 1].startsWith('--')) options[key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = args[++i];
    else throw new Error(`Unknown or incomplete argument: ${key}`);
  }
  options.root = path.resolve(options.root || fileURLToPath(new URL('../', import.meta.url)));
  options.modelDir = path.resolve(options.modelDir || path.join(os.tmpdir(), 'jelly-minilm-model'));
  if (options['download-model'] || options.prepare) await prepareTextModel(options.modelDir, { download: !!options['download-model'] });
  if (!options.prepare) { const result = await embedTextLibrary(options); console.log(`Generated ${result.textIndex.coverage.indexed} genuine MiniLM text embeddings.`); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
