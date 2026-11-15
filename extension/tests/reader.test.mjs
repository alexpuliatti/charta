import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { normalizeCaptureTaxonomy } from '../github.js';
import { serializeMarkdown } from '../markdown.js';
import { renderMarkdown, safeReaderUrl } from '../reader-render.js';

const read = path => fs.readFile(new URL(path, import.meta.url), 'utf8');
const [html, script, marked, purify] = await Promise.all([
  read('../reader.html'), read('../reader.js'), read('../vendor/marked.umd.js'), read('../vendor/purify.min.js')
]);
const capture = {
  operationId: 'reader-test-operation', url: 'https://example.com/article', title: 'A useful article',
  sourceTitle: 'Original title', body: 'A paragraph with **ideas**.\n\n[The source](https://example.com).',
  description: '', category: 'Reading', tags: ['design'], type: 'text', format: 'markdown',
  capturedAt: '2026-11-15T10:00:00.000Z', article: { author: 'An author', wordCount: 440 },
  extraction: { kind: 'article', method: 'defuddle' }
};
const initial = {
  capture, connected: true, collections: [{ id: 'c_inbox', title: 'Inbox', folder: 'Research' }],
  repository: { owner: 'example', repo: 'Jelly', branch: 'main' }
};

function dom() {
  const value = new JSDOM(html, { url: 'https://extension.invalid/reader.html?capture=reader-test-operation', runScripts: 'outside-only' });
  value.window.eval(marked);
  value.window.eval(purify);
  return value;
}

async function settle(predicate) {
  for (let i = 0; i < 30; i++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(predicate(), 'reader state did not settle');
}

async function reader({ state = initial, responder, missingId = false, confirm = true } = {}) {
  const value = dom();
  const { window } = value;
  const messages = [];
  const downloads = [];
  const confirmations = [];
  window.structuredClone = structuredClone;
  window.normalizeCaptureTaxonomy = normalizeCaptureTaxonomy;
  window.serializeMarkdown = serializeMarkdown;
  window.renderMarkdown = renderMarkdown;
  window.safeReaderUrl = safeReaderUrl;
  // The imported renderer receives this realm's local parser/sanitizer defaults.
  window.renderMarkdown = (body, target, options) => renderMarkdown(body, target, { ...options, parser: window.marked, sanitizer: window.DOMPurify });
  window.confirm = text => { confirmations.push(text); return confirm; };
  window.URL.createObjectURL = () => 'blob:reader-test';
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { downloads.push({ filename: this.download, href: this.href }); };
  if (missingId) window.history.replaceState({}, '', '/reader.html');
  window.chrome = { runtime: {
    getURL: path => `https://extension.invalid/${path}`,
    sendMessage: async message => {
      messages.push(structuredClone(message));
      try {
        const data = await (responder ? responder(message, state) : message.type === 'reader-init' ? structuredClone(state) : message.capture);
        return { ok: true, data };
      } catch (error) { return { ok: false, error: error.message }; }
    }
  } };
  window.eval(script.replace(/^import .*;\s*$/gm, ''));
  await settle(() => window.document.getElementById('reader').getAttribute('aria-busy') === 'false');
  return { value, window, document: window.document, messages, downloads, confirmations, $: id => window.document.getElementById(id) };
}

function input(ui, id, value) {
  ui.$(id).value = value;
  ui.$(id).dispatchEvent(new ui.window.Event('input', { bubbles: true }));
}

function submit(ui) {
  ui.$('save-form').dispatchEvent(new ui.window.Event('submit', { bubbles: true, cancelable: true }));
}

test('reader URLs reject executable schemes, credentials, and SVG images', () => {
  for (const url of [undefined, null, '', 'javascript:alert(1)', 'data:image/png;base64,eA==', 'file:///tmp/a', 'https://user:secret@example.com/a']) assert.equal(safeReaderUrl(url, capture.url), null);
  assert.equal(safeReaderUrl('../photo.jpg', capture.url, { image: true }), 'https://example.com/photo.jpg');
  assert.equal(safeReaderUrl('https://example.com/IMAGE.SVG?version=1', '', { image: true }), null);
});

test('bundled Markdown pipeline preserves article structure and strips active content', () => {
  const value = dom();
  const { window } = value;
  const target = window.document.getElementById('article-body');
  renderMarkdown(`# A heading

**Bold** and _emphasis_ with [safe](/reference).

> A quotation.

- First
- Second

\`\`\`js
const example = '<script>literal</script>';
\`\`\`

| Name | Value |
| --- | --- |
| Good | Yes |

![A photo](/photo.jpg)
![Unsafe](data:image/svg+xml,bad)

<script>window.attacked = true</script><iframe src="https://evil.invalid"></iframe>
<svg><a href="javascript:alert(1)">bad svg</a></svg>
<img src="https://example.com/ok.png" onerror="alert(1)" srcset="https://evil.invalid/x 2x">
<a href="javascript:alert(1)" onclick="alert(1)">bad link</a>
<input type="text" value="steal"><input type="checkbox" checked>
<form><button>submit</button></form><p style="background:url(https://evil.invalid)">text</p>`, target, { parser: window.marked, sanitizer: window.DOMPurify, baseUrl: capture.url });
  assert.equal(target.querySelector('h1').textContent, 'A heading');
  assert.equal(target.querySelectorAll('li').length, 2);
  assert.ok(target.querySelector('table'));
  assert.match(target.querySelector('pre code').textContent, /<script>literal<\/script>/);
  assert.equal(target.querySelector('a').href, 'https://example.com/reference');
  assert.equal(target.querySelector('a').rel, 'noopener noreferrer');
  assert.equal(target.querySelector('img').src, 'https://example.com/photo.jpg');
  assert.equal(target.querySelector('img').getAttribute('referrerpolicy'), 'no-referrer');
  assert.equal(target.querySelectorAll('script,iframe,svg,form,button,input[type=text],[onerror],[onclick],[style],[srcset]').length, 0);
  assert.equal([...target.querySelectorAll('a')].find(link => link.textContent === 'bad link').getAttribute('href'), null);
  assert.equal(target.querySelector('input').disabled, true);
  assert.equal(target.querySelectorAll('.blocked-image').length, 1);
  assert.equal(window.attacked, undefined);
  value.window.close();
});

test('reader opens a readable capture offline and still downloads Markdown', async () => {
  const ui = await reader({ state: { ...initial, connected: false, collections: [] } });
  try {
    assert.equal(ui.$('workspace').hidden, false);
    assert.equal(ui.$('article-title').textContent, capture.title);
    assert.equal(ui.$('article-body').querySelector('strong').textContent, 'ideas');
    assert.equal(ui.$('save').disabled, true);
    assert.equal(ui.$('download').disabled, false);
    assert.equal(ui.$('connection').hidden, false);
    assert.match(ui.$('settings').href, /popup\.html#settings$/);
    ui.$('download').click();
    assert.equal(ui.downloads[0].filename, 'A useful article.md');
    assert.equal(ui.messages.some(message => message.type === 'reader-save'), false);
  } finally { ui.window.close(); }
});

test('Markdown edits render safely and save their normalized taxonomy in one capture', async () => {
  const ui = await reader({ responder: async (message, state) => {
    if (message.type === 'reader-init') return structuredClone(state);
    if (message.type === 'reader-save') return { commit: 'commit-test', repository: initial.repository };
    return message.capture;
  } });
  try {
    ui.$('markdown-tab').click();
    assert.equal(ui.$('markdown-panel').hidden, false);
    input(ui, 'body', '## Edited\n\nLong article without truncation.\n\n<img src=x onerror=alert(1)>');
    input(ui, 'title', 'My title');
    input(ui, 'category', '  Web   culture ');
    input(ui, 'tags', '#Design, personal web, DESIGN');
    input(ui, 'note', 'A note for later.');
    ui.$('read-tab').click();
    assert.equal(ui.$('article-body').querySelector('h2').textContent, 'Edited');
    assert.equal(ui.$('article-body').querySelector('[onerror]'), null);
    submit(ui);
    await settle(() => ui.$('save').textContent.includes('Saved to Charta'));
    const saved = ui.messages.find(message => message.type === 'reader-save');
    assert.equal(saved.capture.title, 'My title');
    assert.equal(saved.capture.category, 'Web culture');
    assert.deepEqual(saved.capture.tags, ['design', 'personal web']);
    assert.equal(saved.capture.description, 'A note for later.');
    assert.equal(saved.capture.body, ui.$('body').value);
    assert.equal(saved.destinationId, '', 'new captures default to All materials');
    assert.equal(saved.capture.format, 'markdown');
    assert.ok(ui.messages.findIndex(message => message.type === 'reader-update') < ui.messages.findIndex(message => message.type === 'reader-save'));
    assert.equal(ui.$('body').disabled, true);
    assert.match(ui.$('commit-link').href, /\/commit\/commit-test$/);
    assert.equal(ui.$('download').disabled, false);
  } finally { ui.window.close(); }
});

test('a connected reader can save to All materials with no collections', async () => {
  const ui = await reader({ state: { ...initial, collections: [] }, responder: async (message, state) => {
    if (message.type === 'reader-init') return structuredClone(state);
    if (message.type === 'reader-save') return { commit: 'unfiled-commit', repository: initial.repository };
    return message.capture;
  } });
  try {
    assert.equal(ui.$('collections').selectedOptions[0].textContent, 'All materials');
    assert.equal(ui.$('collections').value, '');
    assert.equal(ui.$('save').disabled, false);
    submit(ui);
    await settle(() => ui.$('save').textContent.includes('Saved to Charta'));
    assert.equal(ui.messages.find(message => message.type === 'reader-save').destinationId, '');
  } finally { ui.window.close(); }
});

test('thread load-more states its coverage and preserves archive metadata', async () => {
  const thread = { ...capture, extraction: { kind: 'thread', method: 'x-thread-dom', loadedPostCount: 2, truncated: true, canLoadMore: true, warning: 'Only loaded posts are included.' } };
  const ui = await reader({ state: { ...initial, capture: thread }, responder: async (message, state) => {
    if (message.type === 'reader-init') return structuredClone(state);
    if (message.type === 'reader-refresh') return { ...state, capture: { ...thread, title: 'Source changed', body: 'More loaded posts', extraction: { ...thread.extraction, loadedPostCount: 5 } } };
    return message.capture;
  } });
  try {
    assert.match(ui.$('capture-kind').textContent, /2 captured posts/);
    assert.match(ui.$('capture-warning').textContent, /Only loaded posts/);
    assert.equal(ui.$('thread-actions').hidden, false);
    input(ui, 'title', 'My thread');
    input(ui, 'note', 'Keep this note');
    ui.$('load-more').click();
    await settle(() => ui.messages.some(message => message.type === 'reader-refresh') && ui.$('reader').getAttribute('aria-busy') === 'false');
    assert.equal(ui.messages.find(message => message.type === 'reader-refresh').loadMore, true);
    assert.equal(ui.$('body').value, 'More loaded posts');
    assert.equal(ui.$('title').value, 'My thread');
    assert.equal(ui.$('note').value, 'Keep this note');
    assert.match(ui.$('capture-kind').textContent, /5 captured posts/);
  } finally { ui.window.close(); }
});

test('refresh safeguards edited Markdown and failed saves keep it editable', async () => {
  const ui = await reader({ confirm: false, responder: async (message, state) => {
    if (message.type === 'reader-init') return structuredClone(state);
    if (message.type === 'reader-save') throw new Error('GitHub is unavailable. Your capture is queued locally.');
    return message.capture;
  } });
  try {
    input(ui, 'body', 'My edited Markdown');
    ui.$('refresh').click();
    assert.equal(ui.confirmations.length, 1);
    assert.equal(ui.messages.some(message => message.type === 'reader-refresh'), false);
    assert.equal(ui.$('body').value, 'My edited Markdown');
    submit(ui);
    await settle(() => ui.$('status').dataset.tone === 'error');
    assert.match(ui.$('status').textContent, /GitHub is unavailable/);
    assert.equal(ui.$('body').disabled, false);
    assert.equal(ui.$('body').value, 'My edited Markdown');
  } finally { ui.window.close(); }
});

test('saved captures remain frozen when the reader is reopened', async () => {
  const ui = await reader({ state: { ...initial, saved: true, receipt: { repository: initial.repository, commit: 'saved-before-reload' } } });
  try {
    assert.equal(ui.$('save').disabled, true);
    assert.equal(ui.$('body').disabled, true);
    assert.equal(ui.$('refresh').disabled, true);
    assert.match(ui.$('commit-link').href, /saved-before-reload$/);
    assert.equal(ui.$('download').disabled, false);
  } finally { ui.window.close(); }
});

test('missing capture IDs produce an actionable empty state', async () => {
  const ui = await reader({ missingId: true });
  try {
    assert.equal(ui.$('workspace').hidden, true);
    assert.match(ui.$('empty-message').textContent, /choose Reader mode/);
    assert.equal(ui.messages.length, 0);
    assert.equal(ui.$('empty-settings').hidden, false);
  } finally { ui.window.close(); }
});
