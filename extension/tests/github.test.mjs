import test from 'node:test';
import assert from 'node:assert/strict';
import { JellyRepository, GitHubError, safeSource, validateCapture, validateRepository, normalizeCaptureTaxonomy } from '../github.js';
import { serializeMarkdown } from '../markdown.js';

const config = { owner: 'example', repo: 'Jelly', branch: 'main' };
const destinationPath = 'content/collections/research/interfaces/collection.json';
const capture = {
  operationId: 'draft-operation-123',
  type: 'link',
  url: 'https://example.com/a?topic=design',
  title: 'A useful reference — café',
  sourceTitle: 'Original title',
  body: 'Captured text with provenance.',
  description: 'Why I kept this.',
  capturedAt: '2026-11-15T10:00:00.000Z'
};

test('a reader save commits the exact downloadable Markdown and durable article metadata', async () => {
  const fake = fakeGitHub();
  const client = new JellyRepository(config, 'mock-token', { fetchImpl: fake.fetchImpl });
  const article = validateCapture({ ...capture, format: 'markdown', type: 'text', category: 'Design', tags: ['reading'],
    body: '# The idea\n\n' + 'An article with **formatting**. '.repeat(1200),
    article: { author: 'Ada', published: '2026-11-14', wordCount: 6000 },
    extraction: { kind: 'thread', method: 'jelly-thread', loadedPostCount: 12, truncated: true, warning: 'Loaded posts only.' }
  });
  const result = await client.save(article, 'c_interfaces');
  const prefix = `content/blocks/${result.blockId}/`;
  const block = JSON.parse(fake.files()[prefix + 'block.json']);
  assert.equal(block.contentFormat, 'markdown');
  assert.equal(block.article.author, 'Ada');
  assert.equal(block.capture.loadedPostCount, 12);
  assert.deepEqual(block.tags, ['reading']);
  assert.equal(fake.files()[prefix + 'body.md'], serializeMarkdown(article));
  assert.match(fake.files()[prefix + 'body.md'], /\*\*formatting\*\*/);
  assert.throws(() => validateCapture({ ...article, body: 'x'.repeat(500001) }), /too long/);
  assert.throws(() => validateCapture({ ...article, body: '😀'.repeat(400000) }), /too long/);
});

function fakeGitHub({ conflict = false, losePatchResponse = false, withoutCollections = false } = {}) {
  const trees = new Map();
  const commits = new Map();
  const blobs = new Map();
  const calls = [];
  let sequence = 0;
  let head = 'head-initial';
  let patchCount = 0;
  let currentFiles = {
    'content/library.json': JSON.stringify({ schemaVersion: 1, inboxCollectionId: 'c_interfaces' }),
    [destinationPath]: JSON.stringify({ schemaVersion: 1, id: 'c_interfaces', title: 'Interfaces', items: [{ kind: 'block', id: 'b_existing' }] })
  };
  if (withoutCollections) {
    currentFiles = { 'content/library.json': JSON.stringify({ schemaVersion: 1, title: 'Charta' }) };
  }
  trees.set('tree-initial', structuredClone(currentFiles));
  commits.set(head, { tree: 'tree-initial' });
  const response = (data, status = 200, headers = {}) => ({ ok: status < 400, status, headers: new Headers(headers), json: async () => data });

  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.github.com');
    assert.equal(init.headers.Authorization, 'Bearer mock-token');
    const path = parsed.pathname.replace('/repos/example/Jelly', '');
    const method = init.method;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body });
    if (method === 'GET' && path === '/git/ref/heads/main') return response({ object: { sha: head } });
    if (method === 'GET' && path.startsWith('/git/commits/')) return response({ tree: { sha: commits.get(path.split('/').at(-1)).tree } });
    if (method === 'GET' && path.startsWith('/git/trees/')) {
      const files = trees.get(path.split('/').at(-1));
      return response({ truncated: false, tree: Object.entries(files).map(([path, text]) => {
        const sha = `blob-${++sequence}`;
        blobs.set(sha, text);
        return { path, type: 'blob', mode: '100644', sha };
      }) });
    }
    if (method === 'GET' && path.startsWith('/git/blobs/')) {
      const text = blobs.get(path.split('/').at(-1));
      return response({ encoding: 'base64', content: Buffer.from(text).toString('base64'), size: Buffer.byteLength(text) });
    }
    if (method === 'POST' && path === '/git/trees') {
      const sha = `tree-${++sequence}`;
      const files = structuredClone(trees.get(body.base_tree));
      for (const change of body.tree) {
        assert.ok(change.path.startsWith('content/'));
        assert.equal(change.mode, '100644');
        files[change.path] = change.content;
      }
      trees.set(sha, files);
      return response({ sha });
    }
    if (method === 'POST' && path === '/git/commits') {
      const sha = `commit-${++sequence}`;
      commits.set(sha, { tree: body.tree, parent: body.parents[0] });
      return response({ sha });
    }
    if (method === 'PATCH' && path === '/git/refs/heads/main') {
      patchCount++;
      assert.equal(body.force, false);
      if (conflict && patchCount === 1) {
        const concurrentFiles = structuredClone(trees.get(commits.get(head).tree));
        const collection = JSON.parse(concurrentFiles[destinationPath]);
        collection.items.push({ kind: 'block', id: 'b_concurrent' });
        concurrentFiles[destinationPath] = JSON.stringify(collection);
        trees.set('tree-concurrent', concurrentFiles);
        commits.set('head-concurrent', { tree: 'tree-concurrent' });
        head = 'head-concurrent';
        return response({ message: 'Update is not a fast forward' }, 422);
      }
      assert.equal(commits.get(body.sha).parent, head);
      head = body.sha;
      currentFiles = trees.get(commits.get(head).tree);
      if (losePatchResponse && patchCount === 1) throw new TypeError('Network response lost');
      return response({ object: { sha: head } });
    }
    throw new Error(`Unexpected mock request: ${method} ${path}`);
  };
  return { fetchImpl, calls, files: () => currentFiles, head: () => head };
}

test('capture and repository validation reject unsupported sources and paths', () => {
  assert.equal(safeSource('javascript:alert(1)'), null);
  assert.equal(safeSource('https://user:password@example.com'), null);
  assert.throws(() => validateRepository({ owner: 'bad/owner', repo: 'Jelly' }), /owner/);
  assert.throws(() => validateRepository({ ...config, branch: '../main' }), /branch/);
  assert.throws(() => validateCapture({ ...capture, operationId: '../escape' }), /operation ID/);
  assert.throws(() => validateCapture({ ...capture, type: 'text', body: ' ' }), /selection is empty/);
});

test('a save atomically writes metadata, captured text, and collection membership', async () => {
  const fake = fakeGitHub();
  const client = new JellyRepository(config, 'mock-token', { fetchImpl: fake.fetchImpl });
  const result = await client.save(capture, 'c_interfaces');
  assert.equal(result.alreadySaved, false);
  const blockPath = `content/blocks/${result.blockId}/block.json`;
  const block = JSON.parse(fake.files()[blockPath]);
  assert.equal(block.title, capture.title);
  assert.equal(block.source.url, capture.url);
  assert.equal(block.operationId, capture.operationId);
  assert.equal(block.category, 'Uncategorized', 'legacy captures retain an explicit fallback category');
  assert.deepEqual(block.tags, []);
  assert.equal(fake.files()[blockPath.replace('block.json', 'body.md')], capture.body + '\n');
  assert.deepEqual(JSON.parse(fake.files()[destinationPath]).items, [
    { kind: 'block', id: 'b_existing' },
    { kind: 'block', id: result.blockId }
  ]);
  assert.equal(fake.calls.filter(call => call.method === 'PATCH').length, 1);
  const treeWrite = fake.calls.find(call => call.method === 'POST' && call.path === '/git/trees');
  assert.equal(treeWrite.body.tree.length, 3);
});

test('capture taxonomy normalizes names and rejects malformed or excessive values', () => {
  const normalized = normalizeCaptureTaxonomy({ ...capture, category: '  Web   culture ', tags: [' #Personal   web ', 'personal web', 'Ｄｅｓｉｇｎ', 'Collecting'] });
  assert.equal(normalized.category, 'Web culture');
  assert.deepEqual(normalized.tags, ['personal web', 'design', 'collecting']);
  assert.equal(validateCapture(capture).category, 'Uncategorized');
  assert.equal(validateCapture({ ...capture, category: ' ' }).category, 'Uncategorized');
  assert.deepEqual(validateCapture(capture).tags, []);
  for (const category of [null, {}, 'a'.repeat(81)]) assert.throws(() => validateCapture({ ...capture, category }), /category/);
  for (const tags of [null, 'design', [null], [''], ['a'.repeat(49)], Array.from({ length: 21 }, (_, i) => `tag ${i}`)]) assert.throws(() => validateCapture({ ...capture, tags }), /tag/i);
});

test('a taxonomy-aware capture commits normalized category and tags in the same atomic record', async () => {
  const fake = fakeGitHub();
  const client = new JellyRepository(config, 'mock-token', { fetchImpl: fake.fetchImpl });
  const result = await client.save({ ...capture, category: '  Design  ', tags: ['Interfaces', '  personal   web ', 'interfaces'] }, 'c_interfaces');
  const block = JSON.parse(fake.files()[`content/blocks/${result.blockId}/block.json`]);
  assert.equal(block.category, 'Design');
  assert.deepEqual(block.tags, ['interfaces', 'personal web']);
  assert.equal(fake.calls.filter(call => call.method === 'PATCH').length, 1);
  const postCount = fake.calls.filter(call => call.method === 'POST').length;
  const replay = await client.save({ ...capture, category: 'Changed category', tags: ['changed'] }, 'c_interfaces');
  assert.equal(replay.alreadySaved, true);
  assert.equal(fake.calls.filter(call => call.method === 'POST').length, postCount);
  assert.equal(JSON.parse(fake.files()[`content/blocks/${result.blockId}/block.json`]).category, 'Design', 'retry must not silently overwrite an existing material taxonomy');
});

test('a non-fast-forward retry preserves another capture and reuses the operation ID', async () => {
  const fake = fakeGitHub({ conflict: true });
  const client = new JellyRepository(config, 'mock-token', { fetchImpl: fake.fetchImpl, pause: async () => {} });
  const result = await client.save(capture, 'c_interfaces');
  const members = JSON.parse(fake.files()[destinationPath]).items;
  assert.deepEqual(members.map(member => member.id), ['b_existing', 'b_concurrent', result.blockId]);
  assert.equal(fake.calls.filter(call => call.method === 'PATCH').length, 2);
  assert.equal(Object.keys(fake.files()).filter(path => path.endsWith('/block.json')).length, 1);
});

test('replaying a saved operation creates no new commit or duplicated membership', async () => {
  const fake = fakeGitHub();
  const client = new JellyRepository(config, 'mock-token', { fetchImpl: fake.fetchImpl });
  const first = await client.save(capture, 'c_interfaces');
  const postCount = fake.calls.filter(call => call.method === 'POST').length;
  const second = await client.save({ ...capture, title: 'Later edit must not overwrite a completed capture' }, 'c_interfaces');
  assert.equal(second.alreadySaved, true);
  assert.equal(second.blockId, first.blockId);
  assert.equal(fake.calls.filter(call => call.method === 'POST').length, postCount);
  assert.equal(JSON.parse(fake.files()[`content/blocks/${first.blockId}/block.json`]).title, capture.title);
});

test('retry after an ambiguous successful ref update discovers the saved operation', async () => {
  const fake = fakeGitHub({ losePatchResponse: true });
  const client = new JellyRepository(config, 'mock-token', { fetchImpl: fake.fetchImpl });
  await assert.rejects(client.save(capture, 'c_interfaces'), /Network response lost/);
  const postCount = fake.calls.filter(call => call.method === 'POST').length;
  const result = await client.save(capture, 'c_interfaces');
  assert.equal(result.alreadySaved, true);
  assert.equal(fake.calls.filter(call => call.method === 'POST').length, postCount);
});

test('a missing destination fails without mutating GitHub', async () => {
  const fake = fakeGitHub();
  const client = new JellyRepository(config, 'mock-token', { fetchImpl: fake.fetchImpl });
  await assert.rejects(client.save(capture, 'c_deleted'), /destination collection/);
  assert.equal(fake.calls.filter(call => call.method !== 'GET').length, 0);
});

test('All materials saves commit without a collection and retries create no duplicate commit', async () => {
  for (const withoutCollections of [false, true]) {
    const fake = fakeGitHub({ withoutCollections });
    const client = new JellyRepository(config, 'mock-token', { fetchImpl: fake.fetchImpl });
    const originalCollection = fake.files()[destinationPath];
    const result = await client.save(capture, '');
    assert.equal(result.collectionId, '');
    assert.equal(result.alreadySaved, false);
    assert.equal(JSON.parse(fake.files()[`content/blocks/${result.blockId}/block.json`]).title, capture.title);
    assert.equal(fake.files()[destinationPath], originalCollection);
    const writes = fake.calls.find(call => call.method === 'POST' && call.path === '/git/trees').body.tree;
    assert.deepEqual(writes.map(w => w.path), [`content/blocks/${result.blockId}/block.json`, `content/blocks/${result.blockId}/body.md`]);
    const postCount = fake.calls.filter(call => call.method === 'POST').length;
    assert.equal((await client.save(capture, '')).alreadySaved, true);
    assert.equal(fake.calls.filter(call => call.method === 'POST').length, postCount);
  }
});

test('an expired token returns a reconnect message without including the token', async () => {
  const client = new JellyRepository(config, 'a-secret-value', {
    fetchImpl: async () => ({ ok: false, status: 401, headers: new Headers(), json: async () => ({ message: 'Bad credentials' }) })
  });
  await assert.rejects(client.snapshot(), error => error instanceof GitHubError && error.status === 401 && /Reconnect/.test(error.message) && !error.message.includes('a-secret-value'));
});
