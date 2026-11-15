import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { optimizeArena, videoArguments } from '../scripts/optimize-arena.mjs';

const tools = { pillow: 'test-pillow', ffmpegVersion: 'test-ffmpeg' };
async function fixture(type = 'image/png', extension = 'png') {
  const root = await mkdtemp(path.join(tmpdir(), 'jelly-optimize-'));
  const directory = path.join(root, 'content/blocks/b_test');
  await mkdir(path.join(directory, 'assets'), { recursive: true });
  await writeFile(path.join(root, '.import-complete.json'), '{}');
  const source = path.join(directory, `assets/original.${extension}`);
  await writeFile(source, Buffer.alloc(1000, 42));
  const record = { schemaVersion: 1, id: 'b_test', title: 'Original title', category: 'Design', tags: ['preserve-this'], description: 'An owner note.', assets: [{ path: `assets/original.${extension}`, mimeType: type, role: 'original', alt: 'Original alt', bytes: 1000 }], source: { arena: { id: 123 } } };
  const filename = path.join(directory, 'block.json');
  await writeFile(filename, JSON.stringify(record));
  return { root, directory, source, filename, record };
}

test('browser copy preserves originals and the latest authored metadata, then resumes from validated cache', async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const original = await readFile(f.source);
  let calls = 0;
  const encode = async (source, destination) => {
    calls++;
    await writeFile(destination, Buffer.alloc(200, 11));
    const changed = JSON.parse(await readFile(f.filename, 'utf8'));
    changed.tags = ['human-edit-during-processing'];
    await writeFile(f.filename, JSON.stringify(changed));
    return { status: 'optimized', width: 1500, height: 1000 };
  };
  const report = await optimizeArena(f.root, { tools, optimizeImage: encode });
  const saved = JSON.parse(await readFile(f.filename, 'utf8'));
  assert.deepEqual(await readFile(f.source), original);
  assert.deepEqual(saved.tags, ['human-edit-during-processing']);
  assert.equal(saved.category, 'Design');
  assert.equal(saved.source.arena.id, 123);
  assert.equal(saved.assets.filter(a => a.role === 'original').length, 1);
  const optimized = saved.assets.find(a => a.role === 'optimized');
  assert.equal(optimized.mimeType, 'image/webp');
  assert.equal(optimized.bytes, 200);
  assert.equal(optimized.width, 1500);
  assert.equal(optimized.optimization.sourceAsset, 'assets/original.png');
  assert.equal(report.bytesSavedForBrowser, 800);
  const resumed = await optimizeArena(f.root, { tools, optimizeImage: encode });
  assert.equal(calls, 1, 'valid cached output must not be encoded again');
  assert.equal(resumed.images.cached, 1);
  assert.equal(JSON.parse(await readFile(path.join(f.root, 'content/imports/arena/optimization.json'), 'utf8')).images.cached, 1);
});

test('larger encodings keep the original, while QuickTime conversion remains playable even when larger', async t => {
  const image = await fixture();
  const video = await fixture('video/quicktime', 'mov');
  t.after(() => Promise.all([image, video].map(f => rm(f.root, { recursive: true, force: true }))));
  const runner = async (_, destination) => { await writeFile(destination, Buffer.alloc(1200)); return { status: 'optimized' }; };
  const imageReport = await optimizeArena(image.root, { tools, optimizeImage: runner });
  assert.equal(imageReport.images.smallerOriginal, 1);
  assert.equal(JSON.parse(await readFile(image.filename, 'utf8')).assets.length, 1);
  const videoReport = await optimizeArena(video.root, { tools, optimizeVideo: runner });
  assert.equal(videoReport.videos.optimized, 1);
  const record = JSON.parse(await readFile(video.filename, 'utf8'));
  assert.equal(record.assets.find(a => a.role === 'optimized').mimeType, 'video/mp4');
  assert.equal((await stat(video.source)).size, 1000);
});

test('animated images remain intact and a failed encoder does not corrupt canonical metadata', async t => {
  const animated = await fixture('image/gif', 'gif');
  const broken = await fixture();
  t.after(() => Promise.all([animated, broken].map(f => rm(f.root, { recursive: true, force: true }))));
  const animation = await optimizeArena(animated.root, { tools, optimizeImage: async () => ({ status: 'animated-original', frames: 12 }) });
  assert.equal(animation.images.animatedOriginal, 1);
  assert.equal(JSON.parse(await readFile(animated.filename, 'utf8')).assets.length, 1);
  const before = await readFile(broken.filename, 'utf8');
  const failed = await optimizeArena(broken.root, { tools, optimizeImage: async () => { throw new Error('An invalid image.'); } });
  assert.equal(failed.images.failed, 1);
  assert.equal(failed.issues[0].blockId, 'b_test');
  assert.equal(await readFile(broken.filename, 'utf8'), before);
});

test('optimization refuses incomplete imports before touching media', async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  await rm(path.join(f.root, '.import-complete.json'));
  await assert.rejects(optimizeArena(f.root, { tools, optimizeImage: async () => assert.fail('should not process') }), /Import is not complete/);
});

test('video settings bound frame rate and dimensions and request browser-compatible streaming output', () => {
  const args = videoArguments('/input.mov', '/output.mp4');
  assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
  assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
  assert.equal(args[args.indexOf('-crf') + 1], '25');
  assert.equal(args[args.indexOf('-preset') + 1], 'medium');
  assert.equal(args[args.indexOf('-pix_fmt') + 1], 'yuv420p');
  assert.match(args[args.indexOf('-vf') + 1], /1280/);
  assert.match(args[args.indexOf('-vf') + 1], /min\(source_fps,30\)/);
  assert.ok(args.includes('0:a:0?'), 'source clips without audio remain supported');
  assert.ok(args.includes('+faststart'));
});
