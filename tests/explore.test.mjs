import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modules = await mkdtemp(path.join(tmpdir(), 'charta-explore-'));
await cp(new URL('../web/', import.meta.url), modules, { recursive: true });
await cp(new URL('../shared/', import.meta.url), path.join(modules, 'shared'), { recursive: true });
const { renderExplorer, createExploreCatalog, exploreHash, parseExploreRoute } = await import(pathToFileURL(path.join(modules, 'explore.mjs')));
after(() => rm(modules, { recursive: true, force: true }));

function fixture() {
  const material = (id, type, title, extra = {}) => ({ schemaVersion: 1, id, type, title, path: `content/blocks/${id}/block.json`, category: 'Design', tags: ['reference'], source: {}, description: '', body: '', assets: [], createdAt: '2026-11-15T10:00:00Z', ...extra });
  return {
    folders: [{ id: 'f_design', title: 'Design', parentId: null }, { id: 'f_visual', title: 'Visual', parentId: 'f_design' }],
    collections: [
      { id: 'c_art', title: 'Art', parentId: 'f_visual', items: [{ kind: 'block', id: 'b_image' }, { kind: 'block', id: 'b_link' }] },
      { id: 'c_notes', title: 'Notes', parentId: 'f_design', items: [{ kind: 'block', id: 'b_text' }, { kind: 'block', id: 'b_image' }] }
    ],
    blocks: [
      material('b_image', 'image', 'An orbital image', { assets: [{ role: 'original', path: 'assets/original.png', mimeType: 'image/png' }] }),
      material('b_link', 'link', 'Biotech portfolio', { category: 'Companies', source: { url: 'https://example.com/portfolio' }, description: 'An investor’s portfolio.', body: 'Some original saved text. '.repeat(30) }),
      material('b_text', 'text', 'Collecting notes', { body: 'Ideas about collecting and linking references.' }),
      material('b_pdf', 'file', 'Book about architecture', { assets: [{ role: 'original', path: 'assets/book.pdf', mimeType: 'application/pdf' }] }),
      material('b_video', 'video', 'Motion study', { assets: [{ role: 'original', path: 'assets/original.mp4', mimeType: 'video/mp4' }] }),
      material('b_audio', 'audio', 'Sound experiment', { assets: [{ role: 'original', path: 'assets/original.mp3', mimeType: 'audio/mpeg' }] })
    ]
  };
}
function setup(t, { data = fixture(), state = { selectedId: 'b_image' }, mobile = false, restore } = {}) {
  const dom = new JSDOM('<!doctype html><div id="content"></div>', { url: 'https://example.test/charta/#/explore', pretendToBeVisual: true });
  dom.window.matchMedia = query => ({ matches: query.includes('max-width') && mobile });
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
    this.querySelector('button')?.focus({ preventScroll: true });
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    if (!this.open) return;
    this.removeAttribute('open');
    this.dispatchEvent(new dom.window.Event('close'));
  };
  const root = dom.window.document.getElementById('content'), changes = [];
  const controller = renderExplorer(root, data, { state, restore, onNavigate: (next, options) => changes.push({ state: next, options }) });
  t.after(() => { controller.destroy(); dom.window.close(); });
  return { dom, root, controller, changes, $: selector => root.querySelector(selector), click: id => root.querySelector(`[data-explore-select="${id}"]`).click(), change: (selector, value) => { const node = root.querySelector(selector); node.value = value; node.dispatchEvent(new dom.window.Event('change', { bubbles: true })); } };
}

test('explore scope covers every resource type, nested folders, and shared memberships once', () => {
  const index = createExploreCatalog(fixture());
  const all = { type: 'all', order: 'title', query: '' };
  assert.equal(index.filter(all).length, 6);
  assert.deepEqual(index.filter({ ...all, folderId: 'f_design' }).map(block => block.id), ['b_image', 'b_link', 'b_text']);
  assert.equal(index.filter({ ...all, collectionId: 'c_art', type: 'image' }).length, 1);
  assert.equal(index.filter({ ...all, query: '#reference orbital' })[0].id, 'b_image');
  assert.equal(index.filter({ ...all, query: 'original saved text' })[0].id, 'b_link');
  assert.equal(index.filter({ ...all, folderId: 'missing' }).length, 0);
});

test('explore links preserve selected resource, search, folder, type, and sort', () => {
  const state = { selectedId: 'b_image', query: 'visual #reference café', type: 'image', order: 'title', collectionId: '', folderId: 'f_design' };
  assert.deepEqual(parseExploreRoute(exploreHash(state)), state);
  assert.equal(exploreHash({}), '#/explore');
});

test('tweet tiles and popups show captured text instead of screenshots, including short or missing bodies', t => {
  const data = fixture();
  const tweet = data.blocks.find(block => block.id === 'b_link');
  Object.assign(tweet, {
    source: { url: 'https://twitter.com/ada/status/102' },
    body: 'A short tweet.\nA second line with <script>literal text</script>.',
    assets: [{ role: 'thumbnail', path: 'assets/login.png', mimeType: 'image/png' }]
  });
  const f = setup(t, { data, state: { selectedId: 'b_link' } });
  assert.equal(f.$('[data-explore-select=b_link] img'), null);
  assert.match(f.$('[data-explore-select=b_link]').textContent, /A short tweet/);
  assert.equal(f.$('.explore-large-image'), null);
  assert.equal(f.$('.explore-plain-text').textContent, tweet.body);
  assert.equal(f.$('.explore-stage script'), null, 'tweet text remains inert');

  tweet.body = '';
  f.click('b_link');
  assert.match(f.$('.explore-plain-text').textContent, /Tweet text hasn’t been saved yet/);
  assert.equal(f.$('.explore-large-image'), null, 'missing tweet text does not reveal a login screenshot');
});

test('selecting a resource opens a modal while preserving the gallery and scroll position', t => {
  const f = setup(t);
  const gallery = f.$('.explore-gallery-scroll'); gallery.scrollTop = 241;
  assert.equal(f.$('.explore-preview-pane').localName, 'dialog');
  assert.equal(f.$('.explore-preview-pane').open, true);
  assert.equal(f.$('.explore-large-image').alt, 'An orbital image');
  assert.equal(f.$('[data-explore-select=b_image]').getAttribute('aria-pressed'), 'true');
  f.click('b_link');
  assert.equal(f.$('.explore-gallery-scroll'), gallery);
  assert.equal(gallery.scrollTop, 241);
  assert.match(f.$('.explore-reading').textContent, /Some original saved text/);
  assert.equal(f.$('.explore-preview-title').textContent, 'Biotech portfolio');
  assert.equal(f.$('[data-explore-select=b_link]').getAttribute('aria-pressed'), 'true');
  assert.equal(f.changes.at(-1).state.selectedId, 'b_link');
  f.controller.updateRoute({ ...f.controller.getState(), selectedId: 'b_text' });
  assert.equal(f.$('.explore-preview-title').textContent, 'Collecting notes');
});

test('search and filters keep the gallery open without automatically opening an artefact', t => {
  const f = setup(t), search = f.$('.explore-search input');
  search.value = 'collecting'; search.dispatchEvent(new f.dom.window.Event('input', { bubbles: true }));
  assert.equal(f.$('.explore-count').textContent, '1');
  assert.equal(f.$('.explore-preview-pane').open, false);
  assert.equal(f.controller.getState().selectedId, '');
  assert.equal(f.$('.explore-search input'), search);
  f.change('.explore-type', 'video');
  assert.equal(f.$('.explore-empty').hidden, false);
  assert.equal(f.$('.explore-preview-pane').hidden, true);
  f.$('[data-explore=clear]').click();
  assert.equal(f.$('.explore-count').textContent, '6');
  f.change('.explore-scope', 'folder:f_design');
  assert.equal(f.$('.explore-count').textContent, '3');
  assert.equal(f.$('.explore-gallery-heading h1').textContent, 'Design');
});

test('keyboard navigation moves through the open popup and Escape restores the selected card', t => {
  const f = setup(t), image = f.$('.explore-large-image');
  assert.match(image.src, /original.png$/);
  assert.equal(image.hasAttribute('style'), false, 'image sizing follows its responsive popup');
  assert.equal(f.$('[data-explore=expand]'), null, 'a centered preview needs no extra expand step');
  f.change('.explore-sort', 'title');
  f.click('b_image');
  const close = f.$('[data-explore=close]');
  close.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert.equal(f.controller.getState().selectedId, 'b_link');
  assert.equal(f.$('.explore-preview-pane').open, true);
  assert.equal(f.dom.window.document.activeElement, close, 'keyboard focus stays inside the modal');
  close.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(f.$('.explore-preview-pane').open, false);
  assert.equal(f.controller.getState().selectedId, '');
  assert.equal(f.dom.window.document.activeElement, f.$('[data-explore-select=b_link]'));
});

test('tags and resource actions are hidden until the plus is opened and reset on the next artefact', t => {
  const f = setup(t), toggle = f.$('[data-explore=info]'), info = f.$('.explore-info');
  assert.equal(info.hidden, true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.getAttribute('aria-controls'), info.id);
  assert.ok(info.querySelector('[data-action=open-block]'));
  assert.equal(f.$('.explore-preview-footer [data-action]'), null, 'the initial popup keeps only quiet pagination');
  toggle.click();
  assert.equal(info.hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.match(info.textContent, /#reference/);
  toggle.click();
  assert.equal(info.hidden, true);
  toggle.click();
  f.$('[data-explore=next]').click();
  assert.equal(info.hidden, true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});

test('saved article metadata and Markdown tools stay behind the information control', t => {
  const data = fixture();
  Object.assign(data.blocks[2], { contentFormat: 'markdown', body: '# Collecting notes\n\nSaved ideas to read.', article: { author: 'Ada', published: '2026-11-14' }, capture: { warning: 'Loaded posts only.' } });
  const f = setup(t, { data, state: { selectedId: 'b_text' } });
  assert.match(f.$('.explore-stage .article-body').textContent, /Saved ideas to read/);
  assert.equal(f.$('.explore-stage .article-markdown,.explore-stage .article-download,.explore-stage .article-byline,.explore-stage .article-warning'), null);
  assert.equal(f.$('.explore-info').hidden, true);
  f.$('[data-explore=info]').click();
  assert.match(f.$('.explore-info .article-byline').textContent, /Ada/);
  assert.match(f.$('.explore-info .article-warning').textContent, /Loaded posts only/);
  assert.ok(f.$('.explore-info .article-download'));
  assert.match(f.$('.explore-info .article-markdown').textContent, /Saved ideas to read/);
});

test('native cancellation and outside clicks close the popup and restore gallery focus', t => {
  const f = setup(t), preview = f.$('.explore-preview-pane'), card = f.$('[data-explore-select=b_image]');
  const cancel = new f.dom.window.Event('cancel', { cancelable: true });
  preview.dispatchEvent(cancel);
  assert.equal(cancel.defaultPrevented, true);
  assert.equal(preview.open, false);
  assert.equal(f.dom.window.document.activeElement, card);
  assert.equal(f.changes.at(-1).state.selectedId, '');
  f.click('b_image');
  preview.getBoundingClientRect = () => ({ left: 100, right: 800, top: 100, bottom: 700 });
  preview.dispatchEvent(new f.dom.window.MouseEvent('click', { bubbles: true, clientX: 50, clientY: 200 }));
  assert.equal(preview.open, false);
  assert.equal(f.dom.window.document.activeElement, card);
});

test('full details suspend the popup and returning restores the selected artefact without moving the gallery', t => {
  const f = setup(t), gallery = f.$('.explore-gallery-scroll'), preview = f.$('.explore-preview-pane');
  gallery.scrollTop = 245;
  f.$('[data-explore=info]').click();
  f.$('.explore-info [data-action=open-block]').click();
  assert.equal(preview.open, false);
  assert.equal(f.controller.getState().selectedId, 'b_image', 'a temporary modal handoff preserves its route');
  assert.equal(f.$('.explore-large-image'), null, 'suspending releases the active media');
  f.controller.updateRoute(f.controller.getState());
  assert.equal(preview.open, true);
  assert.ok(f.$('.explore-large-image'));
  assert.equal(f.$('.explore-info').hidden, true);
  assert.equal(gallery.scrollTop, 245);
  f.controller.suspendPreview();
  const editor = f.dom.window.document.createElement('dialog');
  f.dom.window.document.body.append(editor); editor.showModal();
  f.controller.resumePreview();
  assert.equal(preview.open, false, 'the popup cannot reopen above another modal');
  editor.close();
  f.controller.resumePreview();
  assert.equal(preview.open, true);
});

test('PDFs and playing media are torn down when switching or closing an artefact', t => {
  const f = setup(t);
  f.click('b_pdf');
  const frame = f.$('.reader-scroll');
  assert.ok(frame);
  assert.match(f.$('.reader-original').href, /book\.pdf$/);
  assert.ok(f.$('.explore-stage .pdf-reader-toolbar'), 'custom reading controls remain visible');
  assert.ok(f.$('.explore-info .pdf-reader-source'));
  f.$('.explore-info [data-action=open-pdf]').click();
  assert.equal(f.$('.reader-scroll'), frame, 'reading the selected saved PDF retains its reading room');
  f.click('b_video');
  assert.equal(frame.isConnected, false);
  const video = f.$('video'); let paused = 0;
  Object.defineProperty(video, 'paused', { value: false }); video.pause = () => { paused++; };
  f.click('b_audio');
  assert.equal(paused, 1);
  assert.ok(f.$('audio'));
  assert.equal(f.$('video'), null);
  f.click('b_text');
  assert.equal(f.$('audio'), null);
  f.click('b_pdf');
  const lastFrame = f.$('.reader-scroll');
  f.$('[data-explore=close]').click();
  assert.equal(lastFrame.isConnected, false, 'closing the popup releases its PDF reader');
});

test('the gallery progressively loads resources and supports direct links beyond its first page', t => {
  const data = fixture();
  data.blocks = Array.from({ length: 137 }, (_, index) => ({ ...data.blocks[2], id: `b_${index}`, title: `Note ${String(index).padStart(3, '0')}` }));
  data.collections = [];
  const f = setup(t, { data, state: { order: 'title', selectedId: 'b_0' } });
  assert.equal(f.root.querySelectorAll('.explore-tile').length, 60);
  f.$('.explore-load-more').click();
  assert.equal(f.root.querySelectorAll('.explore-tile').length, 120);
  f.controller.updateRoute({ ...f.controller.getState(), selectedId: 'b_136' });
  assert.equal(f.root.querySelectorAll('.explore-tile').length, 137);
  assert.equal(f.$('.explore-preview-title').textContent, 'Note 136');
});

test('desktop and small screens start with the gallery until an artefact is chosen', t => {
  for (const mobile of [false, true]) {
    const f = setup(t, { state: {}, mobile });
    assert.equal(f.$('.explore-preview-pane').open, false);
    assert.equal(f.controller.getState().selectedId, '');
    f.click('b_image');
    assert.equal(f.$('.explore-preview-pane').open, true);
    f.$('[data-explore=close]').click();
    assert.equal(f.$('.explore-preview-pane').open, false);
    assert.equal(f.dom.window.document.activeElement, f.$('[data-explore-select=b_image]'));
  }
});
