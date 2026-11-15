import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { upgradePreviews } from '../scripts/upgrade-previews.mjs';

const modules = await mkdtemp(path.join(tmpdir(), 'charta-image-modules-'));
await cp(new URL('../web/', import.meta.url), modules, { recursive: true });
await cp(new URL('../shared/', import.meta.url), path.join(modules, 'shared'), { recursive: true });
const { optimizeImageUpload } = await import(pathToFileURL(path.join(modules, 'resources.mjs')));
after(() => rm(modules, { recursive: true, force: true }));

function encoder(t, size = 100) {
  const dom = new JSDOM(''); t.after(() => dom.window.close());
  let closed = 0, dimensions;
  dom.window.createImageBitmap = async () => ({ width: 5000, height: 3000, close() { closed++; } });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  dom.window.HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
    assert.equal(type, 'image/webp'); assert.equal(quality, .9); dimensions = [this.width, this.height];
    callback(new dom.window.Blob(['x'.repeat(size)], { type }));
  };
  return { document: dom.window.document, dimensions: () => dimensions, closed: () => closed };
}

test('still image uploads reduce stored bytes before saving, retaining useful resolution', async t => {
  const e = encoder(t), file = new File(['x'.repeat(1000)], 'Screenshot.png', { type: 'image/png' });
  const compressed = await optimizeImageUpload(file, e.document);
  assert.equal(compressed.type, 'image/webp'); assert.equal(compressed.name, 'Screenshot.webp');
  assert.equal(compressed.size, 100); assert.deepEqual(e.dimensions(), [2560, 1536]); assert.equal(e.closed(), 1);
});

test('compression never enlarges a small original or flattens animated files', async t => {
  const e = encoder(t, 2000), file = new File(['x'.repeat(1000)], 'Photo.jpg', { type: 'image/jpeg' });
  assert.equal(await optimizeImageUpload(file, e.document), file);
  const gif = new File(['GIF89a'], 'Animated.gif', { type: 'image/gif' });
  assert.equal(await optimizeImageUpload(gif, e.document), gif);
  const png = new File(['PNG acTL animated payload'], 'Animated.png', { type: 'image/png' });
  assert.equal(await optimizeImageUpload(png, e.document), png);
  const webp = new Uint8Array(32); webp.set(new TextEncoder().encode('VP8X'), 12); webp[20] = 2;
  const animation = new File([webp], 'Animated.webp', { type: 'image/webp' });
  assert.equal(await optimizeImageUpload(animation, e.document), animation);
  assert.equal(e.closed(), 1, 'animations never reach the still-image encoder');
});

test('preview repair is additive, preserves current authored metadata, and is repeatable', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'charta-preview-repair-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'content/blocks/b_example');
  await mkdir(path.join(directory, 'assets'), { recursive: true });
  await mkdir(path.join(root, 'content/imports/arena'), { recursive: true });
  const thumbnail = { path: 'assets/thumbnail.png', mimeType: 'image/png', role: 'thumbnail' };
  const block = { schemaVersion: 1, id: 'b_example', type: 'link', title: 'Authored title', description: 'A personal note', category: 'Sound', tags: ['reference'], related: [], assets: [thumbnail], source: { url: 'https://example.test', arena: { id: 12 } } };
  await writeFile(path.join(root, 'content/library.json'), JSON.stringify({ schemaVersion: 1, title: 'Preview test' }));
  await writeFile(path.join(directory, 'block.json'), JSON.stringify(block));
  await writeFile(path.join(directory, thumbnail.path), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]));
  await writeFile(path.join(root, 'content/imports/arena/source.json'), JSON.stringify({ blocks: [{ id: 12, type: 'Link', image: { src: 'https://cdn.example.test/full.png', filename: 'Full.png' } }] }));
  let calls = 0;
  const download = async candidate => {
    calls++; assert.equal(candidate.role, 'preview'); assert.equal(candidate.url, 'https://cdn.example.test/full.png');
    const latest = JSON.parse(await readFile(path.join(directory, 'block.json'))); latest.description = 'Edited during download';
    await writeFile(path.join(directory, 'block.json'), JSON.stringify(latest));
    await writeFile(path.join(directory, 'assets/full.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]));
    return { asset: { path: 'assets/full.png', role: 'preview', mimeType: 'image/png', bytes: 12 } };
  };
  assert.equal((await upgradePreviews(root, { download })).upgraded, 1);
  const saved = JSON.parse(await readFile(path.join(directory, 'block.json')));
  assert.equal(saved.description, 'Edited during download'); assert.equal(saved.title, 'Authored title');
  assert.deepEqual(saved.assets[0], thumbnail); assert.equal(saved.assets[1].role, 'preview');
  assert.equal((await upgradePreviews(root, { download })).upgraded, 0); assert.equal(calls, 1);
});
