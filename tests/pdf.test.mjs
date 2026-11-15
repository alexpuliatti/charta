import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { emptyPDFReading } from '../shared/pdf-reading.mjs';

const modules = await mkdtemp(path.join(tmpdir(), 'charta-pdf-test-'));
await cp(new URL('../web/', import.meta.url), modules, { recursive: true });
await cp(new URL('../shared/', import.meta.url), path.join(modules, 'shared'), { recursive: true });
const { mountPDFReader, pdfSelection } = await import(pathToFileURL(path.join(modules, 'pdf.mjs')));
after(() => rm(modules, { recursive: true, force: true }));

const baseURI = 'https://example.test/Jelly/';
const asset = { path: 'assets/book.pdf', mimeType: 'application/pdf', role: 'original' };
const block = { id: 'b_pdf', title: 'A <book>', path: 'content/blocks/b_pdf/block.json', assets: [asset], category: 'Writing' };
async function waitFor(predicate) { for (let i = 0; i < 100; i++) { if (predicate()) return; await pause(5); } assert.fail('The PDF reader did not settle.'); }

async function setup(t, options = {}) {
  const dom = new JSDOM('<!doctype html><section class="pdf-reader"></section>', { url: baseURI, pretendToBeVisual: true });
  const doc = dom.window.document, container = doc.querySelector('section'), engines = [], saves = [], stored = new Map(), timers = [];
  if (options.preferences) dom.window.localStorage.setItem('charta:pdf:/Jelly/:b_pdf:assets/book.pdf', JSON.stringify(options.preferences));
  if (options.manualTimers) t.mock.method(dom.window, 'setTimeout', (callback, delay) => { timers.push({ callback, delay }); return timers.length; });
  const loadEngine = async () => ({ async createPDFEngine(params) {
    if (options.fail) throw new Error('PDF unavailable');
    const calls = [];
    const engine = { calls, params, destroyed: false, ready: Promise.resolve(), goToPage(n) { calls.push(['page', n]); params.onPage(Math.max(1, Math.min(193, n))); }, setScale(v) { calls.push(['scale', v]); params.onScale(Number(v) || 1); }, zoom(v) { calls.push(['zoom', v]); params.onScale(v > 0 ? 1.15 : .85); }, find(q, o) { calls.push(['find', q, o]); }, outline: async () => [{ title: 'Introduction', dest: 'intro', items: [] }], destination(d) { calls.push(['destination', d]); }, refresh() {}, destroy() { this.destroyed = true; params.pages.replaceChildren(); } };
    params.pages.innerHTML = '<div class="page" data-page-number="1"><div class="textLayer"><span>A passage worth keeping</span></div></div>';
    engines.push(engine);
    engine.ready = Promise.resolve().then(() => { params.onReady(193); params.onScale(1); if (options.autoRender !== false) params.onRendered(1); });
    return engine;
  } });
  const reader = mountPDFReader(container, { ...block, ...options.block }, baseURI, { loadEngine,
    getReading: file => stored.get(file.path) || emptyPDFReading(),
    async saveReading(file, reading, revision) { saves.push({ file, reading: structuredClone(reading), revision }); if (options.save) return options.save(file, reading, revision); const saved = { ...structuredClone(reading), revision: revision + 1 }; stored.set(file.path, saved); return saved; },
  });
  t.after(() => { reader.destroy(); dom.window.close(); });
  await waitFor(() => engines.length || container.querySelector('.pdf-reader-retry').hidden === false);
  await pause(0);
  const $ = selector => container.querySelector(selector);
  return { dom, doc, container, reader, engines, saves, stored, timers, $, click: action => $(`[data-reader="${action}"]`).click(), input(selector, value) { const node = $(selector); node.value = value; node.dispatchEvent(new dom.window.Event('input', { bubbles: true })); } };
}

test('PDF dialogs remain visible above their backdrops with the custom reading room', async () => {
  const styles = await Promise.all(['styles.css', 'media.css', 'workspace.css', 'motion.css', 'artefact.css', 'pdf.css'].map(file => readFile(new URL(`../web/${file}`, import.meta.url), 'utf8')));
  const dom = new JSDOM(`<!doctype html><style>${styles.join('\n')}</style><dialog class="detail-dialog artefact-dialog has-pdf" open></dialog>`, { url: baseURI });
  try { const dialog = dom.window.document.querySelector('dialog'), style = dom.window.getComputedStyle(dialog); assert.equal(style.opacity, '1'); assert.equal(style.display, 'flex'); dialog.removeAttribute('open'); assert.equal(dom.window.getComputedStyle(dialog).display, 'none'); } finally { dom.window.close(); }
});

test('real retrieval progress stays visible until a PDF page has rendered', async t => {
  const f = await setup(t, { autoRender: false });
  assert.equal(f.$('.pdf-reader-feedback').hidden, false);
  assert.equal(f.$('.pdf-reader-title').textContent, 'A <book>');
  assert.equal(f.$('iframe,script'), null, 'the document is rendered in Charta rather than a native iframe');
  f.engines[0].params.onProgress(25, 100);
  assert.equal(f.$('progress').value, 25);
  assert.match(f.$('.pdf-reader-status').textContent, /25%/);
  assert.equal(f.container.getAttribute('aria-busy'), 'true');
  f.engines[0].params.onRendered(1);
  assert.equal(f.$('.pdf-reader-feedback').hidden, true);
  assert.equal(f.container.hasAttribute('aria-busy'), false);
});

test('page, zoom, contents and document search controls use the loaded document', async t => {
  const f = await setup(t), engine = f.engines[0];
  f.click('next'); assert.equal(f.$('.reader-page-input').value, '2');
  f.$('.reader-page-input').value = '999'; f.$('.reader-page-input').dispatchEvent(new f.dom.window.Event('change'));
  assert.equal(f.$('.reader-page-input').value, '193');
  f.click('zoom-in'); assert.equal(f.$('.reader-zoom').value, '1.15');
  f.click('contents'); f.$('.reader-outline-item').click(); assert.ok(engine.calls.some(c => c[0] === 'destination' && c[1] === 'intro'));
  f.click('search'); f.input('.reader-search input', 'platform'); f.click('find-next');
  assert.ok(engine.calls.some(c => c[0] === 'find' && c[1] === 'platform' && c[2]?.again));
  f.$('.reader-search input').dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(f.$('.reader-search').hidden, true);
});

test('paper theme and reading position are remembered per document on this device', async t => {
  const f = await setup(t, { preferences: { page: 7, zoom: '1.25', theme: 'cream' } });
  assert.equal(f.container.dataset.paper, 'night', 'previously seeded warm paper switches to the new dark default');
  assert.equal(f.$('.reader-page-input').value, '7', 'theme migration preserves the reading position');
  f.click('appearance'); f.$('[data-reader-theme=sage]').click(); f.engines[0].params.onPage(23);
  const value = JSON.parse(f.dom.window.localStorage.getItem('charta:pdf:/Jelly/:b_pdf:assets/book.pdf'));
  assert.equal(value.page, 23); assert.equal(value.theme, 'sage'); assert.equal(f.container.dataset.paper, 'sage');
});

test('notebook keyboard navigation and text-selection shortcuts do not turn PDF pages', async t => {
  const f = await setup(t), engine = f.engines[0];
  f.$('[data-reader-tab=highlights]').dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert.equal(f.$('[data-reader-tab=notes]').getAttribute('aria-selected'), 'true');
  f.$('.reader-scroll').dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(engine.calls.filter(call => call[0] === 'page').length, 0);
  f.$('[data-reader=close-panel]').focus(); f.click('close-panel'); assert.equal(f.doc.activeElement, f.$('[data-reader=panel]'));
});

test('notes save to the library and failed saves retain recoverable edits and retry', async t => {
  let attempts = 0;
  const f = await setup(t, { save: async (file, reading, revision) => { if (++attempts === 1) throw new Error('Disk unavailable'); return { ...reading, revision: revision + 1 }; } });
  f.$('[data-reader-tab=notes]').click(); f.input('.reader-document-notes', 'An idea to keep'); await f.reader.flush();
  assert.match(f.$('.reader-save-status').textContent, /Disk unavailable/);
  assert.equal(f.$('.reader-document-notes').value, 'An idea to keep');
  assert.ok(f.dom.window.sessionStorage.length);
  f.click('save'); await f.reader.flush();
  assert.equal(f.saves.length, 2); assert.equal(f.saves[1].reading.notes, 'An idea to keep');
  assert.equal(f.dom.window.sessionStorage.length, 0); assert.equal(f.$('.reader-save').textContent, 'Saved');
});

test('selecting PDF text creates a persistent highlight with a margin note and normalized coordinates', async t => {
  const f = await setup(t), page = f.$('.page'), span = f.$('.textLayer span');
  page.getBoundingClientRect = () => ({ left: 100, top: 50, width: 600, height: 800 });
  const range = f.doc.createRange(); range.selectNodeContents(span);
  range.getClientRects = () => [{ left: 160, top: 150, width: 180, height: 20 }];
  range.getBoundingClientRect = () => ({ left: 160, top: 150, width: 180, height: 20 });
  const selection = f.dom.window.getSelection(); selection.addRange(range);
  assert.deepEqual(pdfSelection(selection, f.$('.reader-pages')).rects[0], [.1, .125, .3, .025]);
  f.$('.reader-scroll').dispatchEvent(new f.dom.window.Event('pointerup'));
  await waitFor(() => !f.$('.reader-selection-tools').hidden);
  f.click('annotate'); f.input('[data-reader-comment]', 'A useful connection'); await f.reader.flush();
  const saved = f.saves.at(-1).reading.annotations[0]; assert.equal(saved.comment, 'A useful connection'); assert.equal(saved.quote, span.textContent);
  assert.equal(f.$('.reader-page-highlight').style.left, '10%'); assert.ok(f.$('.reader-margin-note'));
  assert.equal(f.$('.reader-margin-note').closest('.reader-document'), f.$('.reader-document'));
  assert.ok(f.$('.reader-margin-link path'), 'margin notes have a connector to their selected passage');
  f.$('.reader-margin-note').click();
  assert.equal(f.doc.activeElement, f.$('[data-reader-comment]'), 'the margin note opens its matching editor');
  f.engines[0].params.onScale(2); assert.equal(f.$('.reader-page-highlight').style.left, '10%');
  f.$('[data-reader-delete]').click(); await f.reader.flush(); assert.equal(f.saves.at(-1).reading.annotations.length, 0);
  assert.equal(f.$('.reader-margin-note'), null, 'deleting a highlight removes its margin note and connector');
});

test('rapid edits are saved in order with the latest revision and are not lost on close', async t => {
  let finish;
  const f = await setup(t, { save: async (file, reading, revision) => { if (!finish) await new Promise(resolve => { finish = resolve; }); return { ...reading, revision: revision + 1 }; } });
  f.$('[data-reader-tab=notes]').click(); f.input('.reader-document-notes', 'First'); const first = f.reader.flush();
  await waitFor(() => finish); f.input('.reader-document-notes', 'Latest'); const latest = f.reader.flush(); finish(); await first; await latest;
  assert.deepEqual(f.saves.map(s => s.revision), [0, 1]); assert.equal(f.saves[1].reading.notes, 'Latest');
});

test('reselecting an opening PDF reuses the engine, and closing prevents stale callbacks', async t => {
  const f = await setup(t, { autoRender: false }); await f.reader.open(asset); assert.equal(f.engines.length, 1);
  const old = f.engines[0]; f.reader.destroy(); old.params.onRendered(1); old.params.onReady(9);
  assert.equal(old.destroyed, true); assert.equal(f.container.childElementCount, 0);
});

test('stalled and failed documents offer a visible retry and direct original link', async t => {
  const f = await setup(t, { autoRender: false, manualTimers: true });
  f.timers.find(timer => timer.delay === 45000).callback();
  assert.match(f.$('.pdf-reader-status').textContent, /too long/); assert.equal(f.$('.pdf-reader-retry').hidden, false);
  assert.equal(f.$('.pdf-reader-fallback').href, `${baseURI}content/blocks/b_pdf/assets/book.pdf`);
  assert.equal(f.engines[0].destroyed, true); f.click('retry'); await waitFor(() => f.engines.length === 2);
});

test('password protected files request a password without storing it in notes or preferences', async t => {
  const f = await setup(t, { autoRender: false }); let password;
  f.engines[0].params.onPassword(value => { password = value; }, false);
  f.$('.reader-password input').value = 'test-password';
  f.$('.reader-password').dispatchEvent(new f.dom.window.Event('submit', { cancelable: true }));
  assert.equal(password, 'test-password'); assert.equal(f.$('.reader-password input').value, ''); assert.equal(f.saves.length, 0);
});
