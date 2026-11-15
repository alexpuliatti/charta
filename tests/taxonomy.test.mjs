import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCategory, normalizeTags, normalizeTaxonomy, taxonomyKey } from '../shared/taxonomy.mjs';
import { applyOperation, canonicalRecord, validateCatalog } from '../shared/model.mjs';
import { loadLibrary, validateLibrary } from '../scripts/library.mjs';

const fixture = () => ({
  schemaVersion: 1, sourceCommit: 'test',
  library: { schemaVersion: 1, title: 'A test library', inboxCollectionId: 'c_inbox' },
  folders: [], collections: [{ schemaVersion: 1, id: 'c_inbox', title: 'Inbox', path: 'content/collections/inbox/collection.json', parentId: null, items: [] }], blocks: [],
});
const material = fields => ({ id: 'b_taxonomy', type: 'text', title: 'A categorized note', ...fields });

test('taxonomy labels normalize whitespace, case, optional hashtags, and Unicode consistently', () => {
  assert.equal(normalizeCategory('  Web\t culture  '), 'Web culture');
  assert.equal(taxonomyKey(' Ｗｅｂ  culture '), 'web culture');
  assert.deepEqual(normalizeTags(['#Personal-Web', ' personal-web ', '  Digital\t Gardens  ', 'digital gardens']), ['personal-web', 'digital gardens']);
  assert.deepEqual(normalizeTaxonomy({}), { category: 'Uncategorized', tags: [] });
  assert.equal(normalizeCategory('   '), 'Uncategorized');
});

test('malformed taxonomy and oversized labels are rejected instead of silently rewritten', () => {
  for (const category of [null, [], {}, 3, 'a'.repeat(81), 'bad\u0000category']) assert.throws(() => normalizeCategory(category));
  for (const tags of [null, 'one,two', {}, [null], [3], [''], ['#'], ['x'.repeat(49)], ['bad\u0000tag'], Array.from({ length: 21 }, (_, i) => `tag-${i}`)]) assert.throws(() => normalizeTags(tags));
});

test('new materials and edits preserve normalized taxonomy in canonical records', () => {
  let result = applyOperation(fixture(), { type: 'add-block', block: material({ category: '  Design  ', tags: ['#Interfaces', 'interfaces', ' Visual  Studies '] }), body: 'A durable reference.', collectionIds: ['c_inbox'] });
  assert.equal(result.catalog.blocks[0].category, 'Design');
  assert.deepEqual(result.catalog.blocks[0].tags, ['interfaces', 'visual studies']);
  let record = JSON.parse(result.writes.find(file => file.path.endsWith('/block.json')).content);
  assert.equal(record.category, 'Design');
  assert.deepEqual(record.tags, ['interfaces', 'visual studies']);
  result = applyOperation(result.catalog, { type: 'update-block', id: 'b_taxonomy', patch: { category: 'Web culture', tags: ['Personal-web', '#Ownership'] } });
  record = JSON.parse(result.writes.find(file => file.path.endsWith('/block.json')).content);
  assert.equal(record.category, 'Web culture');
  assert.deepEqual(record.tags, ['personal-web', 'ownership']);
  assert.equal(record.path, undefined);
});

test('legacy catalogs remain readable and export explicit defaults without fabricating tags', () => {
  const legacy = applyOperation(fixture(), { type: 'add-block', block: material(), collectionIds: ['c_inbox'] }).catalog;
  delete legacy.blocks[0].category;
  delete legacy.blocks[0].tags;
  assert.equal(validateCatalog(legacy), legacy);
  assert.equal(legacy.blocks[0].category, 'Uncategorized');
  assert.deepEqual(legacy.blocks[0].tags, []);
  assert.deepEqual(canonicalRecord(legacy.blocks[0]).tags, []);
  assert.equal(validateLibrary(legacy), legacy);
  for (const field of ['category', 'tags']) {
    const invalid = structuredClone(legacy);
    invalid.blocks[0][field] = null;
    assert.throws(() => validateCatalog(invalid));
    assert.throws(() => validateLibrary(invalid));
  }
});

test('connecting an existing material updates taxonomy atomically without replacing saved content', () => {
  let catalog = fixture();
  catalog.collections.push({ schemaVersion: 1, id: 'c_other', title: 'Another context', path: 'content/collections/other/collection.json', parentId: null, items: [] });
  catalog = applyOperation(catalog, { type: 'add-block', block: material({ id: 'b_related', title: 'A related note' }), body: 'A reference.', collectionIds: [] }).catalog;
  catalog = applyOperation(catalog, { type: 'add-block', block: material({ category: 'Knowledge', tags: ['collecting'], related: ['b_related'] }), body: 'Keep this original captured text.', collectionIds: ['c_inbox'] }).catalog;
  catalog = applyOperation(catalog, { type: 'update-block', id: 'b_taxonomy', patch: { summary: 'A handwritten summary that must survive.' } }).catalog;
  const original = structuredClone(catalog.blocks.find(block => block.id === 'b_taxonomy'));
  const result = applyOperation(catalog, { type: 'connect', blockId: 'b_taxonomy', collectionIds: ['c_inbox', 'c_other'], taxonomy: { category: '  Reference  ', tags: ['Collecting', '#Archives', 'archives'] } });
  const updated = result.catalog.blocks.find(block => block.id === 'b_taxonomy');
  assert.equal(updated.category, 'Reference');
  assert.deepEqual(updated.tags, ['collecting', 'archives']);
  assert.deepEqual(updated.related, original.related);
  assert.equal(updated.body, original.body);
  assert.deepEqual(updated.summary, original.summary);
  assert.deepEqual(updated.collectionIds, ['c_inbox', 'c_other']);
  assert.equal(result.writes.length, 2, 'the material and newly connected collection are the only writes');
  const saved = JSON.parse(result.writes.find(entry => entry.path.endsWith('/block.json')).content);
  assert.equal(saved.category, 'Reference');
  assert.deepEqual(saved.tags, ['collecting', 'archives']);
  assert.equal(saved.bodyPath, 'body.md');
  assert.equal(saved.summary, undefined);
  assert.equal(catalog.blocks.find(block => block.id === 'b_taxonomy').category, 'Knowledge', 'the original snapshot is unchanged');
  assert.throws(() => applyOperation(catalog, { type: 'connect', blockId: 'b_taxonomy', collectionIds: ['c_other'], taxonomy: { tags: null } }), /Tags/);
});

test('taxonomy survives a real canonical file save and repository reload', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'jelly-taxonomy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const initial = fixture();
  const files = [
    { path: 'content/library.json', content: JSON.stringify(initial.library) },
    { path: initial.collections[0].path, content: JSON.stringify(canonicalRecord(initial.collections[0])) },
    ...applyOperation(initial, { type: 'add-block', block: material({ category: 'Knowledge', tags: ['Archives', 'collecting'] }), body: 'One source with useful context.', collectionIds: ['c_inbox'] }).writes,
  ];
  for (const entry of files) {
    const file = path.join(root, entry.path);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, entry.content);
  }
  const loaded = await loadLibrary(root);
  assert.equal(loaded.blocks[0].category, 'Knowledge');
  assert.deepEqual(loaded.blocks[0].tags, ['archives', 'collecting']);
  const original = await readFile(path.join(root, 'content/blocks/b_taxonomy/block.json'), 'utf8');
  assert.deepEqual(JSON.parse(original).tags, loaded.blocks[0].tags);
});

test('every shipped sample or imported material has a meaningful category and shared subject tags', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const catalog = await loadLibrary(root);
  const samples = catalog.blocks.filter(block => block.sample || block.source?.arena);
  assert.ok(samples.length > 0);
  for (const block of samples) {
    assert.notEqual(block.category, 'Uncategorized', block.id);
    assert.ok(block.tags.length > 0, block.id);
    assert.deepEqual(block.tags, normalizeTags(block.tags));
  }
  const tags = new Map();
  for (const block of samples) for (const tag of block.tags) tags.set(tag, (tags.get(tag) || 0) + 1);
  assert.ok([...tags.values()].some(count => count > 1), 'shared subject tags connect materials');
});
