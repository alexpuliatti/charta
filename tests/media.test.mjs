import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, cp, truncate, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assetBytesMatch, loadLibrary, buildLibrary, MAX_ASSET_BYTES } from '../scripts/library.mjs';
import { validateCatalog, canonicalRecord } from '../shared/model.mjs';
import { previewAsset, pdfAsset, assetURL, safeRemoteAssetURL, safeEmbedURL, mediaPlayer, assetDownloads } from '../web/media.mjs';

function mp4(brand = 'isom') {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(24, 0); bytes.write('ftyp', 4); bytes.write(brand, 8); bytes.write('isom', 16); bytes.write('mp42', 20);
  bytes.writeUInt32BE(8, 24); bytes.write('mdat', 28);
  return bytes;
}
const block = (fields = {}) => ({ schemaVersion: 1, id: 'b_media', path: 'content/blocks/b_media/block.json', title: 'A saved video', type: 'video', category: 'Film', tags: ['moving-image'], related: [], assets: [], ...fields });
const fixture = material => ({ schemaVersion: 1, library: { schemaVersion: 1, title: 'Media test', inboxCollectionId: 'c_inbox' }, folders: [], collections: [{ schemaVersion: 1, id: 'c_inbox', title: 'Inbox', path: 'content/collections/inbox/collection.json', parentId: null, items: [{ kind: 'block', id: material.id }] }], blocks: [material] });

test('media signatures recognize supported containers and reject HTML masquerading as media', () => {
  const fixtures = new Map([
    ['.mp4', mp4()], ['.m4v', mp4('M4V ')], ['.m4a', mp4('M4A ')], ['.mov', mp4('qt  ')],
    ['.webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, ...Buffer.from('webm')])],
    ['.mp3', Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00')],
    ['.ogg', Buffer.concat([Buffer.from('OggS'), Buffer.alloc(23)])],
    ['.wav', Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ')],
  ]);
  for (const [extension, bytes] of fixtures) {
    assert.equal(assetBytesMatch(bytes, extension), true, extension);
    assert.equal(assetBytesMatch(Buffer.from('<html><script>bad()</script></html>'), extension), false, extension);
  }
  assert.equal(assetBytesMatch(Buffer.from([255, 251, 144, 100]), '.mp3'), true);
  assert.equal(assetBytesMatch(new Uint8Array(mp4()), '.MP4'), true, 'download buffers can use Uint8Array input');
  assert.equal(assetBytesMatch(mp4('avif'), '.mp4'), true, 'compatible video brands determine ISO-BMFF acceptance');
  const imageOnly = mp4('avif'); imageOnly.write('avif', 16); imageOnly.write('mif1', 20);
  assert.equal(assetBytesMatch(imageOnly, '.mp4'), false, 'image-only ISO-BMFF does not become video');
});

test('canonical library loader accepts local video and audio and enforces the media file limit', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'jelly-media-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const material = block({ assets: [{ path: 'assets/original.mp4', mimeType: 'video/mp4', role: 'original', bytes: 32 }] });
  const catalog = fixture(material);
  for (const [file, value] of [
    ['content/library.json', catalog.library],
    ['content/collections/inbox/collection.json', { schemaVersion: 1, id: 'c_inbox', title: 'Inbox', items: catalog.collections[0].items }],
    [material.path, material],
  ]) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), JSON.stringify(value));
  }
  const file = path.join(root, 'content/blocks/b_media/assets/original.mp4');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, mp4());
  const loaded = await loadLibrary(root);
  assert.equal(loaded.blocks[0].type, 'video');
  assert.equal(validateCatalog(loaded), loaded);
  await truncate(file, MAX_ASSET_BYTES + 1);
  await assert.rejects(loadLibrary(root), /95 MiB/);
});

test('thumbnail cards prefer thumbnails while image details prefer original bytes', () => {
  const original = { path: 'assets/original.jpg', mimeType: 'image/jpeg', role: 'original' };
  const thumbnail = { path: 'assets/thumbnail.webp', mimeType: 'image/webp', role: 'thumbnail' };
  const material = block({ type: 'image', assets: [original, thumbnail] });
  assert.equal(previewAsset(material), thumbnail);
  assert.equal(previewAsset(material, true), original);
  assert.equal(assetURL(material, original, 'https://example.test/Jelly/'), 'https://example.test/Jelly/content/blocks/b_media/assets/original.jpg');
  assert.equal(assetURL(material, { path: 'assets/../../secret.txt' }, 'https://example.test/'), '');
});

test('local players and downloads use saved files without turning text into markup', () => {
  const material = block({ title: '<img src=x onerror=bad()>', assets: [
    { path: 'assets/thumbnail.jpg', mimeType: 'image/jpeg', role: 'thumbnail' },
    { path: 'assets/original.mp4', mimeType: 'video/mp4', role: 'original', originalName: 'A video.mp4', bytes: 1024 },
  ] });
  const html = mediaPlayer(material, 'https://example.test/Jelly/');
  assert.match(html, /<video controls preload="metadata" playsinline/);
  assert.match(html, /poster="https:\/\/example.test\/Jelly\/content\/blocks\/b_media\/assets\/thumbnail.jpg"/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img/);
  const downloads = assetDownloads(material, 'https://example.test/Jelly/');
  assert.match(downloads, /download="A video.mp4"/);
  assert.doesNotMatch(downloads, /thumbnail.jpg/);
  const audio = mediaPlayer(block({ type: 'audio', assets: [{ path: 'assets/original.mp3', mimeType: 'audio/mpeg', role: 'original' }] }), 'https://example.test/');
  assert.match(audio, /<audio controls/);
  assert.doesNotMatch(audio, /<iframe/);
});

test('only known provider URLs become embeds; raw embed HTML and unrelated origins stay inert', () => {
  assert.equal(safeEmbedURL('https://www.youtube.com/watch?v=M7lc1UVf-VE&autoplay=1'), 'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE');
  assert.equal(safeEmbedURL('https://youtu.be/M7lc1UVf-VE'), 'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE');
  assert.equal(safeEmbedURL('https://vimeo.com/76979871'), 'https://player.vimeo.com/video/76979871?dnt=1');
  for (const bad of ['https://youtube.com.evil.test/watch?v=M7lc1UVf-VE', 'javascript:alert(1)', '<iframe src="https://evil.test"></iframe>', 'https://user:pass@youtube.com/watch?v=M7lc1UVf-VE', 'https://www.youtube.com/embed/not-a-valid-id']) assert.equal(safeEmbedURL(bad), '');
  assert.equal(mediaPlayer(block({ source: { embedUrl: 'https://unrelated.example/embed/123' }, embed: '<script>bad()</script>' }), 'https://example.test/'), '');
  assert.match(mediaPlayer(block({ source: { url: 'https://youtu.be/M7lc1UVf-VE' } }), 'https://example.test/'), /<iframe src="https:\/\/www.youtube-nocookie.com/);
});

test('PDF files open in the reader with a separate explicit download action', () => {
  const original = { path: 'assets/book.pdf', role: 'original', mimeType: 'application/pdf', originalName: 'A "book".pdf' };
  const display = { path: 'assets/display.pdf', role: 'optimized', mimeType: 'application/pdf' };
  const material = block({ type: 'file', assets: [original, display] });
  assert.equal(pdfAsset(material), display);
  assert.equal(pdfAsset(block({ assets: [original] })), original);
  assert.equal(pdfAsset(block()), undefined);
  const html = assetDownloads(material, 'https://example.test/Jelly/');
  assert.match(html, /href="https:\/\/example.test\/Jelly\/content\/blocks\/b_media\/assets\/book.pdf" data-action="open-pdf" data-id="b_media" data-asset="assets\/book.pdf"/);
  assert.match(html, /<small>Read PDF · Original/);
  assert.match(html, /download="A &quot;book&quot;.pdf" data-action="download-asset" aria-label="Download A &quot;book&quot;.pdf"/);
});

test('unknown original formats remain inert binary downloads with their original filename', () => {
  const original = { path: 'assets/original.bin', mimeType: 'application/octet-stream', role: 'original', originalName: 'a saved webpage.html', bytes: 17 };
  const material = block({ type: 'file', assets: [original] });
  assert.equal(validateCatalog(fixture(material)).blocks[0].assets[0].mimeType, 'application/octet-stream');
  assert.equal(assetBytesMatch(Buffer.from('<script>bad()</script>'), '.bin'), true);
  assert.equal(assetBytesMatch(Buffer.alloc(0), '.bin'), true, 'empty original files remain preservable');
  assert.equal(previewAsset(material), undefined);
  assert.equal(mediaPlayer(material, 'https://example.test/'), '');
  const download = assetDownloads(material, 'https://example.test/Jelly/');
  assert.match(download, /href="https:\/\/example.test\/Jelly\/content\/blocks\/b_media\/assets\/original.bin"/);
  assert.match(download, /download="a saved webpage.html"/);
  assert.doesNotMatch(download, /<iframe|<video|<audio|<script/);
});

test('full image previews use original resolution while video players use optimized copies', () => {
  const image = block({ type: 'image', assets: [
    { path: 'assets/original.jpg', mimeType: 'image/jpeg', role: 'original' },
    { path: 'assets/display.webp', mimeType: 'image/webp', role: 'optimized' },
    { path: 'assets/thumbnail.jpg', mimeType: 'image/jpeg', role: 'thumbnail' },
  ] });
  assert.equal(previewAsset(image).role, 'thumbnail');
  assert.equal(previewAsset(image, true).role, 'original');
  const link = block({ type: 'link', assets: [
    { path: 'assets/thumbnail.webp', mimeType: 'image/webp', role: 'thumbnail' },
    { path: 'assets/preview.png', mimeType: 'image/png', role: 'preview' }
  ] });
  assert.equal(previewAsset(link).role, 'thumbnail');
  assert.equal(previewAsset(link, true).role, 'preview', 'link screenshots also use their full resolution');
  const video = block({ assets: [
    { path: 'assets/original.mov', mimeType: 'video/quicktime', role: 'original' },
    { path: 'assets/display.mp4', mimeType: 'video/mp4', role: 'optimized' },
  ] });
  assert.match(mediaPlayer(video, 'https://example.test/'), /src="[^"]+\/display.mp4"/);
  const downloads = assetDownloads(video, 'https://example.test/');
  assert.match(downloads, /Original · video\/quicktime/);
  assert.match(downloads, /Display copy · video\/mp4/);
});

test('Pages publication retains thumbnails and immutable original URLs without copying original bytes', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'jelly-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = { path: 'assets/original.mp4', mimeType: 'video/mp4', role: 'original', originalName: 'Original video.mp4' };
  const thumbnail = { path: 'assets/thumbnail.png', mimeType: 'image/png', role: 'thumbnail' };
  const material = block({ assets: [original, thumbnail] });
  const put = async (file, value) => { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), value); };
  await put('web/index.html', '<title>A media archive</title>');
  await put('content/library.json', JSON.stringify(fixture(material).library));
  await put('content/collections/inbox/collection.json', JSON.stringify({ schemaVersion: 1, id: 'c_inbox', title: 'Inbox', items: [{ kind: 'block', id: material.id }] }));
  await put(material.path, JSON.stringify(material));
  await put('content/blocks/b_media/assets/original.mp4', mp4());
  await put('content/blocks/b_media/assets/thumbnail.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
  const extraFiles = ['classification.json', 'optimization.json', 'report.json', 'source.json'].map(name => `content/imports/arena/${name}`);
  for (const file of extraFiles) await put(file, JSON.stringify({ imported: true, file }));
  await put('content/_generated/stale.json', '{}');
  const commit = 'a'.repeat(40);
  const out = path.join(root, 'dist');
  await assert.rejects(buildLibrary(root, out, { publish: true, env: {} }), /GITHUB_REPOSITORY/);
  await assert.rejects(buildLibrary(root, out, { publish: true, repository: 'user:secret/repo', commit, env: {} }), /GITHUB_REPOSITORY/);
  const published = await buildLibrary(root, out, { env: { JELLY_PUBLISH: '1', GITHUB_REPOSITORY: 'example-owner/jelly', GITHUB_SHA: commit, SECRET_NOT_FOR_OUTPUT: 'must-stay-private' } });
  const remote = `https://raw.githubusercontent.com/example-owner/jelly/${commit}/content/blocks/b_media/assets/original.mp4`;
  assert.equal(published.blocks[0].assets[0].remoteUrl, remote);
  assert.equal(published.sourceCommit, commit);
  assert.deepEqual(published.extraFiles, extraFiles);
  await assert.rejects(readFile(path.join(out, 'content/blocks/b_media/assets/original.mp4')), { code: 'ENOENT' });
  assert.ok((await readFile(path.join(out, 'content/blocks/b_media/assets/thumbnail.png'))).length > 0);
  assert.deepEqual(await readFile(path.join(root, 'content/blocks/b_media/assets/original.mp4')), mp4());
  assert.equal(JSON.parse(await readFile(path.join(root, material.path), 'utf8')).assets[0].remoteUrl, undefined);
  const generated = await readFile(path.join(out, 'content/_generated/catalog.json'), 'utf8');
  assert.ok(!generated.includes('must-stay-private'));
  for (const file of extraFiles) assert.ok((await readFile(path.join(out, file), 'utf8')).includes('imported'));
  assert.equal(assetURL(published.blocks[0], published.blocks[0].assets[0], 'https://example.test/Jelly/'), remote);
  assert.equal(canonicalRecord(published.blocks[0]).assets[0].remoteUrl, undefined);
  await buildLibrary(root, out, { publish: false, env: {} });
  assert.deepEqual(await readFile(path.join(out, 'content/blocks/b_media/assets/original.mp4')), mp4());
});

test('remote asset URLs are HTTPS-only and browser exports include original bytes under canonical paths', async t => {
  for (const invalid of ['http://example.test/file.mp4', 'https://name:token@example.test/file.mp4', 'javascript:bad()', 'https://example.test:8443/file']) assert.equal(safeRemoteAssetURL(invalid), '');
  const root = await mkdtemp(path.join(tmpdir(), 'jelly-remote-export-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(new URL('../shared/', import.meta.url), path.join(root, 'shared'), { recursive: true });
  for (const filename of ['store.mjs', 'operations.mjs', 'github.mjs']) await copyFile(new URL(`../web/${filename}`, import.meta.url), path.join(root, filename));
  const previous = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch };
  t.after(() => Object.assign(globalThis, previous));
  globalThis.document = { baseURI: 'https://example.test/Jelly/' };
  globalThis.location = { pathname: '/Jelly/' };
  const remoteUrl = `https://raw.githubusercontent.com/owner/repo/${'b'.repeat(40)}/content/blocks/b_media/assets/original.mp4`;
  const material = block({ assets: [{ path: 'assets/original.mp4', mimeType: 'video/mp4', role: 'original', remoteUrl, originalName: 'My film.mp4' }] });
  const requests = [];
  globalThis.fetch = async (url, options) => { requests.push({ url: String(url), options }); return new Response(String(url).endsWith('/report.json') ? '{"archive":"source export"}' : mp4()); };
  const { LibraryStore } = await import(`file://${path.join(root, 'store.mjs')}`);
  const catalog = fixture(material);
  catalog.extraFiles = ['content/imports/arena/report.json'];
  const archive = await new LibraryStore(catalog, 'browser').exportContent({ download: false });
  const text = Buffer.from(await archive.arrayBuffer()).toString();
  assert.equal(requests[0].url, remoteUrl);
  assert.equal(requests[0].options.credentials, 'omit');
  assert.match(text, /content\/blocks\/b_media\/assets\/original.mp4/);
  assert.match(text, /content\/imports\/arena\/report.json/);
  assert.match(text, /source export/);
  assert.equal(requests[1].url, 'https://example.test/Jelly/content/imports/arena/report.json');
  assert.ok(!text.includes(remoteUrl), 'derived publication URL is not persisted in exported records');
  for (const file of ['content/library.json', material.path, 'content/blocks/b_media/assets/original.mp4', 'content/_generated/catalog.json', 'content/../private.json']) {
    const invalid = structuredClone(catalog); invalid.extraFiles = [file];
    assert.throws(() => validateCatalog(invalid), /archive|path/);
  }
});
