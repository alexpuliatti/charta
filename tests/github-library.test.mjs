import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyOperation } from '../shared/model.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'jelly-github-'));
await cp(new URL('../web/', import.meta.url), root, { recursive: true });
await cp(new URL('../shared/', import.meta.url), path.join(root, 'shared'), { recursive: true });
const { GitHubLibrary } = await import(pathToFileURL(path.join(root, 'github.mjs')));
const { canonicalFiles } = await import(pathToFileURL(path.join(root, 'operations.mjs')));
test.after(() => rm(root, { recursive: true, force: true }));

const config = { owner: 'owner', repo: 'jelly', branch: 'notes/main' };
const token = 'test-session-token';
const hash = text => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex');
function fixture() {
  let catalog = { schemaVersion: 1, sourceCommit: 'published', library: { schemaVersion: 1, title: 'Test', inboxCollectionId: 'c_inbox' }, folders: [], collections: [
    { schemaVersion: 1, id: 'c_inbox', title: 'Inbox', path: 'content/collections/inbox/collection.json', parentId: null, items: [] },
    { schemaVersion: 1, id: 'c_other', title: 'Other', path: 'content/collections/other/collection.json', parentId: null, items: [] }
  ], blocks: [] };
  catalog = applyOperation(catalog, { type: 'add-block', block: { id: 'b_one', title: 'One', category: 'Reading', tags: ['ideas'] }, body: 'Saved text', collectionIds: ['c_inbox', 'c_other'] }).catalog;
  catalog = applyOperation(catalog, { type: 'add-block', block: { id: 'b_two', title: 'Two', related: ['b_one'] }, collectionIds: ['c_other'] }).catalog;
  catalog.blocks[0].assets = [{ path: 'assets/original.png', mimeType: 'image/png' }];
  catalog.blocks[0].summary = { text: 'Kept summary', provider: 'manual' };
  catalog.blocks[1].suggestedRelated = [{ id: 'b_one', reason: 'Related reading' }];
  return catalog;
}
function github(catalog = fixture(), options = {}) {
  let head = 'head0', sequence = 0;
  const blobs = new Map(), trees = new Map(), commits = new Map(), requests = [];
  const initial = canonicalFiles(catalog);
  initial.set('content/blocks/b_one/assets/original.png', 'image-bytes');
  initial.set('README.md', 'Keep source files');
  const makeTree = files => {
    const entries = new Map();
    for (const [file, text] of files) { const sha = hash(text); blobs.set(sha, text); entries.set(file, { path: file, mode: '100644', type: 'blob', sha, size: Buffer.byteLength(text) }); }
    const sha = `tree${sequence++}`; trees.set(sha, entries); return sha;
  };
  commits.set(head, { tree: { sha: makeTree(initial) } });
  const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const filesAt = () => new Map([...trees.get(commits.get(head).tree.sha)].map(([file, entry]) => [file, blobs.get(entry.sha)]));
  const external = (file, update) => {
    const files = filesAt(); files.set(file, JSON.stringify(update(JSON.parse(files.get(file))), null, 2) + '\n');
    head = `external${sequence++}`; commits.set(head, { tree: { sha: makeTree(files) } });
  };
  let conflict = options.conflictOnce, loseResponse = options.loseResponse;
  const fetchImpl = async (url, init) => {
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    assert.equal(init.credentials, 'omit');
    const endpoint = url.slice('https://api.github.com/repos/owner/jelly'.length);
    const body = init.body && JSON.parse(init.body);
    requests.push({ endpoint, method: init.method, body });
    if (endpoint === '/git/blobs' && init.method === 'POST') {
      assert.equal(body.encoding, 'base64');
      const bytes = Buffer.from(body.content, 'base64'), sha = hash(bytes);
      blobs.set(sha, bytes); return response({ sha }, 201);
    }
    if (endpoint === '/git/ref/heads/notes/main') return response({ object: { sha: head } });
    if (endpoint.startsWith('/git/commits/') && init.method === 'GET') return response(commits.get(endpoint.split('/').at(-1)));
    if (endpoint.startsWith('/git/trees/') && init.method === 'GET') return response({ tree: [...trees.get(endpoint.split('/').at(-1).split('?')[0]).values()], truncated: options.truncated || false });
    if (endpoint.startsWith('/git/blobs/')) {
      const text = blobs.get(endpoint.split('/').at(-1));
      assert.notEqual(text, undefined);
      return response({ encoding: 'base64', content: Buffer.from(text).toString('base64'), size: Buffer.byteLength(text) });
    }
    if (endpoint === '/git/trees' && init.method === 'POST') {
      if (options.deny) return response({}, 403);
      const entries = new Map(trees.get(body.base_tree));
      for (const change of body.tree) {
        assert.ok(change.path.startsWith('content/'));
        if (change.sha === null) { assert.ok(entries.has(change.path)); entries.delete(change.path); }
        else if (change.sha) { assert.ok(blobs.has(change.sha)); entries.set(change.path, { path: change.path, mode: '100644', type: 'blob', sha: change.sha }); }
        else { const sha = hash(change.content); blobs.set(sha, change.content); entries.set(change.path, { path: change.path, mode: '100644', type: 'blob', sha }); }
      }
      const sha = `tree${sequence++}`; trees.set(sha, entries); return response({ sha }, 201);
    }
    if (endpoint === '/git/commits' && init.method === 'POST') {
      const sha = `commit${sequence++}`; commits.set(sha, { tree: { sha: body.tree }, parents: body.parents }); return response({ sha }, 201);
    }
    if (endpoint === '/git/refs/heads/notes/main' && init.method === 'PATCH') {
      assert.equal(body.force, false);
      if (conflict) { conflict = false; external('content/blocks/b_one/block.json', block => ({ ...block, description: 'Edited in the extension' })); return response({}, 422); }
      assert.deepEqual(commits.get(body.sha).parents, [head]);
      head = body.sha;
      if (loseResponse) { loseResponse = false; throw new TypeError('Network response lost'); }
      return response({ object: { sha: head } });
    }
    assert.fail(`Unexpected GitHub request: ${init.method} ${endpoint}`);
  };
  return { fetchImpl, requests, filesAt, external };
}

test('GitHub connection verifies cached content by blob hash and reads newer remote records', async () => {
  const seed = fixture(), api = github(seed);
  api.external('content/blocks/b_one/block.json', block => ({ ...block, title: 'Remote title' }));
  const client = new GitHubLibrary(config, token, api);
  const current = await client.open(seed);
  assert.equal(current.blocks.find(b => b.id === 'b_one').title, 'Remote title');
  assert.equal(api.requests.filter(r => r.endpoint.startsWith('/git/blobs/')).length, 1, 'only the changed record requires a blob request');
  assert.ok(api.requests.every(r => r.method === 'GET'));
  assert.equal(JSON.stringify(client).includes(token), false, 'credentials are not serializable');
});

test('renames commit atomically, preserve other fields, and never force the branch', async () => {
  const api = github(), client = new GitHubLibrary(config, token, api);
  const before = await client.open(fixture());
  const result = await client.apply(before, { type: 'update-block', id: 'b_one', patch: { title: 'Renamed ✓' } });
  assert.ok(result.commitURL.includes('/commit/'));
  const files = api.filesAt();
  assert.equal(JSON.parse(files.get('content/blocks/b_one/block.json')).title, 'Renamed ✓');
  assert.equal(files.get('content/blocks/b_one/body.md'), 'Saved text');
  assert.equal(files.get('README.md'), 'Keep source files');
  assert.equal(api.requests.filter(r => r.method === 'PATCH').length, 1);
});

test('removal affects only its collection; deleting a material clears its files and incoming links', async () => {
  const api = github(), client = new GitHubLibrary(config, token, api);
  let current = await client.open(fixture());
  current = (await client.apply(current, { type: 'remove-connection', kind: 'block', id: 'b_one', collectionId: 'c_inbox' })).catalog;
  assert.deepEqual(current.blocks.find(b => b.id === 'b_one').collectionIds, ['c_other']);
  const result = await client.apply(current, { type: 'delete-block', id: 'b_one' });
  assert.equal(result.catalog.blocks.length, 1);
  assert.deepEqual(result.catalog.blocks[0].related, []);
  assert.deepEqual(result.catalog.blocks[0].suggestedRelated, []);
  assert.equal([...api.filesAt().keys()].some(file => file.startsWith('content/blocks/b_one/')), false);
  assert.ok(result.catalog.collections.every(c => c.items.every(item => item.id !== 'b_one')));
});

test('a branch race retries against current files and preserves independent edits', async () => {
  const api = github(fixture(), { conflictOnce: true }), client = new GitHubLibrary(config, token, api);
  const before = await client.open(fixture());
  const result = await client.apply(before, { type: 'update-block', id: 'b_one', patch: { title: 'Website rename' } });
  const block = result.catalog.blocks.find(b => b.id === 'b_one');
  assert.equal(block.title, 'Website rename');
  assert.equal(block.description, 'Edited in the extension');
  assert.equal(api.requests.filter(r => r.method === 'PATCH').length, 2);
});

test('a conflicting rename or a denied write never reports a successful save', async () => {
  const api = github(), client = new GitHubLibrary(config, token, api);
  const before = await client.open(fixture());
  api.external('content/blocks/b_one/block.json', block => ({ ...block, title: 'Someone else renamed it' }));
  await assert.rejects(client.apply(before, { type: 'update-block', id: 'b_one', patch: { title: 'My title' } }), /changed outside Charta/);
  assert.ok(api.requests.every(r => r.method === 'GET'));
  const denied = github(fixture(), { deny: true }), deniedClient = new GitHubLibrary(config, token, denied);
  const original = await deniedClient.open(fixture());
  await assert.rejects(deniedClient.apply(original, { type: 'delete-block', id: 'b_one' }), /GitHub denied/);
  assert.equal(original.blocks.length, 2);
  assert.ok(denied.filesAt().has('content/blocks/b_one/block.json'));
});

test('a lost acknowledgement is recovered without duplicating a successful commit', async () => {
  const api = github(fixture(), { loseResponse: true }), client = new GitHubLibrary(config, token, api);
  const result = await client.apply(await client.open(fixture()), { type: 'update-block', id: 'b_one', patch: { title: 'Confirmed' } });
  assert.ok(result.commit);
  assert.equal(api.requests.filter(r => r.method === 'PATCH').length, 1);
});

test('incomplete repository trees are rejected before any changes', async () => {
  const api = github(fixture(), { truncated: true }), client = new GitHubLibrary(config, token, api);
  await assert.rejects(client.open(fixture()), /incomplete file tree/);
  assert.ok(api.requests.every(r => r.method === 'GET'));
});

test('store remembers only connection preferences, serializes saves, and requires reconnect after reload', async () => {
  const savedGlobals = new Map(['document', 'location', 'localStorage', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const storage = new Map();
  try {
    globalThis.document = { baseURI: 'https://example.test/Jelly/' };
    globalThis.location = { pathname: '/Jelly/' };
    globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
    const api = github(); globalThis.fetch = api.fetchImpl;
    const { LibraryStore } = await import(pathToFileURL(path.join(root, 'store.mjs')));
    const store = new LibraryStore(fixture(), 'browser');
    await store.connectGitHub(config, token);
    const states = []; store.onStatus = state => states.push(state);
    await Promise.all([
      store.apply({ type: 'update-block', id: 'b_one', patch: { title: 'Queued rename' } }),
      store.apply({ type: 'remove-connection', kind: 'block', id: 'b_one', collectionId: 'c_inbox' })
    ]);
    assert.equal(store.catalog.blocks.find(b => b.id === 'b_one').title, 'Queued rename');
    assert.deepEqual(store.catalog.blocks.find(b => b.id === 'b_one').collectionIds, ['c_other']);
    assert.deepEqual(states, ['saving', 'saved', 'saving', 'saved']);
    assert.equal([...storage.values()].some(value => value.includes(token)), false);
    const reopened = new LibraryStore(fixture(), 'browser');
    await assert.rejects(reopened.apply({ type: 'delete-block', id: 'b_one' }), /Reconnect GitHub/);
    assert.equal(reopened.saveState, 'error');
    await store.disconnectGitHub();
    assert.equal(store.mode, 'browser');
    assert.equal(store.github, null);
  } finally {
    for (const [key, descriptor] of savedGlobals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});

test('resource uploads commit exact binary bytes and folder metadata together, preserving concurrent edits', async () => {
  const before = fixture(), api = github(before, { conflictOnce: true });
  const client = new GitHubLibrary(config, token, api);
  const current = await client.open(before);
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const operation = { type: 'import-resource', block: { id: 'b_upload', type: 'image', title: 'Pasted art', category: 'Culture', tags: ['art'] }, destinationPath: ['Culture', 'Art'], attachments: [{ name: 'Pasted image.png', type: 'image/png', data: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') }], classification: { reason: 'Visual art.', method: 'local-clip-v1', confidence: .8 } };
  const result = await client.apply(current, operation);
  assert.deepEqual(api.filesAt().get('content/blocks/b_upload/assets/original.png'), bytes);
  assert.ok(result.catalog.collections.some(collection => collection.title === 'Art' && collection.items.some(item => item.id === 'b_upload')));
  assert.equal(result.catalog.blocks.find(block => block.id === 'b_one').description, 'Edited in the extension');
  assert.equal(result.catalog.blocks.length, 3);
  const writes = api.requests.filter(request => request.endpoint === '/git/trees' && request.method === 'POST');
  assert.equal(writes.length, 2, 'a branch race replays the complete save against the latest tree');
  assert.ok(writes.every(request => request.body.tree.some(entry => entry.path.endsWith('original.png') && entry.sha && !('content' in entry))));
  const commits = api.requests.filter(request => request.endpoint === '/git/commits').length;
  const replay = await client.apply(result.catalog, operation);
  assert.equal(replay.alreadySaved, true);
  assert.equal(api.requests.filter(request => request.endpoint === '/git/commits').length, commits);
});

test('canvas commits preserve concurrent library edits, survive reconnect, and reject stale board updates', async () => {
  const seed = applyOperation(fixture(), { type: 'create-canvas', id: 'canvas_github', title: 'Research board' }).catalog;
  const api = github(seed, { conflictOnce: true }), client = new GitHubLibrary(config, token, api);
  const before = await client.open(seed), canvas = structuredClone(before.library.canvases[0]);
  canvas.nodes = [{ id: 'card_one', kind: 'note', title: 'Connected thought', text: 'Keep the original idea.', color: 'sage', x: -120, y: 80, width: 280, height: 250 }, { id: 'card_two', kind: 'material', blockId: 'b_one', x: 300, y: 80, width: 280, height: 250 }];
  canvas.edges = [{ id: 'edge_one', from: 'card_one', to: 'card_two', label: 'Reference' }];
  const saved = await client.apply(before, { type: 'save-canvas', id: canvas.id, expectedRevision: 1, canvas });
  assert.equal(saved.catalog.library.canvases[0].revision, 2);
  assert.equal(saved.catalog.blocks.find(block => block.id === 'b_one').description, 'Edited in the extension');
  const reopened = await new GitHubLibrary(config, token, api).open(saved.catalog);
  assert.deepEqual(reopened.library.canvases, saved.catalog.library.canvases);
  const disk = JSON.parse(api.filesAt().get('content/library.json'));
  assert.deepEqual(disk.canvases[0].nodes, canvas.nodes);
  await assert.rejects(client.apply(before, { type: 'save-canvas', id: canvas.id, expectedRevision: 1, canvas: { ...canvas, title: 'A stale rename' } }), /changed outside Charta/);
  const deleted = await client.apply(reopened, { type: 'delete-canvas', id: canvas.id, expectedRevision: 2 });
  assert.deepEqual(deleted.catalog.library.canvases, []);
  assert.equal(deleted.catalog.blocks.length, seed.blocks.length);
});
