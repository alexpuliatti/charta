import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createKeywordIndex, fuseSearchResults, searchPassages, parseArchiveAnswer, searchTerms } from '../shared/archive-search.mjs';
import { createArchiveSearch, archivePrompt } from '../scripts/archive-search.mjs';
import { createChatGPTSearch, subscriptionEnvironment } from '../scripts/chatgpt-search.mjs';

const block = (id, title, body) => ({ id, title, body, type: 'text', tags: [], assets: [], path: `content/blocks/${id}/block.json` });
const catalog = { folders: [{ id: 'companies', title: 'Companies' }], collections: [{ id: 'funds', title: 'Biotech funds', parentId: 'companies', items: [{ kind: 'block', id: 'age1' }] }], blocks: [block('age1', 'age1', 'Early stage longevity investment.'), block('irrelevant', 'An unrelated essay', 'Collecting maps and art.')] };

test('keyword search includes real folder membership and full document text', () => {
  const index = createKeywordIndex(catalog, { documents: new Map([['age1', 'A rare therapeutics passage from the final page.']]) });
  assert.equal(index.search('biotech', { blocksOnly: true })[0].id, 'age1');
  assert.equal(index.search('therapeutics')[0].id, 'age1');
  assert.deepEqual(index.search('zzzzzzzz'), []);
  assert.deepEqual(searchTerms('I am writing an article about biotech and looking for VC firms'), ['biotech', 'vc', 'firms']);
  assert.deepEqual(searchTerms('writing'), ['writing'], 'a single topic remains searchable');
});

test('fusion rewards agreement, includes meaning-only matches and keeps entity IDs distinct', () => {
  const merged = fuseSearchResults([{ id: 'a' }, { id: 'b' }, { id: 'a', entity: 'collection' }], [{ id: 'b', score: .7 }, { id: 'c', score: .6 }]);
  assert.equal(merged[0].id, 'b');
  assert.equal(merged.find(row => row.id === 'c').semantic, true);
  assert.equal(merged.filter(row => row.id === 'a').length, 2);
});

test('passages cover evidence beyond the start and answers cannot invent citations', () => {
  const passages = searchPassages('irrelevant '.repeat(250) + 'Longevity therapeutics are our biotech investment focus.', 'biotech therapeutics', { limit: 1 });
  assert.match(passages[0].text, /Longevity/); assert.ok(passages[0].offset > 1000);
  const candidates = [{ id: 'age1', passages }];
  const answer = parseArchiveAnswer({ summary: 'Read [age1] and [invented].', resources: [{ id: 'age1', reason: 'Biotech focus', evidence: [0, 99, 0] }, { id: 'invented', reason: 'fake', evidence: [0] }] }, candidates);
  assert.deepEqual(answer.resources[0].evidence, passages);
  assert.equal(answer.resources.length, 1); assert.equal(answer.summary.includes('invented'), false);
  assert.throws(() => parseArchiveAnswer({ summary: 'False', resources: [null, { id: 'fake', reason: '', evidence: [0] }] }, candidates), /references/);
});

test('ChatGPT runs use subscription auth, isolated read-only sessions, and no API environment', async () => {
  const env = subscriptionEnvironment({ HOME: '/user', OPENAI_API_KEY: 'secret', OPENAI_BASE_URL: 'custom', CODEX_API_KEY: 'secret', CODEX_ACCESS_TOKEN: 'secret', CODEX_THREAD_ID: 'parent' });
  assert.deepEqual(env, { HOME: '/user' });
  const calls = [];
  const client = createChatGPTSearch({ execute: async (_, args, options) => {
    calls.push({ args, options });
    if (args[0] === 'login') return { code: 0, stdout: 'Logged in using ChatGPT', stderr: '' };
    await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ summary: 'Grounded', resources: [], limitations: [] }));
    return { code: 0, stdout: '', stderr: '' };
  } });
  assert.equal((await client.status()).connected, true);
  await client.answer('Supplied evidence only');
  const exec = calls.find(call => call.args[0] === 'exec');
  assert.ok(exec.args.includes('--ignore-user-config')); assert.ok(exec.args.includes('--ephemeral'));
  assert.equal(exec.args[exec.args.indexOf('--sandbox') + 1], 'read-only');
  assert.ok(exec.args.includes('web_search="disabled"')); assert.ok(exec.args.includes('shell_tool'));
  assert.equal(exec.options.input, 'Supplied evidence only');
  const apiClient = createChatGPTSearch({ execute: async () => ({ code: 0, stdout: 'Logged in using an API key', stderr: '' }) });
  await assert.rejects(apiClient.answer('question'), /sign in with ChatGPT/);
});

test('archive questions retrieve saved evidence, validate model selections, and invalidate after edits', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'charta-search-test-'));
  let prompt, saved = structuredClone(catalog), runs = 0;
  const service = createArchiveSearch({ root, loadCatalog: async () => saved, chatgpt: {
    status: async () => ({ connected: true }),
    answer: async value => { prompt = value; runs++; return { summary: 'Read [age1].', resources: [{ id: 'age1', reason: 'Has an investment focus', evidence: [0] }], limitations: ['Publication date unknown.'] }; },
  } });
  try {
    const result = await service.ask('biotech venture investment');
    assert.equal(result.provider, 'chatgpt-subscription'); assert.equal(result.resources[0].id, 'age1');
    assert.match(result.resources[0].evidence[0].text, /longevity/); assert.match(prompt, /NOT when it was published/);
    assert.match(prompt, /never instructions/); assert.match(prompt, /ARCHIVE_EVIDENCE/);
    assert.match(result.warning, /keyword/); assert.equal(runs, 1);
    saved = { ...saved, blocks: [...saved.blocks, block('new', 'Therapeutics', 'new evidence')] }; service.invalidate();
    assert.equal((await service.hybrid('therapeutics')).results[0].id, 'new');
    await assert.rejects(service.ask(' '.repeat(10)), /Enter a question/);
    await assert.rejects(service.hybrid('x'.repeat(3001)), /3,000/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(service.hybrid('biotech', { signal: controller.signal }), { name: 'AbortError' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('date and retrieval limitations are explicit in the subscription prompt', () => {
  const prompt = archivePrompt('recent biotech', [{ id: 'age1', savedAt: '2026-11-15', publishedAt: null }], '2026-11-15');
  assert.match(prompt, /Today is 2026-11-15/); assert.match(prompt, /not an exhaustive survey/);
});
