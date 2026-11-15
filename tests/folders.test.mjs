import test from 'node:test';
import assert from 'node:assert/strict';
import { createFolderIndex } from '../web/folders.mjs';

function fixture() {
  return {
    folders: [
      { id: 'f_empty', title: 'Empty', parentId: null, order: 0 },
      { id: 'f_main', title: 'Design', parentId: null, order: 1 },
      { id: 'f_sub', title: 'Editorial', parentId: 'f_main' },
      { id: 'f_links', title: 'References', parentId: null, order: 2 }
    ],
    collections: [
      { id: 'c_one', title: 'Books', parentId: 'f_sub', items: [{ kind: 'block', id: 'b_one' }, { kind: 'collection', id: 'c_two' }] },
      { id: 'c_two', title: 'Covers', parentId: 'f_main', items: [{ kind: 'block', id: 'b_one' }, { kind: 'block', id: 'b_two' }, { kind: 'collection', id: 'c_one' }] },
      { id: 'c_empty', title: 'Unused', parentId: 'f_sub', items: [] },
      { id: 'c_external', title: 'Are.na source', parentId: 'f_links', items: [], source: { url: 'https://www.are.na/example/source', arena: { importScope: 'reference' } } }
    ],
    blocks: [{ id: 'b_one' }, { id: 'b_two' }]
  };
}

test('folder browsing shows one physical level at a time and hides empty branches', () => {
  const index = createFolderIndex(fixture());
  assert.deepEqual(index.contents().folders.map(entry => entry.record.id), ['f_main', 'f_links']);
  assert.equal(index.contents().hiddenEmpty, 1);
  assert.deepEqual(index.contents('f_main').folders.map(entry => entry.record.id), ['c_two', 'f_sub']);
  assert.deepEqual(index.contents('f_sub').folders.map(entry => entry.record.id), ['c_one']);
  assert.equal(index.contents('f_sub').hiddenEmpty, 1);
  assert.deepEqual(index.contents('f_sub', { showEmpty: true }).folders.map(entry => entry.record.id), ['c_one', 'c_empty']);
  assert.deepEqual(index.contents(null, { showEmpty: true }).folders.map(entry => entry.record.id), ['f_empty', 'f_main', 'f_links']);
});

test('folder counts deduplicate shared materials and terminate on collection cycles', () => {
  const index = createFolderIndex(fixture());
  assert.deepEqual(index.stats('folder', 'f_main'), { materials: 2, links: 0, empty: false });
  assert.deepEqual(index.stats('collection', 'c_one'), { materials: 2, links: 0, empty: false });
  assert.deepEqual(index.stats('folder', 'f_empty'), { materials: 0, links: 0, empty: true });
});

test('linked sources stay accessible as links and breadcrumbs follow physical ancestors', () => {
  const catalog = fixture(), index = createFolderIndex(catalog);
  const sources = index.contents('f_links');
  assert.equal(sources.folders.length, 0);
  assert.equal(sources.links[0].url, 'https://www.are.na/example/source');
  assert.equal(sources.hiddenEmpty, 0);
  assert.deepEqual(index.stats('folder', 'f_links'), { materials: 0, links: 1, empty: false });
  assert.deepEqual(index.ancestors(catalog.collections[0]).map(folder => folder.id), ['f_main', 'f_sub']);
  assert.equal(index.referenceURL({ source: { external: true, url: 'javascript:alert(1)' } }), '');
});
