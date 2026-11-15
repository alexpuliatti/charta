import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, writeFile, readFile, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadLibrary } from '../scripts/library.mjs';

// Exercise the browser File System Access adapter against real isolated files.
function directoryHandle(directory, failures = {}) {
  const missing = error => { if (error.code === 'ENOENT') throw new DOMException('File not found', 'NotFoundError'); throw error; };
  return {
    kind: 'directory',
    async getDirectoryHandle(name, { create = false } = {}) {
      const target = path.join(directory, name);
      try { if (create) await mkdir(target, { recursive: true }); if (!(await stat(target)).isDirectory()) throw new Error('Expected a directory'); }
      catch (error) { missing(error); }
      return directoryHandle(target, failures);
    },
    async getFileHandle(name, { create = false } = {}) {
      const target = path.join(directory, name);
      try { if (create) await writeFile(target, '', { flag: 'a' }); else await stat(target); }
      catch (error) { missing(error); }
      return {
        kind: 'file',
        async getFile() { return new File([await readFile(target)], name); },
        async createWritable() {
          let pending;
          return { async write(value) { pending = value; }, async close() { if (failures.once && target.endsWith(failures.once)) { failures.once = ''; throw new Error('Disk full'); } await writeFile(target, pending instanceof ArrayBuffer ? new Uint8Array(pending) : pending); }, async abort() {} };
        }
      };
    },
    async removeEntry(name) { try { await rm(path.join(directory, name)); } catch (error) { missing(error); } },
    async *entries() {
      for (const entry of await readdir(directory, { withFileTypes: true })) yield [entry.name, entry.isDirectory() ? directoryHandle(path.join(directory, entry.name)) : await this.getFileHandle(entry.name)];
    }
  };
}

test('connected-folder deletion removes binary attachments, saved text, summaries, and extra sidecars', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'jelly-folder-save-'));
  const globals = new Map(['document', 'location', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    await cp(new URL('../web/', import.meta.url), path.join(root, 'web'), { recursive: true });
    await cp(new URL('../shared/', import.meta.url), path.join(root, 'web/shared'), { recursive: true });
    const put = async (file, value) => { const target = path.join(root, file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)); };
    await put('content/library.json', { schemaVersion: 1, title: 'Test', inboxCollectionId: 'c_inbox' });
    await put('content/collections/inbox/collection.json', { schemaVersion: 1, id: 'c_inbox', title: 'Inbox', items: [{ kind: 'block', id: 'b_media' }] });
    await put('content/blocks/b_media/block.json', { schemaVersion: 1, id: 'b_media', title: 'Media', type: 'file', category: 'Reading', tags: [], assets: [{ path: 'assets/original.bin', mimeType: 'application/octet-stream' }], bodyPath: 'body.md', related: [] });
    await put('content/blocks/b_media/body.md', 'Saved note');
    await put('content/blocks/b_media/summary.json', { text: 'A summary', provider: 'manual' });
    await put('content/blocks/b_media/assets/original.bin', Buffer.from([0, 255, 1, 128]));
    await put('content/blocks/b_media/extracted.json', { text: 'An extra text sidecar' });
    globalThis.document = { baseURI: 'https://example.test/Jelly/' };
    globalThis.location = { pathname: '/Jelly/' };
    globalThis.localStorage = { getItem: () => null };
    const { LibraryStore } = await import(pathToFileURL(path.join(root, 'web/store.mjs')));
    const store = new LibraryStore(await loadLibrary(root), 'folder');
    store.directoryHandle = directoryHandle(root);
    await store.apply({ type: 'delete-block', id: 'b_media' });
    const loaded = await loadLibrary(root);
    assert.equal(loaded.blocks.length, 0);
    assert.deepEqual(loaded.collections[0].items, []);
    assert.deepEqual(loaded.extraFiles, []);
    assert.deepEqual(await readdir(path.join(root, 'content/blocks/b_media/assets')), []);
    assert.equal(store.saveState, 'saved');
  } finally {
    for (const [key, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    await rm(root, { recursive: true, force: true });
  }
});

test('folder uploads roll back failed file writes and preserve exact bytes on retry and reload', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'charta-folder-upload-'));
  const globals = new Map(['document', 'location', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    await cp(new URL('../web/', import.meta.url), path.join(root, 'web'), { recursive: true });
    await cp(new URL('../shared/', import.meta.url), path.join(root, 'web/shared'), { recursive: true });
    await mkdir(path.join(root, 'content'), { recursive: true });
    await writeFile(path.join(root, 'content/library.json'), JSON.stringify({ schemaVersion: 1, title: 'Uploads' }));
    globalThis.document = { baseURI: 'https://example.test/charta/' };
    globalThis.location = { pathname: '/charta/' };
    globalThis.localStorage = { getItem: () => null };
    const { LibraryStore } = await import(pathToFileURL(path.join(root, 'web/store.mjs')));
    const store = new LibraryStore(await loadLibrary(root), 'folder');
    store.directoryHandle = directoryHandle(root, { once: 'original.png' });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    const operation = { type: 'import-resource', block: { id: 'b_upload', type: 'image', title: 'A saved image', category: 'Culture', tags: ['art'] }, destinationPath: ['Culture', 'Art'], attachments: [{ name: 'Original.png', type: 'image/png', data: png.toString('base64') }] };
    await assert.rejects(store.apply(operation), /Disk full/);
    const failed = await loadLibrary(root);
    assert.equal(failed.blocks.length, 0);
    assert.equal(failed.collections.length, 0);
    assert.deepEqual(failed.extraFiles, []);
    await store.apply(operation);
    const loaded = await loadLibrary(root);
    assert.equal(loaded.blocks.length, 1);
    assert.deepEqual(await readFile(path.join(root, 'content/blocks/b_upload/assets/original.png')), png);
    assert.equal(store.catalog.blocks[0]._assetURLs['assets/original.png'].startsWith('blob:'), true);
    for (const url of Object.values(store.catalog.blocks[0]._assetURLs)) URL.revokeObjectURL(url);
  } finally {
    for (const [key, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    await rm(root, { recursive: true, force: true });
  }
});
