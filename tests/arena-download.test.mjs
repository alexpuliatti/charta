import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mediaCandidates, downloadAsset } from '../scripts/arena-download.mjs';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
const candidate = fields => ({ url: 'https://media.example/image.png?signature=private-query', role: 'original', expectedMime: 'image/png', originalName: 'image.png', ...fields });
async function temporary(t) { const root = await mkdtemp(path.join(tmpdir(), 'jelly-download-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }

test('media candidates preserve originals while treating links and embeds as previews', () => {
  const image = { src: 'https://cdn.example/original.jpg', content_type: 'image/jpeg', filename: 'original.jpg', small: { src: 'https://cdn.example/small.jpg' }, medium: { src: 'https://cdn.example/medium.jpg' } };
  const images = mediaCandidates({ type: 'Image', image });
  assert.deepEqual(images.map(item => item.role), ['original', 'thumbnail']);
  assert.equal(images[1].url, image.small.src);
  assert.deepEqual(images[1].fallbackUrls, [image.medium.src, image.src]);
  assert.deepEqual(mediaCandidates({ type: 'Link', image }).map(item => item.role), ['preview', 'thumbnail']);
  const attachment = mediaCandidates({ type: 'Attachment', attachment: { url: 'https://attachments.example/movie.mp4', filename: 'movie.mp4', content_type: 'video/mp4' }, image });
  assert.equal(attachment[0].url, 'https://attachments.example/movie.mp4');
  assert.equal(attachment[0].role, 'original');
  assert.equal(attachment[1].role, 'preview', 'document and video posters retain a full-resolution image');
  assert.equal(mediaCandidates({ type: 'Embed', embed: { url: 'https://player.example/movie', thumbnail_url: image.src } })[0].role, 'thumbnail');
  assert.deepEqual(mediaCandidates({ type: 'Text' }), []);
});

test('downloads with no credentials, stores content hashes, and reuses verified cache bytes', async t => {
  const root = await temporary(t), block = path.join(root, 'block'), cache = path.join(root, 'cache');
  let calls = 0;
  const fetch = async (url, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit');
    assert.equal(new Headers(options.headers).has('authorization'), false);
    assert.equal(new Headers(options.headers).has('cookie'), false);
    return new Response(png, { headers: { 'Content-Type': 'image/png' } });
  };
  let result = await downloadAsset(candidate(), block, { fetch, lookup, cacheDirectory: cache });
  assert.equal(result.status, 'downloaded');
  assert.equal(result.asset.sha256, createHash('sha256').update(png).digest('hex'));
  assert.equal(result.asset.bytes, png.length);
  assert.equal(result.asset.sourceUrl, 'https://media.example/image.png');
  assert.deepEqual(await readFile(path.join(block, result.asset.path)), png);
  result = await downloadAsset(candidate(), block, { fetch, lookup, cacheDirectory: cache });
  assert.equal(result.status, 'cached');
  assert.equal(calls, 1);
});

test('private hosts, credential URLs, and private redirects are rejected before contact', async t => {
  const root = await temporary(t);
  let calls = 0;
  const fetch = async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/secret?token=redacted' } }); };
  for (const url of ['http://media.example/file', 'https://localhost/file', 'https://127.0.0.1/file', 'https://[::1]/file', 'https://169.254.169.254/file', 'https://user:password@media.example/file']) {
    await assert.rejects(downloadAsset(candidate({ url }), root, { fetch, lookup }), { code: 'UNSAFE_URL' });
  }
  assert.equal(calls, 0);
  await assert.rejects(downloadAsset(candidate(), root, { fetch, lookup }), { code: 'UNSAFE_URL' });
  assert.equal(calls, 1);
  await assert.rejects(downloadAsset(candidate(), root, { fetch, lookup: async () => [{ address: '10.0.0.1' }] }), { code: 'UNSAFE_URL' });
  assert.equal(calls, 1);
});

test('a wrong raster fails and a later thumbnail fallback supplies a real image', async t => {
  const root = await temporary(t);
  const broken = async () => new Response('<html>not an image</html>', { headers: { 'Content-Type': 'image/png' } });
  await assert.rejects(downloadAsset(candidate(), root, { fetch: broken, lookup }), { code: 'INVALID_MEDIA' });
  const seen = [];
  const result = await downloadAsset(candidate({ role: 'thumbnail', fallbackUrls: ['https://media.example/working.png'] }), root, {
    lookup, fetch: async url => { seen.push(url); return seen.length === 1 ? new Response('missing', { status: 404 }) : new Response(png); },
  });
  assert.equal(seen.length, 2);
  assert.equal(result.asset.role, 'thumbnail');
  assert.equal(result.asset.sourceUrl, 'https://media.example/working.png');
});

test('unsupported active originals retain exact bytes as inert binary downloads', async t => {
  const root = await temporary(t), body = Buffer.from('<svg><script>active</script></svg>');
  const result = await downloadAsset(candidate({ expectedMime: 'image/svg+xml', originalName: '../../drawing.svg' }), root, { lookup, fetch: async () => new Response(body, { headers: { 'Content-Type': 'image/svg+xml' } }) });
  assert.match(result.asset.path, /\.bin$/);
  assert.equal(result.asset.mimeType, 'application/octet-stream');
  assert.equal(result.asset.originalName, 'drawing.svg');
  assert.deepEqual(await readFile(path.join(root, result.asset.path)), body);
});

test('declared or streaming size limits reject without keeping partial files', async t => {
  const root = await temporary(t);
  await assert.rejects(downloadAsset(candidate(), root, { lookup, maxBytes: 5, fetch: async () => new Response(png, { headers: { 'Content-Length': String(png.length) } }) }), { code: 'ASSET_TOO_LARGE' });
  await assert.rejects(downloadAsset(candidate(), root, { lookup, maxBytes: 5, fetch: async () => new Response(png) }), { code: 'ASSET_TOO_LARGE' });
});

test('transient failures retry without including query secrets in logs or errors', async t => {
  const root = await temporary(t), logs = [];
  let calls = 0;
  const result = await downloadAsset(candidate(), root, { lookup, retryDelayMs: 0, log: message => logs.push(message), fetch: async () => ++calls < 3 ? new Response(null, { status: 503 }) : new Response(png) });
  assert.equal(calls, 3);
  assert.equal(result.status, 'downloaded');
  assert.ok(logs.every(message => !message.includes('private-query')));
  await assert.rejects(downloadAsset(candidate(), root, { lookup, retryDelayMs: 0, fetch: async () => { throw new Error('Failure at ?signature=private-query'); } }), failure => !failure.message.includes('private-query'));
});
