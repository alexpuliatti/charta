import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { setupSidebar, SIDEBAR_STORAGE_KEY } from '../web/sidebar.mjs';

function fixture(t, { desktop = true, stored, blockedStorage = false, legacyMedia = false } = {}) {
  const dom = new JSDOM('<!doctype html><body><button id="menu-button">Menu</button><aside id="sidebar"><a id="first" href="#all">All readings</a><a href="#hidden" hidden>Hidden</a><button id="last">Settings</button></aside><div id="nav-scrim" hidden></div><button id="outside">Outside</button><dialog></dialog></body>', { url: 'https://example.com' });
  const { document } = dom.window;
  const listeners = new Set(), values = new Map(stored === undefined ? [] : [[SIDEBAR_STORAGE_KEY, String(stored)]]), writes = [];
  const media = {
    matches: desktop,
    change(matches) { this.matches = matches; for (const listener of [...listeners]) listener({ matches, media: '(min-width: 801px)' }); }
  };
  if (legacyMedia) { media.addListener = handler => listeners.add(handler); media.removeListener = handler => listeners.delete(handler); }
  else { media.addEventListener = (type, handler) => { assert.equal(type, 'change'); listeners.add(handler); }; media.removeEventListener = (type, handler) => listeners.delete(handler); }
  const storage = {
    getItem(key) { if (blockedStorage) throw new Error('Storage denied'); return values.get(key) ?? null; },
    setItem(key, value) { if (blockedStorage) throw new Error('Storage denied'); values.set(key, value); writes.push([key, value]); }
  };
  const body = document.body, sidebar = document.getElementById('sidebar'), toggle = document.getElementById('menu-button'), scrim = document.getElementById('nav-scrim');
  const controller = setupSidebar({ body, sidebar, toggle, scrim, storage, matchMedia: query => { assert.equal(query, '(min-width: 801px)'); return media; } });
  t.after(() => { controller.destroy(); dom.window.close(); });
  const key = (value, options = {}) => document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options }));
  return { dom, document, body, sidebar, toggle, scrim, controller, media, listeners, writes, values, key };
}

test('desktop sidebar collapses to its rail, persists preference, and reports expanded state', t => {
  const f = fixture(t);
  assert.equal(f.toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(f.toggle.getAttribute('aria-label'), 'Close sidebar');
  assert.equal(f.toggle.getAttribute('aria-controls'), 'sidebar');
  assert.equal(f.body.classList.contains('sidebar-collapsed'), false);
  f.controller.closeMobile();
  assert.equal(f.controller.getState().expanded, true, 'route changes do not collapse desktop navigation');
  f.toggle.click();
  assert.equal(f.body.classList.contains('sidebar-collapsed'), true);
  assert.equal(f.toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(f.toggle.getAttribute('aria-label'), 'Open sidebar');
  assert.equal(f.scrim.hidden, true);
  assert.equal(f.sidebar.hasAttribute('inert'), false, 'the collapsed icon rail stays keyboard accessible');
  assert.deepEqual(f.writes, [[SIDEBAR_STORAGE_KEY, 'true']]);
  f.toggle.click();
  assert.equal(f.body.classList.contains('sidebar-collapsed'), false);
  assert.equal(f.values.get(SIDEBAR_STORAGE_KEY), 'false');
});

test('mobile drawer ignores desktop collapse and keeps its own overlay and focus behavior', t => {
  const f = fixture(t, { desktop: false, stored: true });
  assert.equal(f.body.classList.contains('sidebar-collapsed'), false);
  assert.equal(f.sidebar.hasAttribute('inert'), true);
  assert.equal(f.sidebar.getAttribute('aria-hidden'), 'true');
  f.toggle.focus(); f.toggle.click();
  assert.equal(f.sidebar.classList.contains('open'), true);
  assert.equal(f.scrim.hidden, false);
  assert.equal(f.toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(f.toggle.getAttribute('aria-label'), 'Close sidebar');
  assert.equal(f.document.activeElement.id, 'first');
  f.key('Tab'); assert.equal(f.document.activeElement.id, 'last', 'hidden links are skipped');
  f.key('Tab'); assert.equal(f.document.activeElement, f.toggle);
  f.key('Tab', { shiftKey: true }); assert.equal(f.document.activeElement.id, 'last');
  f.key('Escape');
  assert.equal(f.sidebar.classList.contains('open'), false);
  assert.equal(f.sidebar.hasAttribute('inert'), true);
  assert.equal(f.scrim.hidden, true);
  assert.equal(f.toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(f.document.activeElement, f.toggle);
  assert.deepEqual(f.writes, [], 'mobile opening and closing never changes desktop preference');
});

test('crossing the breakpoint resets the drawer and restores the persisted desktop rail', t => {
  const f = fixture(t, { stored: true });
  assert.equal(f.body.classList.contains('sidebar-collapsed'), true);
  f.media.change(false);
  assert.equal(f.body.classList.contains('sidebar-collapsed'), false);
  assert.equal(f.sidebar.hasAttribute('inert'), true);
  f.toggle.click();
  assert.equal(f.scrim.hidden, false);
  f.media.change(true);
  assert.equal(f.sidebar.classList.contains('open'), false);
  assert.equal(f.body.classList.contains('sidebar-collapsed'), true);
  assert.equal(f.sidebar.hasAttribute('inert'), false);
  assert.equal(f.scrim.hidden, true);
  assert.equal(f.toggle.getAttribute('aria-label'), 'Open sidebar');
  f.toggle.click();
  f.document.getElementById('first').focus();
  f.media.change(false);
  assert.equal(f.document.activeElement, f.toggle, 'resizing cannot leave focus in a hidden drawer');
  f.media.change(true);
  assert.equal(f.toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(f.body.classList.contains('sidebar-collapsed'), false);
});

test('scrim and route closure return focus when appropriate without stealing outside focus', t => {
  const f = fixture(t, { desktop: false });
  f.toggle.click(); f.scrim.click();
  assert.equal(f.document.activeElement, f.toggle);
  f.toggle.click();
  f.controller.closeMobile();
  assert.equal(f.document.activeElement, f.toggle, 'closing from a focused navigation link returns to the opener');
  f.toggle.click();
  const outside = f.document.getElementById('outside'); outside.focus();
  f.controller.closeMobile();
  assert.equal(f.document.activeElement, outside, 'route handlers can move focus to the new page without it being taken back');
});

test('storage failure and older media-query listeners leave all controls usable', t => {
  const f = fixture(t, { blockedStorage: true, legacyMedia: true });
  f.toggle.click();
  assert.equal(f.body.classList.contains('sidebar-collapsed'), true);
  f.media.change(false); f.toggle.click();
  assert.equal(f.sidebar.classList.contains('open'), true);
  f.key('Escape');
  assert.equal(f.scrim.hidden, true);
});

test('native dialogs keep Escape priority over an open navigation drawer', t => {
  const f = fixture(t, { desktop: false });
  f.toggle.click();
  const dialog = f.document.querySelector('dialog'); dialog.setAttribute('open', '');
  f.key('Escape');
  assert.equal(f.sidebar.classList.contains('open'), true);
  dialog.removeAttribute('open');
  f.key('Escape');
  assert.equal(f.sidebar.classList.contains('open'), false);
});

test('destroy removes click, keyboard, and breakpoint listeners', t => {
  const f = fixture(t, { desktop: false });
  f.toggle.click();
  assert.equal(f.listeners.size, 1);
  f.controller.destroy(); f.controller.destroy();
  assert.equal(f.listeners.size, 0);
  const before = f.controller.getState();
  f.scrim.click(); f.toggle.click(); f.key('Escape'); f.media.change(true); f.controller.closeMobile({ restoreFocus: true });
  assert.deepEqual(f.controller.getState(), before);
  assert.equal(f.sidebar.classList.contains('open'), true, 'destroyed controllers cannot mutate the mounted view');
});
