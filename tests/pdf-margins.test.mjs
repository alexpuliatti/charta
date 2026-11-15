import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { setupPDFMargins } from '../web/pdf-margins.mjs';

test('PDF margin notes connect to their passages, follow scrolling and zoom, and avoid collisions', async () => {
  const dom = new JSDOM('<section class="custom-pdf-reader reader-notebook-open"><div class="reader-document"><div class="reader-scroll"><div class="reader-pages"><div class="page" data-page-number="1"><button class="reader-page-highlight" data-reader-note="one"></button></div></div></div></div></section>', { pretendToBeVisual: true });
  const { document } = dom.window, container = document.querySelector('section'), stage = document.querySelector('.reader-document');
  const scroll = document.querySelector('.reader-scroll'), pages = document.querySelector('.reader-pages'), page = document.querySelector('.page');
  let width = 1100, offset = 0, zoom = 1;
  Object.defineProperties(stage, { clientWidth: { get: () => width }, clientHeight: { value: 700 } });
  Object.defineProperty(dom.window.HTMLButtonElement.prototype, 'offsetHeight', { get() { return container.dataset.marginNotes === 'compact' ? 28 : 90; } });
  stage.getBoundingClientRect = () => ({ left: 20, top: 100 });
  page.getBoundingClientRect = () => ({ left: 80, top: 124 - offset, width: 600 * zoom, height: 800 * zoom, bottom: 124 - offset + 800 * zoom });
  const changes = [], margins = setupPDFMargins({ container, scroll, pages, onWidthChange: expanded => changes.push(expanded) });
  const notes = [
    { id: 'one', page: 1, rects: [[.1, .2, .3, .02]], quote: 'The first passage', comment: 'First thought', color: 'yellow' },
    { id: 'two', page: 1, rects: [[.1, .21, .4, .02]], quote: 'A nearby passage', comment: 'Another thought', color: 'blue' },
  ];
  const original = structuredClone(notes);
  try {
    margins.render(notes);
    assert.equal(container.dataset.marginNotes, 'expanded', 'notes remain beside the page with the notebook open');
    assert.equal(changes[0], true, 'the document viewport is refreshed when space is reserved');
    const [first, second] = container.querySelectorAll('.reader-margin-note');
    assert.equal(first.closest('.reader-document'), stage);
    assert.equal(page.contains(first), false, 'notes never interfere with PDF.js page geometry or text selection');
    assert.ok(parseFloat(second.style.top) >= parseFloat(first.style.top) + first.offsetHeight + 10);
    const connector = container.querySelector('.reader-margin-link path');
    const anchor = () => connector.getAttribute('d').match(/^M (\S+) (\S+) C/).slice(1).map(value => Math.round(Number(value) * 1000) / 1000);
    assert.deepEqual(anchor(), [300, 192], 'the connector starts at the selected text, not the paper edge');
    const beforeScroll = parseFloat(first.style.top);
    offset = 100; scroll.dispatchEvent(new dom.window.Event('scroll')); await pause(25);
    assert.equal(parseFloat(first.style.top), beforeScroll - 100);
    assert.deepEqual(anchor(), [300, 92]);
    zoom = 1.5; margins.schedule(); await pause(25);
    assert.deepEqual(anchor(), [420, 176], 'the anchor follows the scaled page');
    margins.render(notes);
    assert.equal(container.querySelector('.reader-margin-note'), first, 'page rendering preserves the note buttons and keyboard focus');
    first.focus(); assert.equal(container.querySelector('.reader-page-highlight').classList.contains('is-active'), true);

    width = 500; dom.window.dispatchEvent(new dom.window.Event('resize')); await pause(25);
    assert.equal(container.dataset.marginNotes, 'compact');
    assert.equal(parseFloat(first.style.left), 464, 'narrow readers keep accessible note markers inside the viewport');
    assert.match(first.getAttribute('aria-label'), /First thought/);
    notes[0].comment = '<script>Keep this as plain text</script>'; margins.render(notes);
    assert.equal(container.querySelector('script'), null);
    assert.equal(container.querySelector('.reader-margin-text').textContent, notes[0].comment);
    assert.deepEqual(notes.map(note => note.rects), original.map(note => note.rects), 'layout never rewrites saved geometry');
  } finally { margins.destroy(); assert.equal(container.querySelector('.reader-margin-layer'), null); dom.window.close(); }
});

test('notes at the end of a PDF have enough scroll space to be read', () => {
  const dom = new JSDOM('<section><div class="reader-document"><div class="reader-scroll"><div class="reader-pages"><div class="page" data-page-number="1"></div></div></div></div></section>', { pretendToBeVisual: true });
  const container = dom.window.document.querySelector('section'), stage = container.querySelector('.reader-document'), scroll = container.querySelector('.reader-scroll'), pages = container.querySelector('.reader-pages');
  Object.defineProperties(stage, { clientWidth: { value: 1100 }, clientHeight: { value: 700 } });
  stage.getBoundingClientRect = () => ({ left: 0, top: 0 });
  pages.firstElementChild.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 800, bottom: 800 });
  const margins = setupPDFMargins({ container, scroll, pages });
  try {
    margins.render([{ id: 'last', page: 1, rects: [[.1, .97, .3, .02]], quote: 'Final paragraph', comment: 'A thought at the end', color: 'green' }]);
    assert.ok(parseFloat(pages.style.getPropertyValue('--reader-notes-bottom')) > 40);
    margins.render([]); assert.equal(container.hasAttribute('data-margin-notes'), false);
    assert.equal(pages.style.getPropertyValue('--reader-notes-bottom'), '');
  } finally { margins.destroy(); dom.window.close(); }
});
