import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ArenaClient } from '../scripts/arena-client.mjs';
import { collectArena } from '../scripts/collect-arena.mjs';
import { auditSnapshot } from '../scripts/audit-arena.mjs';

const token = 'fake-test-token-not-a-real-credential';
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const make = (fetch, options = {}) => new ArenaClient(token, { fetch, pause: async () => {}, interval: 0, ...options });

test('ArenaClient pins bearer credentials to the API origin and refuses credential URLs', async () => {
  let calls = 0;
  const client = make(async (url, options) => {
    calls++;
    assert.equal(url.origin, 'https://api.are.na');
    assert.equal(new Headers(options.headers).get('authorization'), `Bearer ${token}`);
    assert.equal(new Headers(options.headers).has('cookie'), false);
    assert.equal(options.redirect, 'error');
    return json({ id: 5 });
  });
  assert.equal((await client.get('/v3/me')).id, 5);
  for (const resource of ['https://elsewhere.example/v3/me', 'https://api.are.na.evil.example/v3/me', 'http://api.are.na/v3/me', '/v2/me', 'https://user:password@api.are.na/v3/me']) {
    await assert.rejects(client.get(resource), /documented API origin/);
  }
  assert.equal(calls, 1);
});

test('rate limits and transient server failures retry with bounded waits and no secret logs', async () => {
  const waits = [], logs = [];
  const responses = [json({}, 429, { 'Retry-After': '2', 'X-RateLimit-Reset': '1' }), json({}, 503), json({ ok: true })];
  const client = make(async () => responses.shift(), { pause: async ms => waits.push(ms), log: line => logs.push(line) });
  assert.deepEqual(await client.get('/v3/me?secret=not-for-logs'), { ok: true });
  assert.deepEqual(waits, [2000, 2000]);
  assert.ok(logs.every(line => !line.includes(token) && !line.includes('not-for-logs')));
});

test('later authentication failures retain their status instead of a stale retry error', async () => {
  const responses = [json({ message: 'temporary' }, 500), json({ message: token }, 401)];
  await assert.rejects(make(async () => responses.shift()).get('/v3/me?secret=not-for-logs'), failure => failure.status === 401 && failure.message.includes('HTTP 401') && !failure.message.includes(token) && !failure.message.includes('not-for-logs'));
  let attempts = 0;
  await assert.rejects(make(async () => { attempts++; throw new Error(`Network failure ${token}`); }).get('/v3/me'), failure => !failure.message.includes(token));
  assert.equal(attempts, 5);
});

test('pagination follows metadata and reports every page without dropping resource rows', async () => {
  const seen = [], checkpoints = [];
  const client = make(async url => {
    seen.push(url.href);
    assert.equal(url.searchParams.get('per'), '50');
    assert.equal(url.searchParams.get('type'), 'Channel');
    const page = Number(url.searchParams.get('page'));
    return json({ data: page === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }], meta: { current_page: page, next_page: page === 1 ? 2 : null, total_count: 3, total_pages: 2, has_more_pages: page === 1 } });
  });
  const result = await client.list('/v3/users/5/contents?type=Channel', { onPage: (body, all) => checkpoints.push([body.meta.current_page, all.length]) });
  assert.deepEqual(result, { data: [{ id: 1 }, { id: 2 }, { id: 3 }], expected: 3, pages: 2 });
  assert.equal(seen.length, 2);
  assert.deepEqual(checkpoints, [[1, 2], [2, 3]]);
});

test('pagination rejects repeated pages, early empty pages, and malformed payloads', async () => {
  for (const [body, expression] of [
    [{ data: [{ id: 1 }], meta: { has_more_pages: true, next_page: 1 } }, /repeated page/],
    [{ data: [], meta: { has_more_pages: true, next_page: 2 } }, /ended early/],
    [{ data: {} }, /Invalid Are.na list response/],
  ]) await assert.rejects(make(async () => json(body)).list('/v3/users/5/contents'), expression);
});

const channel = (id, owner = { id: 5, type: 'User' }, counts = { blocks: 0, channels: 0, contents: 0 }) => ({ id, type: 'Channel', title: `Channel ${id}`, slug: `channel-${id}`, owner, counts, visibility: 'closed' });
const block = (id, type = 'Link', extra = {}) => ({ id, base_type: 'Block', type, title: `Block ${id}`, user: { id: 5 }, ...(type === 'Text' ? { content: { markdown: 'Saved text.', plain: 'Saved text.', html: '<p>Saved text.</p>' } } : {}), ...extra });
async function temporary(t) { const directory = await mkdtemp(path.join(tmpdir(), 'jelly-client-')); t.after(() => rm(directory, { recursive: true, force: true })); return path.join(directory, 'snapshot.json'); }

test('account collection excludes email, deduplicates blocks, and does not crawl external reference channels', async t => {
  const output = await temporary(t), calls = [];
  const own = channel(1, undefined, { blocks: 2, channels: 2, contents: 4 });
  const group = channel(2, { id: 7, type: 'Group' }, { blocks: 2, channels: 0, contents: 2 });
  const reference = channel(99, { id: 100, type: 'User' });
  const lists = {
    '/v3/users/5/contents?type=Channel': [own],
    '/v3/users/5/contents?type=Block': [block(10), block(11, 'Image'), block(12, 'Text')],
    '/v3/users/5/groups': [{ id: 7, name: 'A group', slug: 'a-group', secret: 'not-needed' }],
    '/v3/groups/7/contents?type=Channel': [own, group],
    '/v3/channels/1/contents?sort=position_asc': [block(10), block(20, 'Link', { user: { id: 6 } }), reference, group],
    '/v3/channels/2/contents?sort=position_asc': [block(20, 'Link', { user: { id: 6 } }), block(21, 'Text', { user: { id: 6 } })],
  };
  const client = {
    get: async resource => {
      calls.push(resource);
      if (resource === '/v3/me') return { data: { id: 5, name: 'Owner', slug: 'owner', email: 'private@example.test', counts: { channels: 1 } } };
      if (resource === '/v3/channels/1') return own;
      if (resource === '/v3/channels/2') return { data: group };
      if (resource === '/v3/blocks/11') return block(11, 'Image', { image: { src: 'https://cdn.example/original.png' } });
      throw new Error(`Unexpected get ${resource}`);
    },
    list: async resource => { calls.push(resource); assert.ok(resource in lists, `Unexpected list ${resource}`); return { data: lists[resource], expected: lists[resource].length }; },
  };
  const snapshot = await collectArena(client, output, { log: () => {} });
  assert.equal(snapshot.blocks.length, 5);
  assert.equal(snapshot.blocks.filter(item => item.id === 20).length, 1);
  assert.deepEqual(Object.keys(snapshot.contents).sort(), ['1', '2']);
  assert.equal(snapshot.channels.find(item => item.id === 1).importScope, 'account');
  assert.equal(snapshot.channels.find(item => item.id === 2).importScope, 'group');
  assert.equal(snapshot.channels.find(item => item.id === 99).importScope, 'reference');
  assert.ok(!calls.some(resource => resource.startsWith('/v3/channels/99')));
  assert.equal(snapshot.blocks.find(item => item.id === 11).image.src, 'https://cdn.example/original.png');
  const text = await readFile(output, 'utf8');
  assert.ok(!text.includes('private@example.test'));
  assert.equal(JSON.parse(text).user.email, undefined);
  assert.deepEqual(snapshot.groups, [{ id: 7, name: 'A group', slug: 'a-group' }]);
  assert.equal((await stat(output)).mode & 0o077, 0);
});

test('a cached snapshot cannot silently mix another account into an existing import', async t => {
  const output = await temporary(t);
  await writeFile(output, JSON.stringify({ user: { id: 1 } }));
  let listed = false;
  await assert.rejects(collectArena({ get: async () => ({ id: 2 }), list: async () => { listed = true; } }, output, { log: () => {} }), /another account/);
  assert.equal(listed, false);
});

test('snapshot reconciliation distinguishes missing channel rows from complete material rows', () => {
  const own = channel(1, undefined, { blocks: 2, channels: 3, contents: 5 });
  own.importScope = 'account';
  const reference = { ...channel(99, { id: 100, type: 'User' }), importScope: 'reference' };
  const snapshot = { user: { id: 5, counts: { channels: 1 } }, channels: [own, reference], blocks: [block(10), block(20, 'Text', { user: { id: 6 } }), block(30)], contents: { 1: [block(10), block(20, 'Text', { user: { id: 6 } }), reference] }, inventory: { createdBlocks: { fetched: 2, expected: 2 } } };
  const audit = auditSnapshot(snapshot);
  assert.deepEqual(audit.blockConnections, { reported: 2, returned: 2, allCountsMatch: true });
  assert.equal(audit.missingChannelRefCount, 2);
  assert.deepEqual(audit.missingChannelRefs, [{ channelId: 1, title: 'Channel 1', reported: 3, returned: 1, missing: 2 }]);
  assert.equal(audit.uniqueBlocks, 3);
  assert.equal(audit.userCreatedBlockCount, 2);
  assert.equal(audit.blocksOutsidePrimaryChannels, 1);
  assert.deepEqual(audit.unresolvedMaterialReferenceIds, []);
  assert.deepEqual(audit.unresolvedChannelReferenceIds, []);
  assert.match(audit.conclusion, /do not establish/);
});
