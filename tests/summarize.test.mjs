import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { summarizeLibrary, summaryInputHash } from '../scripts/summarize.mjs';

const env = { SUMMARY_API_KEY: 'test-only-placeholder', SUMMARY_ENDPOINT: 'https://summary.example/v1/chat/completions', SUMMARY_MODEL: 'configured-test-model' };

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jelly-summary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (name, data) => {
    const file = path.join(root, name); await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, typeof data === 'string' ? data : JSON.stringify(data));
  };
  await put('content/library.json', { schemaVersion: 1, title: 'Library', inboxCollectionId: 'c_inbox' });
  await put('content/collections/inbox/collection.json', { schemaVersion: 1, id: 'c_inbox', title: 'Inbox', items: [{ kind: 'block', id: 'b_one' }] });
  await put('content/blocks/b_one/block.json', { schemaVersion: 1, id: 'b_one', title: 'A captured note', type: 'text', bodyPath: 'body.md', assets: [], related: [] });
  await put('content/blocks/b_one/body.md', 'This is a long captured note about preserving a source alongside the thing that was saved. Connections between references make it easier to find useful context later.');
  const summary = async () => JSON.parse(await readFile(path.join(root, 'content/blocks/b_one/summary.json'), 'utf8'));
  return { root, put, summary };
}

test('missing configuration is a no-op without sending network requests', async t => {
  const { root } = await fixture(t);
  const result = await summarizeLibrary(root, { env: {}, fetch: () => { throw new Error('must not run'); } });
  assert.equal(result.configured, false);
});

test('persists validated output, hashes inputs, and skips unchanged work', async t => {
  const { root, summary } = await fixture(t);
  let calls = 0;
  const fetch = async (url, options) => {
    calls++;
    assert.equal(url, env.SUMMARY_ENDPOINT);
    const body = JSON.parse(options.body);
    assert.equal(body.model, env.SUMMARY_MODEL);
    assert.equal(body.tools, undefined);
    assert.equal(body.max_completion_tokens, 512);
    assert.equal(body.store, false);
    assert.match(body.messages[1].content, /capturedText/);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ summary: 'A saved source gains context through connections to other material.' }) } }] }) };
  };
  assert.equal((await summarizeLibrary(root, { env, fetch })).generated, 1);
  assert.equal((await summary()).provider, 'summary.example');
  assert.equal((await summary()).editedByOwner, false);
  assert.equal((await summarizeLibrary(root, { env, fetch })).generated, 0);
  assert.equal(calls, 1);
});

test('preserves manually edited summaries and never sends them to the provider', async t => {
  const { root, put, summary } = await fixture(t);
  await put('content/blocks/b_one/summary.json', { text: 'My own description.', editedByOwner: true, provider: 'manual' });
  await summarizeLibrary(root, { env, fetch: () => { throw new Error('must not run'); } });
  assert.equal((await summary()).text, 'My own description.');
});

test('provider failures are recorded without preventing library publication', async t => {
  const { root, summary } = await fixture(t);
  const result = await summarizeLibrary(root, { env, fetch: async () => ({ ok: false, status: 429 }) });
  assert.equal(result.failed, 1);
  assert.equal((await summary()).status, 'failed');
  assert.equal((await summary()).text, '');
});

test('does not summarize missing text or overwrite output after a concurrent source edit', async t => {
  const { root, put, summary } = await fixture(t);
  await put('content/blocks/b_one/body.md', 'Only a title.');
  const short = await summarizeLibrary(root, { env, fetch: () => { throw new Error('must not run'); } });
  assert.equal(short.unavailable, 1);
  assert.equal((await summary()).status, 'insufficient-content');
  await put('content/blocks/b_one/body.md', 'This is enough new captured text to summarize. '.repeat(8));
  const changed = await summarizeLibrary(root, { env, fetch: async () => {
    await put('content/blocks/b_one/body.md', 'The source changed while the model was thinking. '.repeat(8));
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"summary":"This response now describes an older version of the source."}' } }] }) };
  } });
  assert.equal(changed.generated, 0);
  assert.equal((await summary()).status, 'insufficient-content');
});

test('hashes the actual bounded input rather than unrelated metadata', () => {
  const block = { title: 'Title', body: 'A'.repeat(15000), description: 'A private owner note.' };
  assert.equal(summaryInputHash(block), summaryInputHash({ ...block, body: 'A'.repeat(12000) + 'different tail', description: 'Changed note' }));
  assert.notEqual(summaryInputHash(block), summaryInputHash({ ...block, title: 'Changed title' }));
});
