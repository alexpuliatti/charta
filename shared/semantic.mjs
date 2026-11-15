import { stripFrontmatter } from './clip-markdown.mjs';

// CLIP's learned image/text space is independent from the authored text network.
export const SEMANTIC_VERSION = 'clip-multimodal-v1';
export const CLIP_MODEL = Object.freeze({
  id: 'Xenova/clip-vit-base-patch32',
  revision: '6b7c523703ae26e39be4b03774966f8571c7f523',
  dimensions: 512,
  dtype: 'q8',
  license: 'MIT',
});
export const TEXT_MODEL = Object.freeze({
  id: 'Xenova/all-MiniLM-L6-v2',
  revision: '751bff37182d3f1213fa05d7196b954e230abad9',
  dimensions: 384,
  dtype: 'q8',
  license: 'Apache-2.0',
});
export const TEXT_SEMANTIC_VERSION = 'minilm-text-v1';

const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
export function embeddingTextFields(block) {
  const candidates = [
    ['title', block.title],
    ['description', block.description],
    ['body', stripFrontmatter(typeof block.body === 'string' ? block.body : '')],
    ['artifact.text', block.artifact?.text],
    ['artifact.description', block.artifact?.description],
    ['artifact.ocrText', block.artifact?.ocrText],
    ['ocr.text', block.ocr?.text],
    ['visualAnalysis.text', block.visualAnalysis?.text],
    ['summary.text', block.summary?.status === 'ready' ? block.summary.text : ''],
    ['taxonomy', [block.category, ...(block.tags || [])].filter(Boolean).join(', ')],
  ];
  const seen = new Set();
  return candidates.map(([field, text]) => ({ field, text: clean(text) })).filter(entry => {
    if (!entry.text || seen.has(entry.text)) return false;
    seen.add(entry.text); return true;
  });
}

/** Only saved, inspectable text is used; URLs are never fetched by this module. */
export function embeddingText(block) {
  return embeddingTextFields(block).map(entry => entry.text).join('\n\n');
}

/** Articles use their saved text, rather than an unrelated website preview image. */
export function embeddingImage(block) {
  if (['link', 'text'].includes(block.type)) return null;
  const images = (block.assets || []).filter(asset => /^image\//.test(asset.mimeType || ''));
  return images.find(asset => asset.role === 'optimized') || images.find(asset => asset.role === 'thumbnail') || images[0] || null;
}

export function embeddingInput(block) {
  const image = embeddingImage(block);
  const textDocument = block.type === 'file' && (block.artifact?.textPath || clean(block.body).length > 200);
  return {
    version: SEMANTIC_VERSION,
    model: `${CLIP_MODEL.id}@${CLIP_MODEL.revision}`,
    id: block.id,
    type: block.type,
    text: embeddingText(block),
    textSource: block.artifact?.textPath ? {
      path: block.artifact.textPath,
      sha256: block.artifact.textSha256 || null,
      characters: block.artifact.textCharacters ?? null,
    } : null,
    image: image ? { path: image.path, sha256: image.sha256 || null } : null,
    weights: image ? textDocument ? { image: 0.25, text: 0.75 } : { image: 0.75, text: 0.25 } : { text: 1 },
  };
}

export async function embeddingInputHash(block) {
  const bytes = new TextEncoder().encode(JSON.stringify(embeddingInput(block)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function textEmbeddingInputHash(block) {
  const input = embeddingInput(block);
  const bytes = new TextEncoder().encode(JSON.stringify({
    version: TEXT_SEMANTIC_VERSION, model: `${TEXT_MODEL.id}@${TEXT_MODEL.revision}`,
    id: block.id, type: block.type, text: input.text, textSource: input.textSource,
  }));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function normalizeVector(vector) {
  if (!vector?.length || Array.from(vector).some(value => !Number.isFinite(value))) throw new Error('Embedding must contain finite values.');
  const magnitude = Math.hypot(...vector);
  if (magnitude <= 1e-12) throw new Error('Embedding must have nonzero length.');
  return Float32Array.from(vector, value => value / magnitude);
}

export function cosineSimilarity(left, right) {
  if (!left?.length || left.length !== right?.length) throw new Error('Embedding dimensions must match.');
  let dot = 0, leftNorm = 0, rightNorm = 0;
  for (let i = 0; i < left.length; i++) {
    if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) throw new Error('Embedding must contain finite values.');
    dot += left[i] * right[i]; leftNorm += left[i] ** 2; rightNorm += right[i] ** 2;
  }
  return leftNorm && rightNorm ? Math.max(-1, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm))) : 0;
}

export function vectorFor(index, id, space = 'multimodal') {
  const entry = index.byId.get(id);
  if (!entry) return null;
  const dimensions = space === 'text' ? TEXT_MODEL.dimensions : index.dimensions;
  const vectors = space === 'text' ? index.textVectors : index.vectors;
  return vectors?.subarray(entry.row * dimensions, (entry.row + 1) * dimensions) || null;
}

export function semanticSpace(index, id) {
  const entry = index?.byId?.get(id);
  const text = !!index?.textVectors && ['link', 'text', 'file'].includes(entry?.type);
  return { space: text ? 'text' : 'multimodal', model: text ? index.manifest.textIndex.model : index?.manifest?.model || CLIP_MODEL, dimensions: text ? TEXT_MODEL.dimensions : CLIP_MODEL.dimensions };
}

export function nearestNeighbors(index, id, { limit = 12, allowedIds, excludeIds } = {}) {
  if (!index?.byId?.has(id) || (index.validIds && !index.validIds.has(id))) return [];
  const { space, model } = semanticSpace(index, id);
  if (space === 'text' && index.validTextIds && !index.validTextIds.has(id)) return [];
  const vector = vectorFor(index, id, space);
  const allowed = allowedIds ? new Set(allowedIds) : null, excluded = new Set(excludeIds || []);
  return index.entries.filter(entry => entry.id !== id && !excluded.has(entry.id) &&
    (!allowed || allowed.has(entry.id)) && (!index.validIds || index.validIds.has(entry.id)) &&
    (space !== 'text' || (['link', 'text', 'file'].includes(entry.type) && (!index.validTextIds || index.validTextIds.has(entry.id)))))
    .map(entry => ({ id: entry.id, score: cosineSimilarity(vector, vectorFor(index, entry.id, space)), entry, space, model: model.id }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, Math.min(200, Math.floor(limit))));
}

export function getEmbeddingStatus(index) {
  if (!index) return { state: 'missing', total: 0, indexed: 0, valid: 0, missingIds: [], staleIds: [], orphanIds: [] };
  const { missingIds = [], staleIds = [], orphanIds = [], total = index.entries.length } = index.validation || {};
  return {
    state: !index.entries.length ? 'missing' : staleIds.length ? 'stale' : missingIds.length ? 'partial' : 'ready',
    total, indexed: index.entries.length, valid: index.validIds?.size ?? index.entries.length,
    missingIds, staleIds, orphanIds, dimensions: index.dimensions,
    model: index.manifest.model, generatedAt: index.manifest.generatedAt,
    textModel: index.manifest.textIndex?.model || null, textIndexed: index.textVectors ? index.entries.length : 0,
    textValid: index.validTextIds?.size ?? (index.textVectors ? index.entries.length : 0),
  };
}

/** Hash validation runs once at load; subsequent similarity queries are pure and synchronous. */
export async function validateSemanticIndex(index, blocks) {
  const canonical = new Map(blocks.map(block => [block.id, block]));
  const missingIds = blocks.filter(block => !index.byId.has(block.id)).map(block => block.id);
  const orphanIds = index.entries.filter(entry => !canonical.has(entry.id)).map(entry => entry.id);
  const staleIds = [];
  index.validIds = new Set();
  index.validTextIds = new Set();
  await Promise.all(blocks.map(async block => {
    const entry = index.byId.get(block.id);
    if (!entry) return;
    if (entry.inputHash !== await embeddingInputHash(block)) staleIds.push(block.id);
    else index.validIds.add(block.id);
    if (index.textVectors) {
      if (entry.textSource?.inputHash !== await textEmbeddingInputHash(block)) {
        if (!staleIds.includes(block.id)) staleIds.push(block.id);
        index.validIds.delete(block.id);
      } else index.validTextIds.add(block.id);
    }
  }));
  index.validation = { total: blocks.length, missingIds, staleIds: staleIds.sort(), orphanIds };
  return getEmbeddingStatus(index);
}

function parseVectors(buffer, rows, dimensions) {
  if (!buffer) throw new Error('Semantic vector file is missing.');
  const source = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  if (source.byteLength !== rows * dimensions * 4) throw new Error('Semantic vector file has an invalid length.');
  const vectors = new Float32Array(rows * dimensions), view = new DataView(source);
  for (let i = 0; i < vectors.length; i++) {
    vectors[i] = view.getFloat32(i * 4, true);
    if (!Number.isFinite(vectors[i])) throw new Error('Semantic index contains an invalid vector.');
  }
  for (let row = 0; row < rows; row++) {
    const norm = Math.hypot(...vectors.subarray(row * dimensions, (row + 1) * dimensions));
    if (Math.abs(norm - 1) > 0.002) throw new Error('Semantic vectors must be normalized.');
  }
  return vectors;
}

export function parseSemanticIndex(manifest, buffer, { textBuffer } = {}) {
  if (manifest?.schemaVersion !== 1 || manifest?.inputVersion !== SEMANTIC_VERSION ||
      manifest?.model?.id !== CLIP_MODEL.id || manifest?.model?.revision !== CLIP_MODEL.revision ||
      manifest?.model?.dimensions !== CLIP_MODEL.dimensions || manifest?.model?.dtype !== CLIP_MODEL.dtype ||
      manifest?.vectors?.encoding !== 'float32-le' || !Array.isArray(manifest.entries)) throw new Error('Unsupported semantic index.');
  const dimensions = manifest.model.dimensions, entries = manifest.entries, byId = new Map();
  const vectors = parseVectors(buffer, entries.length, dimensions);
  let textVectors;
  if (manifest.textIndex) {
    const model = manifest.textIndex.model;
    if (manifest.textIndex.inputVersion !== TEXT_SEMANTIC_VERSION || model?.id !== TEXT_MODEL.id || model?.revision !== TEXT_MODEL.revision || model?.dimensions !== TEXT_MODEL.dimensions || model?.dtype !== TEXT_MODEL.dtype || manifest.textIndex.vectors?.encoding !== 'float32-le' || manifest.textIndex.vectors?.path !== 'text-vectors.bin') throw new Error('Unsupported text semantic index.');
    textVectors = parseVectors(textBuffer, entries.length, TEXT_MODEL.dimensions);
  }
  for (let row = 0; row < entries.length; row++) {
    const entry = entries[row];
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,100}$/.test(entry?.id || '') || byId.has(entry.id) || entry.row !== row || !/^[a-f0-9]{64}$/.test(entry.inputHash || '')) throw new Error('Semantic index contains an invalid entry.');
    if (textVectors && (!['link', 'text', 'image', 'file', 'video', 'audio'].includes(entry.type) || !/^[a-f0-9]{64}$/.test(entry.textSource?.inputHash || ''))) throw new Error('Semantic index contains an invalid text entry.');
    byId.set(entry.id, entry);
  }
  return { manifest, vectors, textVectors, entries, byId, dimensions };
}

export async function loadSemanticIndex(baseUrl, { fetch: fetcher = globalThis.fetch, blocks } = {}) {
  const base = new URL(baseUrl, globalThis.document?.baseURI || 'http://localhost/');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const response = await fetcher(new URL('index.json', base));
  if (!response.ok) throw new Error(`Semantic index is unavailable (${response.status}).`);
  const manifest = await response.json();
  if (manifest?.vectors?.path !== 'vectors.bin') throw new Error('Unsupported semantic vector path.');
  async function binary(metadata, expectedPath) {
    if (metadata?.path !== expectedPath || !/^[a-f0-9]{64}$/.test(metadata.sha256 || '')) throw new Error('Semantic index is missing its integrity digest or has an invalid path.');
    const vectorResponse = await fetcher(new URL(expectedPath, base));
    if (!vectorResponse.ok) throw new Error(`Semantic vectors are unavailable (${vectorResponse.status}).`);
    const bytes = await vectorResponse.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const actual = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    if (actual !== metadata.sha256) throw new Error('Semantic vector integrity check failed.');
    return bytes;
  }
  const [bytes, textBuffer] = await Promise.all([
    binary(manifest.vectors, 'vectors.bin'),
    manifest.textIndex ? binary(manifest.textIndex.vectors, 'text-vectors.bin') : Promise.resolve(undefined),
  ]);
  const index = parseSemanticIndex(manifest, bytes, { textBuffer });
  if (blocks) await validateSemanticIndex(index, blocks);
  return index;
}
