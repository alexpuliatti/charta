import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { applyOperation } from '../shared/model.mjs';

const waitFor = async predicate => {
  for (let i = 0; i < 150; i++) { if (predicate()) return; await pause(10); }
  assert.fail('The expected canvas application state did not appear.');
};

test('the real app creates canvas boards, saves notes, opens material details, and restores the board on navigation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'charta-canvas-app-'));
  let dom;
  const globals = new Map(), errors = [];
  const install = (key, value) => { globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
  try {
    await cp(new URL('../web/', import.meta.url), path.join(root, 'web'), { recursive: true });
    await cp(new URL('../shared/', import.meta.url), path.join(root, 'web/shared'), { recursive: true });
    const virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', e => errors.push(e.message));
    dom = new JSDOM(await readFile(path.join(root, 'web/index.html'), 'utf8'), { url: 'http://127.0.0.1:4173/#/canvas', pretendToBeVisual: true, virtualConsole });
    const { window } = dom, doc = window.document;
    window.matchMedia = query => ({ matches: query.includes('min-width: 801px'), addEventListener() {}, removeEventListener() {} });
    window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); window.setTimeout(() => this.dispatchEvent(new window.Event('close')), 0); };
    for (const name of ['window', 'document', 'location', 'localStorage', 'HTMLElement', 'HTMLFormElement', 'FormData', 'AbortController']) install(name, name === 'window' ? window : window[name]);
    install('requestAnimationFrame', window.requestAnimationFrame.bind(window)); install('cancelAnimationFrame', window.cancelAnimationFrame.bind(window)); install('ResizeObserver', undefined);
    let catalog = { schemaVersion: 1, library: { schemaVersion: 1, title: 'Canvas app test' }, folders: [], collections: [], blocks: [] };
    catalog = applyOperation(catalog, { type: 'add-block', block: { id: 'b_reference', title: 'Learning by connecting', type: 'text' }, body: 'A useful reference about connecting ideas.' }).catalog;
    install('fetch', async (input, init = {}) => {
      const url = new URL(String(input), doc.baseURI);
      let result;
      if (url.pathname === '/api/mutate') { result = applyOperation(catalog, JSON.parse(init.body)); catalog = result.catalog; }
      else if (url.pathname === '/api/canvas/ai') result = { configured: false, model: '' };
      else result = catalog;
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    });
    await import(pathToFileURL(path.join(root, 'web/app.mjs')));
    const $ = selector => doc.querySelector(selector), action = name => $(`[data-canvas-action=${name}]`).click();
    assert.equal(doc.body.dataset.view, 'canvas');
    assert.ok($('#sidebar a[href="#/canvas"]'));
    $('.canvas-create-form input').value = 'Research project';
    $('.canvas-create-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => $('.canvas-workspace'));
    assert.match(window.location.hash, /^#\/canvas\/canvas_/);
    action('note');
    const text = $('.canvas-note-text'); text.value = 'An idea to revisit.'; text.dispatchEvent(new window.Event('input', { bubbles: true }));
    // The canvas N shortcut must not open the global material composer.
    $('.canvas-stage').focus();
    $('.canvas-stage').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true }));
    assert.equal($('#modal').open, false);
    assert.equal(doc.querySelectorAll('.canvas-card').length, 2);
    action('library'); $('[data-material=b_reference]').click();
    const materialCard = [...doc.querySelectorAll('.canvas-material')][0]; materialCard.click();
    const boardURL = window.location.hash;
    action('open-material');
    await waitFor(() => $('#detail').open);
    assert.equal($('#detail h2').textContent, 'Learning by connecting');
    $('#detail [data-action=close-detail]').click();
    await waitFor(() => !$('#detail').open && window.location.hash === boardURL && $('.canvas-workspace'));
    assert.equal(doc.querySelectorAll('.canvas-card').length, 3);
    assert.equal(catalog.library.canvases[0].nodes[0].text, 'An idea to revisit.');
    $('#sidebar a[href="#/canvas"]').click();
    await waitFor(() => $('.canvas-overview'));
    assert.match($('.canvas-board-tile h2').textContent, /Research project/);
    $('.canvas-board-tile').click();
    await waitFor(() => $('.canvas-workspace'));
    assert.equal(doc.querySelectorAll('.canvas-card').length, 3);
    assert.deepEqual(errors, []);
  } finally {
    if (dom) { dom.window.location.hash = '#/canvas'; await pause(20); dom.window.close(); }
    for (const [key, previous] of globals) { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; }
    await rm(root, { recursive: true, force: true });
  }
});
