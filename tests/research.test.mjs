import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { setupResearch } from '../web/research.mjs';

const key = 'charta.research.v1';
const catalog = { blocks: [{ id: 'one', title: 'A saved source' }] };
const answer = { summary: 'A useful answer [one]', resources: [{ id: 'one', reason: 'Relevant evidence', evidence: [{ text: 'The original passage.' }] }], limitations: [] };
function fixture(saved) {
  const dom = new JSDOM('<a data-research-link>Research</a><main class="research-content"></main>', { url: 'http://localhost/' });
  if (saved) dom.window.localStorage.setItem(key, saved);
  const { document } = dom.window, root = document.querySelector('main'), requests = [], pending = [], mounts = [], destroyed = [], routes = [];
  const animation = { mountArchiveThinking(element) { mounts.push(element); element.append(document.createElement('canvas')); return { destroy() { destroyed.push(element); element.replaceChildren(); } }; } };
  let loader = () => Promise.resolve(animation);
  const research = setupResearch({ document, getCatalog: () => catalog,
    navigate(hash) { routes.push(hash); research.render(root, hash.split('/')[2]); },
    fetch(url, options) { requests.push({ url, options }); return new Promise(resolve => pending.push(resolve)); },
    loadThinking: () => loader(),
  });
  return { dom, document, root, research, requests, pending, mounts, destroyed, animation, routes, loader(value) { loader = value; } };
}

test('research survives leaving the view and reloads with full answers and draft recovery', async () => {
  const f = fixture(); let reloaded;
  try {
    f.research.start('Explore this idea'); await pause(0);
    const id = f.routes[0].split('/')[2];
    assert.equal(f.mounts.length, 1);
    assert.equal(f.root.querySelector('.archive-thinking-visual').getAttribute('aria-hidden'), 'true');
    f.research.unmount(); f.root.className = '';
    assert.equal(f.destroyed.length, 1, 'leaving releases the WebGL animation');
    assert.equal(f.requests[0].options.signal.aborted, false);
    f.pending[0](Response.json(answer)); await pause(0);
    assert.equal(f.document.querySelector('[data-research-link]').dataset.running, '0');
    f.root.className = 'research-content'; f.research.render(f.root, id);
    assert.match(f.root.textContent, /A useful answer \[1\]/);
    f.research.render(f.root, 'new');
    const input = f.root.querySelector('textarea'); input.value = 'A draft to keep'; input.dispatchEvent(new f.dom.window.Event('input'));
    reloaded = fixture(f.dom.window.localStorage.getItem(key));
    reloaded.research.render(reloaded.root, id);
    assert.match(reloaded.root.textContent, /The original passage/);
    assert.equal(reloaded.requests.length, 0, 'restoring an answer never reruns it');
    reloaded.research.render(reloaded.root, 'new');
    assert.equal(reloaded.root.querySelector('textarea').value, 'A draft to keep');
  } finally { f.research.unmount(); f.dom.window.close(); reloaded?.dom.window.close(); }
});

test('cancellation, retry, failed imports, and late answers preserve request and animation lifetimes', async () => {
  const f = fixture();
  try {
    f.research.start('Cancel and retry'); await pause(0);
    f.root.querySelector('[data-research-cancel]').click();
    assert.equal(f.requests[0].options.signal.aborted, true); assert.equal(f.destroyed.length, 1);
    assert.match(f.root.textContent, /Research cancelled/);
    f.root.querySelector('[data-research-retry]').click(); await pause(0);
    f.pending[0](Response.json({ summary: 'CANCELLED ANSWER', resources: [] })); await pause(0);
    assert.equal(f.root.textContent.includes('CANCELLED ANSWER'), false);
    assert.equal(f.document.querySelector('[data-research-link]').dataset.running, '1', 'old requests cannot clear a retried request');
    f.pending[1](Response.json({ error: 'ChatGPT is unavailable.' }, { status: 503 })); await pause(0);
    assert.match(f.root.textContent, /ChatGPT is unavailable/); assert.equal(f.destroyed.length, 2);
    let finishLoading;
    f.loader(() => new Promise(resolve => { finishLoading = resolve; }));
    f.root.querySelector('[data-research-retry]').click();
    f.root.querySelector('[data-research-cancel]').click(); finishLoading(f.animation); await pause(0);
    assert.equal(f.mounts.length, 2, 'late modules cannot mount into cancelled research');
    f.pending[2](Response.json({ summary: 'LATE ANSWER', resources: [] })); await pause(0);
    assert.equal(f.root.textContent.includes('LATE ANSWER'), false);
    f.loader(() => Promise.reject(new Error('Animation unavailable')));
    f.root.querySelector('[data-research-retry]').click(); await pause(0);
    assert.ok(f.root.querySelector('.archive-thinking-fallback'));
    f.pending[3](Response.json(answer)); await pause(0);
    assert.match(f.root.textContent, /A useful answer/);
    assert.equal(f.root.querySelector('.archive-thinking-visual'), null);
  } finally { f.research.unmount(); f.dom.window.close(); }
});

test('refreshing unfinished research retains the question and requires an explicit retry', async () => {
  const f = fixture(JSON.stringify({ entries: [{ id: 'unfinished', query: 'My unfinished question', createdAt: new Date().toISOString(), status: 'running' }] }));
  try {
    f.research.render(f.root);
    assert.match(f.root.textContent, /My unfinished question/); assert.match(f.root.textContent, /interrupted when the page closed/);
    assert.equal(f.requests.length, 0);
    f.root.querySelector('[data-research-retry]').click(); assert.equal(f.requests.length, 1);
    f.pending[0](Response.json(answer)); await pause(0);
    assert.match(f.root.textContent, /A useful answer/);
  } finally { f.research.unmount(); f.dom.window.close(); }
});

test('background completion preserves the next draft and its keyboard focus', async () => {
  const f = fixture();
  try {
    f.research.start('First question'); f.research.render(f.root, 'new');
    const input = f.root.querySelector('textarea'); input.value = 'Next question'; input.dispatchEvent(new f.dom.window.Event('input')); input.focus(); input.setSelectionRange(4, 4);
    f.pending[0](Response.json(answer)); await pause(0);
    assert.equal(f.root.querySelector('textarea').value, 'Next question');
    assert.equal(f.document.activeElement, f.root.querySelector('textarea'));
    assert.equal(f.document.activeElement.selectionStart, 4);
  } finally { f.research.unmount(); f.dom.window.close(); }
});

test('storage failures are visible while research remains available in the current tab', async () => {
  const f = fixture();
  try {
    f.dom.window.Storage.prototype.setItem = () => { throw new Error('Storage full'); };
    f.research.start('Keep this question');
    assert.match(f.root.querySelector('.research-storage').textContent, /Browser storage unavailable/);
    f.pending[0](Response.json(answer)); await pause(0);
    f.research.render(f.root); assert.match(f.root.textContent, /A useful answer/);
  } finally { f.research.unmount(); f.dom.window.close(); }
});
