import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadLibrary, validateLibrary, buildLibrary } from '../scripts/library.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jelly-library-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (file, data) => {
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, typeof data === 'string' ? data : JSON.stringify(data));
  };
  await put('web/index.html', '<!doctype html><title>Jelly test</title>');
  await put('content/library.json', { schemaVersion: 1, title: 'Test library', inboxCollectionId: 'c_inbox' });
  await put('content/collections/inbox/collection.json', { schemaVersion: 1, id: 'c_inbox', title: 'Inbox', items: [{ kind: 'block', id: 'b_one' }] });
  await put('content/collections/research/folder.json', { schemaVersion: 1, id: 'f_research', title: 'Research' });
  await put('content/collections/research/shared/collection.json', { schemaVersion: 1, id: 'c_shared', title: 'Shared', items: [{ kind: 'block', id: 'b_one' }, { kind: 'collection', id: 'c_inbox' }] });
  await put('content/blocks/b_one/block.json', { schemaVersion: 1, id: 'b_one', type: 'text', title: 'One material', bodyPath: 'body.md', assets: [], related: [] });
  await put('content/blocks/b_one/body.md', 'One canonical material, shared twice.');
  return { root, put };
}

test('loads a canonical material once and derives memberships and folder parents', async t => {
  const { root } = await fixture(t);
  const catalog = await loadLibrary(root);
  assert.equal(catalog.blocks.length, 1);
  assert.deepEqual(catalog.blocks[0].collectionIds, ['c_inbox', 'c_shared']);
  assert.equal(catalog.collections.find(item => item.id === 'c_shared').parentId, 'f_research');
  assert.deepEqual(catalog.collections.find(item => item.id === 'c_inbox').collectionIds, ['c_shared']);
  assert.match(catalog.blocks[0].body, /canonical/);
});

test('rejects duplicate IDs, duplicate memberships, and dangling references', async t => {
  const { root } = await fixture(t);
  const catalog = await loadLibrary(root);
  const duplicate = structuredClone(catalog);
  duplicate.blocks.push({ ...duplicate.blocks[0] });
  assert.throws(() => validateLibrary(duplicate), /duplicate ID/);
  const missing = structuredClone(catalog);
  missing.collections[0].items.push({ kind: 'block', id: 'missing' });
  assert.throws(() => validateLibrary(missing), /missing block:missing/);
  const membership = structuredClone(catalog);
  membership.collections[0].items.push({ kind: 'block', id: 'b_one' });
  assert.throws(() => validateLibrary(membership), /duplicate membership/);
});

test('folder moves resolve by physical tree while collection IDs stay stable', async t => {
  const { root, put } = await fixture(t);
  await put('content/collections/references/folder.json', { schemaVersion: 1, id: 'f_references', title: 'References' });
  await put('content/collections/references/renamed/collection.json', { schemaVersion: 1, id: 'c_moved', title: 'A new name', items: [{ kind: 'collection', id: 'c_shared' }] });
  const catalog = await loadLibrary(root);
  const moved = catalog.collections.find(item => item.id === 'c_moved');
  assert.equal(moved.parentId, 'f_references');
  assert.equal(moved.items[0].id, 'c_shared');
});

test('rejects executable uploads, spoofed raster files, and path traversal', async t => {
  const { root, put } = await fixture(t);
  const catalog = await loadLibrary(root);
  for (const unsafe of ['assets/../../escape.png', 'assets/%2e%2e/escape.png', 'assets/script.svg']) {
    const changed = structuredClone(catalog);
    changed.blocks[0].assets = [{ path: unsafe, mimeType: 'image/png' }];
    assert.throws(() => validateLibrary(changed), /unsafe or unsupported asset/);
  }
  await put('content/blocks/b_one/assets/spoof.png', '<html>This is not a PNG</html>');
  await assert.rejects(loadLibrary(root), /bytes do not match/);
  await rm(path.join(root, 'content/blocks/b_one/assets/spoof.png'));
  await put('content/blocks/b_one/assets/script.html', '<script>alert(1)</script>');
  await assert.rejects(loadLibrary(root), /Unsupported file/);
});

test('supports graph cycles without recursive expansion and rejects direct self-links', async t => {
  const { root } = await fixture(t);
  const catalog = await loadLibrary(root);
  catalog.collections[0].items.push({ kind: 'collection', id: 'c_shared' });
  assert.equal(validateLibrary(catalog), catalog);
  catalog.collections[0].items.push({ kind: 'collection', id: 'c_inbox' });
  assert.throws(() => validateLibrary(catalog), /itself/);
});

test('builds an independently readable static archive and deterministic catalog', async t => {
  const { root } = await fixture(t);
  const out = path.join(root, 'dist');
  await buildLibrary(root, out);
  const first = await readFile(path.join(out, 'content/_generated/catalog.json'), 'utf8');
  assert.match(await readFile(path.join(out, 'index.html'), 'utf8'), /Jelly test/);
  assert.match(await readFile(path.join(out, 'content/blocks/b_one/body.md'), 'utf8'), /canonical/);
  await buildLibrary(root, out);
  assert.equal(await readFile(path.join(out, 'content/_generated/catalog.json'), 'utf8'), first);
  await assert.rejects(buildLibrary(root, root), /separate directory/);
  await assert.rejects(buildLibrary(root, path.join(root, 'content')), /separate directory/);
});

test('rejects symlinks in canonical content and every packaged runtime tree', async t => {
  const { root, put } = await fixture(t);
  await put('private.txt', 'This file must never enter a deployment.');
  const target = path.join(root, 'private.txt');
  await symlink(target, path.join(root, 'content/blocks/b_one/body-alias.txt'));
  await assert.rejects(loadLibrary(root), /Symbolic links/);
  await rm(path.join(root, 'content/blocks/b_one/body-alias.txt'));
  for (const directory of ['web', 'shared', 'extension']) {
    await mkdir(path.join(root, directory), { recursive: true });
    const alias = path.join(root, directory, 'private-alias.txt');
    await symlink(target, alias);
    await assert.rejects(buildLibrary(root), /Symbolic links/);
    await rm(alias);
  }
});


test('canonical content rejects source URLs containing embedded credentials', async t => {
  const { root } = await fixture(t);
  const catalog = await loadLibrary(root);
  for (const url of ['https://owner:secret@example.com/private', 'https://token@example.com/']) {
    const changed = structuredClone(catalog);
    changed.blocks[0].source = { url };
    assert.throws(() => validateLibrary(changed), /without embedded credentials/);
  }
});
