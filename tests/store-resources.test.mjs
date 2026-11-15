import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

test('browser uploads survive reopening and export includes original bytes without embedding base64 into block JSON', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'charta-browser-resources-'));
  const names = ['document', 'location', 'localStorage', 'fetch'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const originalFetch = globalThis.fetch;
  const storage = new Map();
  const catalog = { schemaVersion: 1, sourceCommit: 'published', library: { schemaVersion: 1, title: 'Uploads' }, folders: [], collections: [], blocks: [] };
  try {
    await cp(new URL('../web/', import.meta.url), path.join(root, 'web'), { recursive: true });
    await cp(new URL('../shared/', import.meta.url), path.join(root, 'web/shared'), { recursive: true });
    globalThis.document = { baseURI: 'https://example.test/charta/' };
    globalThis.location = { pathname: '/charta/' };
    globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
    globalThis.fetch = async input => {
      const url = String(input);
      if (url.startsWith('blob:')) return originalFetch(input);
      return url.endsWith('/api/library') ? new Response('', { status: 404 }) : new Response(JSON.stringify(catalog), { headers: { 'Content-Type': 'application/json' } });
    };
    const { LibraryStore } = await import(pathToFileURL(path.join(root, 'web/store.mjs')));
    const store = new LibraryStore(catalog, 'browser');
    await store.apply({ type: 'import-resource', block: { id: 'b_browser_image', type: 'image', title: 'Pasted image', category: 'Culture', tags: ['art'] }, destinationPath: ['Culture', 'Art'], attachments: [{ name: 'Pasted image.png', type: 'image/png', data: png.toString('base64') }] });
    const reopened = await LibraryStore.open();
    const image = reopened.catalog.blocks[0];
    assert.deepEqual(Buffer.from(await (await fetch(image._assetURLs['assets/original.png'])).arrayBuffer()), png);
    assert.equal(image.collectionIds.length, 1);
    const zip = Buffer.from(await (await reopened.exportContent({ download: false })).arrayBuffer());
    assert.ok(zip.includes(png), 'the exact file bytes are included in the export');
    const blockFile = Buffer.from(JSON.stringify(image));
    assert.ok(blockFile.includes(Buffer.from('_assetData')), 'browser draft keeps recoverable file data');
    const localHeader = zip.indexOf(Buffer.from('content/blocks/b_browser_image/block.json'));
    const nextHeader = zip.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), localHeader);
    assert.equal(zip.subarray(localHeader, nextHeader).includes(Buffer.from(png.toString('base64'))), false, 'exported canonical JSON contains asset references, not browser storage data');
    for (const state of [store.catalog, reopened.catalog]) for (const block of state.blocks) for (const url of Object.values(block._assetURLs || {})) URL.revokeObjectURL(url);
  } finally {
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
    await rm(root, { recursive: true, force: true });
  }
});

test('local repository saves send a bounded base snapshot for conflict detection', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'charta-store-conflicts-'));
  const names = ['document', 'location', 'localStorage', 'fetch'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const catalog = { schemaVersion: 1, sourceCommit: 'local', library: { schemaVersion: 1, title: 'Local' }, folders: [], collections: [], blocks: [
    { schemaVersion: 1, id: 'b_one', type: 'text', title: 'Original title', category: 'Notes', tags: ['ideas'], body: 'Saved text', path: 'content/blocks/b_one/block.json', assets: [], related: [], _assetData: { 'assets/original.png': 'DO_NOT_RESEND' }, _assetURLs: { 'assets/original.png': 'blob:temporary' } },
    { schemaVersion: 1, id: 'b_other', type: 'text', title: 'Unrelated material', category: 'Notes', tags: ['ideas'], body: 'UNRELATED_BODY', path: 'content/blocks/b_other/block.json', assets: [], related: [] },
  ] };
  try {
    await cp(new URL('../web/', import.meta.url), path.join(root, 'web'), { recursive: true });
    await cp(new URL('../shared/', import.meta.url), path.join(root, 'web/shared'), { recursive: true });
    globalThis.document = { baseURI: 'http://localhost/' };
    globalThis.location = { pathname: '/' };
    globalThis.localStorage = { getItem: () => null };
    let sent;
    globalThis.fetch = async (url, options) => {
      assert.ok(String(url).endsWith('/api/mutate'));
      sent = JSON.parse(options.body);
      return Response.json({ error: 'This item changed outside Charta.' }, { status: 400 });
    };
    const { LibraryStore } = await import(pathToFileURL(path.join(root, 'web/store.mjs')));
    const store = new LibraryStore(catalog, 'repository');
    await assert.rejects(store.apply({ type: 'update-block', id: 'b_one', patch: { title: 'Changed title' } }), /changed outside/);
    assert.equal(sent.baseCatalog.blocks[0].title, 'Original title');
    assert.equal(sent.baseCatalog.blocks.length, 1);
    assert.equal(JSON.stringify(sent).includes('DO_NOT_RESEND'), false);
    assert.equal(JSON.stringify(sent).includes('blob:temporary'), false);
    assert.equal(JSON.stringify(sent).includes('UNRELATED_BODY'), false);
    assert.equal(store.catalog.blocks[0].title, 'Original title', 'failed saves preserve the open snapshot');
    assert.equal(store.saveState, 'error');
  } finally {
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
    await rm(root, { recursive: true, force: true });
  }
});
