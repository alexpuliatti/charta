import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  CLIP_MODEL, SEMANTIC_VERSION, TEXT_MODEL, TEXT_SEMANTIC_VERSION, textEmbeddingInputHash, semanticSpace,
  embeddingText, embeddingImage, embeddingInputHash,
  cosineSimilarity, normalizeVector, nearestNeighbors, parseSemanticIndex,
  validateSemanticIndex, getEmbeddingStatus, loadSemanticIndex,
} from '../shared/semantic.mjs';
import { tokenChunks, meanVectors, embeddingSourceText } from '../scripts/embed-library.mjs';
import { buildLibrary } from '../scripts/library.mjs';
import { sentenceTokenChunks } from '../scripts/embed-text.mjs';

const block = (id, type = 'text') => ({ id, title: id, type, body: `Saved body for ${id}`, tags: [], assets: [], related: [] });
async function fixture(blocks = [block('b_a'), block('b_b'), block('b_c')]) {
  const source = [[1, 0], [0.8, 0.6], [-1, 0]];
  const vectors = blocks.map((_, row) => normalizeVector([...source[row], ...new Array(510).fill(0)]));
  const bytes = Buffer.alloc(blocks.length * 512 * 4);
  for (let i = 0; i < vectors.length; i++) for (let d = 0; d < 512; d++) bytes.writeFloatLE(vectors[i][d], (i * 512 + d) * 4);
  const manifest = { schemaVersion: 1, inputVersion: SEMANTIC_VERSION, model: { ...CLIP_MODEL }, vectors: { path: 'vectors.bin', encoding: 'float32-le', sha256: createHash('sha256').update(bytes).digest('hex') }, entries: await Promise.all(blocks.map(async (b, row) => ({ id: b.id, row, inputHash: await embeddingInputHash(b) }))) };
  return { blocks, manifest, bytes, index: parseSemanticIndex(manifest, bytes) };
}

async function dualFixture() {
  const result = await fixture([block('b_a', 'link'), block('b_b', 'image'), block('b_c', 'file')]);
  const textBytes = Buffer.alloc(3 * 384 * 4), source = [[1, 0], [-1, 0], [0.9, Math.sqrt(0.19)]];
  for (let row = 0; row < source.length; row++) for (let d = 0; d < source[row].length; d++) textBytes.writeFloatLE(source[row][d], (row * 384 + d) * 4);
  result.manifest.textIndex = { inputVersion: TEXT_SEMANTIC_VERSION, model: { ...TEXT_MODEL }, vectors: { path: 'text-vectors.bin', encoding: 'float32-le', sha256: createHash('sha256').update(textBytes).digest('hex') } };
  for (let row = 0; row < result.blocks.length; row++) Object.assign(result.manifest.entries[row], { type: result.blocks[row].type, textSource: { inputHash: await textEmbeddingInputHash(result.blocks[row]), textChunks: 1 } });
  result.textBytes = textBytes;
  result.index = parseSemanticIndex(result.manifest, result.bytes, { textBuffer: textBytes });
  return result;
}

test('saved body, OCR, captions and summaries enter input; YAML and fabricated source previews do not', () => {
  const saved = { ...block('b_a'), body: '---\ntitle: YAML metadata\n---\nActual article body', artifact: { text: 'Visible cover text', description: 'A blue editorial cover' }, summary: { status: 'ready', text: 'Saved summary' }, source: { title: 'Old imported filename' } };
  const text = embeddingText(saved);
  for (const expected of ['Actual article body', 'Visible cover text', 'A blue editorial cover', 'Saved summary']) assert.ok(text.includes(expected));
  assert.ok(!text.includes('YAML metadata')); assert.ok(!text.includes('Old imported filename'));
  const asset = { role: 'thumbnail', path: 'assets/preview.webp', mimeType: 'image/webp' };
  assert.equal(embeddingImage({ ...saved, type: 'link', assets: [asset] }), null);
  assert.equal(embeddingImage({ ...saved, type: 'video', assets: [asset] }), asset);
});

test('input hash tracks content and image bytes metadata without invalidating on dates or authored relations', async () => {
  const material = { ...block('b_image', 'image'), assets: [{ role: 'thumbnail', mimeType: 'image/webp', path: 'assets/thumb.webp', sha256: 'a'.repeat(64) }] };
  const original = await embeddingInputHash(material);
  for (const patch of [{ title: 'New title' }, { body: 'New body' }, { artifact: { text: 'OCR' } }, { tags: ['new'] }, { assets: [{ ...material.assets[0], sha256: 'b'.repeat(64) }] }]) assert.notEqual(await embeddingInputHash({ ...material, ...patch }), original);
  assert.equal(await embeddingInputHash({ ...material, updatedAt: 'tomorrow', related: ['b_other'] }), original);
});

test('cosine ranking crosses media types, supports subsets and never writes authored links', async () => {
  const { blocks, index } = await fixture([block('b_a'), block('b_b', 'image'), block('b_c', 'video')]);
  const before = structuredClone(blocks);
  await validateSemanticIndex(index, blocks);
  const neighbors = nearestNeighbors(index, 'b_a');
  assert.deepEqual(neighbors.map(entry => entry.id), ['b_b', 'b_c']);
  assert.ok(Math.abs(neighbors[0].score - 0.8) < 1e-6);
  assert.deepEqual(nearestNeighbors(index, 'b_a', { allowedIds: ['b_c'] }).map(entry => entry.id), ['b_c']);
  assert.deepEqual(nearestNeighbors(index, 'b_a', { excludeIds: ['b_b'] }).map(entry => entry.id), ['b_c']);
  assert.deepEqual(blocks, before);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
  assert.throws(() => cosineSimilarity([1], [1, 2]), /dimensions/);
});

test('stale anchors and candidates cannot produce apparently current semantic recommendations', async () => {
  const { blocks, index } = await fixture();
  blocks[1].body = 'Edited article';
  blocks.push(block('b_new'));
  const status = await validateSemanticIndex(index, blocks);
  assert.equal(status.state, 'stale'); assert.equal(status.valid, 2);
  assert.deepEqual(status.staleIds, ['b_b']); assert.deepEqual(status.missingIds, ['b_new']);
  assert.deepEqual(nearestNeighbors(index, 'b_b'), []);
  assert.deepEqual(nearestNeighbors(index, 'b_a').map(entry => entry.id), ['b_c']);
  assert.equal(getEmbeddingStatus(null).state, 'missing');
});

test('binary manifest rejects malformed dimensions, IDs, nonfinite vectors, and vector tampering', async () => {
  const { manifest, bytes, blocks } = await fixture();
  assert.throws(() => parseSemanticIndex({ ...manifest, model: { ...manifest.model, dimensions: 2 } }, bytes), /Unsupported/);
  assert.throws(() => parseSemanticIndex(manifest, bytes.subarray(4)), /length/);
  const bad = structuredClone(manifest); bad.entries[1].id = bad.entries[0].id;
  assert.throws(() => parseSemanticIndex(bad, bytes), /invalid entry/);
  const invalid = Buffer.from(bytes); invalid.writeFloatLE(NaN, 0);
  assert.throws(() => parseSemanticIndex(manifest, invalid), /invalid vector/);
  const fetch = async url => url.pathname.endsWith('index.json') ? { ok: true, json: async () => manifest } : { ok: true, arrayBuffer: async () => invalid.buffer.slice(invalid.byteOffset, invalid.byteOffset + invalid.byteLength) };
  await assert.rejects(loadSemanticIndex('https://example.com/jelly/content/embeddings/', { fetch, blocks }), /integrity/);
});

test('same-origin nested-page loading validates current input hashes', async () => {
  const { manifest, bytes, blocks } = await fixture();
  const requested = [];
  const fetch = async url => {
    requested.push(url.href);
    return url.pathname.endsWith('index.json') ? { ok: true, json: async () => manifest } : { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  };
  const index = await loadSemanticIndex('https://example.com/jelly/content/embeddings/', { fetch, blocks });
  assert.equal(getEmbeddingStatus(index).state, 'ready');
  assert.deepEqual(requested, ['https://example.com/jelly/content/embeddings/index.json', 'https://example.com/jelly/content/embeddings/vectors.bin']);
});

test('long documents are chunked without lost tokens and fused projections stay normalized', () => {
  const tokens = Array.from({ length: 193 }, (_, i) => i);
  const chunks = tokenChunks(tokens);
  assert.deepEqual(chunks.map(chunk => chunk.length), [75, 75, 43]);
  assert.deepEqual(chunks.flat(), tokens);
  const fused = meanVectors([[1, 0], [0, 1]], [0.75, 0.25]);
  assert.ok(Math.abs(Math.hypot(...fused) - 1) < 1e-6);
  assert.ok(fused[0] > fused[1]);
  assert.throws(() => normalizeVector([0, 0]), /nonzero/);
});

test('full extracted document sidecars are verified and used beyond the catalog preview', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jelly-semantic-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const full = 'Complete extracted text beyond the short preview. '.repeat(200);
  await mkdir(path.join(root, 'content/blocks/b_pdf'), { recursive: true });
  await writeFile(path.join(root, 'content/blocks/b_pdf/extracted.txt'), full);
  const material = { ...block('b_pdf', 'file'), path: 'content/blocks/b_pdf/block.json', artifact: { text: 'Short preview', textPath: 'extracted.txt', textSha256: createHash('sha256').update(full).digest('hex'), textCharacters: full.length } };
  const result = await embeddingSourceText(root, material);
  assert.ok(result.text.includes(full.trim()));
  assert.ok(!result.text.includes('Short preview'));
  assert.equal(result.extractedText.complete, true);
  assert.equal(result.extractedText.characters, full.length);
  const hash = await embeddingInputHash(material);
  assert.notEqual(await embeddingInputHash({ ...material, artifact: { ...material.artifact, textSha256: 'f'.repeat(64) } }), hash);
  await writeFile(path.join(root, 'content/blocks/b_pdf/extracted.txt'), 'Changed bytes');
  await assert.rejects(embeddingSourceText(root, material), /SHA-256/);
  await assert.rejects(embeddingSourceText(root, { ...material, artifact: { ...material.artifact, textPath: '../escape.txt' } }), /unsafe/);
});

test('Pages build and archive export preserve semantic binary bytes without text decoding', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jelly-semantic-archive-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (file, data) => { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), data); };
  const material = { ...block('b_a'), schemaVersion: 1, path: 'content/blocks/b_a/block.json' };
  const { manifest, bytes } = await fixture([material]);
  await put('web/index.html', '<title>Library</title>');
  await put('content/library.json', JSON.stringify({ schemaVersion: 1, title: 'Library', inboxCollectionId: 'c_inbox' }));
  await put('content/collections/inbox/collection.json', JSON.stringify({ schemaVersion: 1, id: 'c_inbox', title: 'Inbox', items: [{ kind: 'block', id: 'b_a' }] }));
  await put(material.path, JSON.stringify(material));
  await put('content/embeddings/index.json', JSON.stringify(manifest));
  await put('content/embeddings/vectors.bin', bytes);
  const catalog = await buildLibrary(root, path.join(root, 'dist'), { publish: true, env: {} });
  assert.ok(catalog.extraFiles.includes('content/embeddings/vectors.bin'));
  assert.deepEqual(await readFile(path.join(root, 'dist/content/embeddings/vectors.bin')), bytes);
  // Import the real store against an isolated origin and inspect the ZIP's stored entry.
  await mkdir(path.join(root, 'shared'));
  for (const name of ['model.mjs', 'canvas.mjs', 'taxonomy.mjs', 'clip-markdown.mjs', 'uploads.mjs', 'resource-routing.mjs', 'pdf-reading.mjs', 'operations.mjs']) await copyFile(new URL(`../shared/${name}`, import.meta.url), path.join(root, 'shared', name));
  for (const name of ['store.mjs', 'operations.mjs', 'github.mjs', 'browser-draft.mjs']) await copyFile(new URL(`../web/${name}`, import.meta.url), path.join(root, name));
  const previous = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch };
  t.after(() => Object.assign(globalThis, previous));
  globalThis.document = { baseURI: 'https://example.test/Jelly/' };
  globalThis.location = { pathname: '/Jelly/' };
  globalThis.fetch = async url => new Response(await readFile(path.join(root, new URL(url).pathname.slice('/Jelly/'.length))));
  const { LibraryStore } = await import(path.join(root, 'store.mjs'));
  const zip = Buffer.from(await (await new LibraryStore(catalog, 'browser').exportContent({ download: false })).arrayBuffer());
  let found = false;
  for (let offset = 0; zip.readUInt32LE(offset) === 0x04034b50;) {
    const size = zip.readUInt32LE(offset + 18), nameLength = zip.readUInt16LE(offset + 26), extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extraLength;
    if (name === 'content/embeddings/vectors.bin') { assert.deepEqual(zip.subarray(start, start + size), bytes); found = true; }
    offset = start + size;
  }
  assert.equal(found, true);
});

test('reading and PDF anchors use only MiniLM reading cosine; image anchors retain all-media CLIP', async () => {
  const { index, blocks } = await dualFixture();
  const status = await validateSemanticIndex(index, blocks);
  assert.equal(status.textIndexed, 3); assert.equal(status.textValid, 3);
  assert.equal(semanticSpace(index, 'b_a').model.id, TEXT_MODEL.id);
  assert.equal(semanticSpace(index, 'b_b').model.id, CLIP_MODEL.id);
  const reading = nearestNeighbors(index, 'b_a');
  assert.deepEqual(reading.map(item => item.id), ['b_c'], 'visual OCR records cannot crowd reading recommendations');
  assert.equal(reading[0].space, 'text'); assert.ok(Math.abs(reading[0].score - 0.9) < 1e-6);
  const visual = nearestNeighbors(index, 'b_b');
  assert.deepEqual(visual.map(item => item.id), ['b_a', 'b_c']);
  assert.equal(visual[0].space, 'multimodal'); assert.ok(Math.abs(visual[0].score - 0.8) < 1e-6);
  index.byId.get('b_c').textSource.inputHash = 'a'.repeat(64);
  await validateSemanticIndex(index, blocks);
  assert.deepEqual(nearestNeighbors(index, 'b_a'), []);
  assert.deepEqual(nearestNeighbors(index, 'b_c'), []);
});

test('secondary vectors require their own valid digest, row coverage, and complete token chunks', async () => {
  const { manifest, bytes, textBytes, blocks } = await dualFixture();
  assert.throws(() => parseSemanticIndex(manifest, bytes), /missing/);
  assert.throws(() => parseSemanticIndex(manifest, bytes, { textBuffer: textBytes.subarray(4) }), /length/);
  const tampered = Buffer.from(textBytes); tampered[tampered.length - 1] ^= 1;
  const fetch = async url => url.pathname.endsWith('index.json') ? { ok: true, json: async () => manifest } : { ok: true, arrayBuffer: async () => {
    const data = url.pathname.endsWith('text-vectors.bin') ? tampered : bytes;
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  } };
  await assert.rejects(loadSemanticIndex('https://example.test/Jelly/content/embeddings/', { fetch, blocks }), /integrity/);
  const tokens = Array.from({ length: 1000 }, (_, i) => i), chunks = sentenceTokenChunks(tokens);
  assert.deepEqual(chunks.map(chunk => chunk.length), [254, 254, 254, 238]);
  assert.deepEqual(chunks.flat(), tokens);
});
