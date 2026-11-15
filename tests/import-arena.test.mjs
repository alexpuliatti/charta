import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { importArena, arenaChannelURL, arenaMaterialType } from '../scripts/import-arena.mjs';
import { loadLibrary } from '../scripts/library.mjs';

const stamp = '2026-11-15T10:00:00Z';
async function seed(root) {
  await mkdir(path.join(root, 'content/collections/inbox'), { recursive: true });
  await mkdir(path.join(root, 'content/blocks/b_local'), { recursive: true });
  await writeFile(path.join(root, 'content/library.json'), JSON.stringify({ schemaVersion: 1, title: 'Local library', inboxCollectionId: 'c_inbox' }));
  await writeFile(path.join(root, 'content/collections/inbox/collection.json'), JSON.stringify({ schemaVersion: 1, id: 'c_inbox', title: 'Inbox', items: [{ kind: 'block', id: 'b_local' }] }));
  await writeFile(path.join(root, 'content/blocks/b_local/block.json'), JSON.stringify({ schemaVersion: 1, id: 'b_local', title: 'A real local note', type: 'text', category: 'Notes', tags: ['local'], assets: [], related: [], createdAt: stamp, updatedAt: stamp }));
}
function fixture() {
  const channels = [
    { id: 1, type: 'Channel', title: 'My first channel', slug: 'first', owner: { slug: 'owner' }, importScope: 'account', visibility: 'closed', counts: { blocks: 1, channels: 1, contents: 2 } },
    { id: 2, type: 'Channel', title: 'My other channel', slug: 'other', owner: { slug: 'owner' }, importScope: 'account', visibility: 'closed', counts: { blocks: 1, channels: 0, contents: 1 } },
    { id: 3, type: 'Channel', title: 'Someone else’s channel', slug: 'reference', owner: { slug: 'another' }, importScope: 'reference', visibility: 'public', counts: { contents: 500 } },
  ];
  const block = { id: 10, type: 'Text', title: 'Shared material', content: { markdown: 'Keep this **original** text.' }, description: { plain: 'Source description.' }, created_at: stamp, updated_at: stamp };
  const unfiled = { id: 11, type: 'Link', title: 'An unfiled bookmark', source: { url: 'https://example.com/' }, created_at: stamp, updated_at: stamp };
  const snapshot = { schemaVersion: 1, user: { id: 99, name: 'Owner', slug: 'owner' }, exportedAt: stamp, completedAt: stamp, channels, blocks: [block, unfiled], contents: { 1: [{ ...block, connection: { id: 100, position: 1 } }, channels[2]], 2: [{ ...block, connection: { id: 101, position: 2 } }] }, issues: [] };
  const folder = { id: 'f_import', slug: 'imported', title: 'Imported' };
  const plan = { channels: Object.fromEntries(channels.map(c => [c.id, { folder, category: 'Research', tags: ['research'] }])), blocks: { 10: { category: 'Research', tags: ['shared', 'original', 'reading'], classification: { sourceChannelIds: [1, 2] } }, 11: { category: 'Reference', tags: ['bookmark', 'web', 'unfiled'] } }, report: {} };
  return { snapshot, plan };
}

test('account import preserves sharing, source order, external references, unfiled material, and local notes', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jelly-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'root'), stage = path.join(directory, 'stage');
  await seed(root);
  const { snapshot, plan } = fixture();
  const report = await importArena(snapshot, plan, { root, stage, log: () => {} });
  const catalog = await loadLibrary(stage);
  assert.equal(catalog.blocks.length, 3, 'two imported records plus the retained local note');
  assert.equal(catalog.blocks.filter(b => b.id === 'b_arena_10').length, 1);
  assert.equal(catalog.blocks.find(b => b.id === 'b_arena_10').body, 'Keep this **original** text.');
  assert.deepEqual(catalog.blocks.find(b => b.id === 'b_arena_10').collectionIds.sort(), ['c_arena_1', 'c_arena_2']);
  const first = catalog.collections.find(c => c.id === 'c_arena_1');
  assert.deepEqual(first.items.map(i => i.id), ['b_arena_10', 'c_arena_3']);
  assert.equal(first.items[0].sourceConnection.position, 1);
  const reference = catalog.collections.find(c => c.id === 'c_arena_3');
  assert.equal(reference.items.length, 0);
  assert.equal(reference.source.url, 'https://www.are.na/another/reference');
  assert.equal(reference.source.arena.importScope, 'reference');
  assert.ok(catalog.collections.find(c => c.id === 'c_inbox').items.some(i => i.id === 'b_arena_11'));
  assert.equal(report.unfiledMaterials, 1);
  assert.equal(report.accountChannels, 2);
  assert.equal(report.linkedChannelReferences, 1);
  assert.ok(JSON.parse(await readFile(path.join(stage, '.import-complete.json'))).completedAt);
  const unchanged = await loadLibrary(root);
  assert.equal(unchanged.blocks.length, 1, 'staging must not modify the active library');
});

test('imports reject incomplete classification and path-like IDs before writing', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jelly-import-guards-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'root'), stage = path.join(directory, 'stage');
  await seed(root);
  const { snapshot, plan } = fixture();
  await assert.rejects(importArena({ ...snapshot, completedAt: null }, plan, { root, stage }), /Finish/);
  await assert.rejects(importArena(snapshot, { ...plan, blocks: {} }, { root, stage }), /every material/);
  const unsafe = structuredClone(snapshot); unsafe.blocks[0].id = '../../unsafe';
  await assert.rejects(importArena(unsafe, plan, { root, stage }), /numeric IDs/);
});

test('imports preserve unfiled materials without creating an Inbox', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'charta-import-unfiled-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'root'), stage = path.join(directory, 'stage');
  await seed(root);
  await writeFile(path.join(root, 'content/library.json'), JSON.stringify({ schemaVersion: 1, title: 'Local library' }));
  await rm(path.join(root, 'content/collections/inbox'), { recursive: true });
  const { snapshot, plan } = fixture();
  const report = await importArena(snapshot, plan, { root, stage, log: () => {} });
  const catalog = await loadLibrary(stage);
  assert.equal(catalog.library.inboxCollectionId, undefined);
  assert.equal(catalog.collections.some(c => c.id === 'c_inbox'), false);
  assert.deepEqual(catalog.blocks.find(b => b.id === 'b_arena_11').collectionIds, []);
  assert.ok(catalog.blocks.find(b => b.id === 'b_local'));
  assert.equal(report.unfiledMaterials, 1);
});

test('media types and source channel permalinks retain playable or downloadable intent', () => {
  assert.equal(arenaMaterialType({ type: 'Attachment', attachment: { content_type: 'video/quicktime' } }), 'video');
  assert.equal(arenaMaterialType({ type: 'Attachment', attachment: { content_type: 'audio/mpeg' } }), 'audio');
  assert.equal(arenaMaterialType({ type: 'Embed', embed: { type: 'video' } }), 'video');
  assert.equal(arenaMaterialType({ type: 'Attachment', attachment: { content_type: 'application/pdf' } }), 'file');
  assert.equal(arenaChannelURL({ id: 3 }), 'https://www.are.na/channel/3');
});
