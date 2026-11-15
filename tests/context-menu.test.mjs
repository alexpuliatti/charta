import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createContextMenu } from '../web/context-menu.mjs';

test('context menus support right click, keyboard navigation, dismissal, viewport edges and native text editing', () => {
  const dom = new JSDOM('<article data-context-kind="block" data-context-id="b_one"><button id="open">Open</button><button id="more">More</button></article><input id="text">', { pretendToBeVisual: true });
  const { document, MouseEvent, KeyboardEvent, Event } = dom.window;
  const controller = createContextMenu({ document, itemsFor: () => [
    { label: 'Rename', data: { action: 'rename' } },
    { label: 'Delete', danger: true, disabled: true },
    { label: 'Edit', data: { action: 'edit' } }
  ] });
  try {
    const article = document.querySelector('article'), more = document.querySelector('#more');
    more.focus();
    more.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 2000, clientY: 2000 }));
    let menu = document.querySelector('[role=menu]');
    assert.ok(menu);
    assert.equal(document.activeElement.textContent, 'Rename');
    assert.ok(parseInt(menu.style.left) <= dom.window.innerWidth - 8);
    assert.ok(parseInt(menu.style.top) <= dom.window.innerHeight - 8);
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.equal(document.activeElement.textContent, 'Edit', 'disabled destructive actions are skipped');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    assert.equal(document.activeElement.textContent, 'Rename');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    assert.equal(document.activeElement.textContent, 'Edit');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    assert.equal(document.activeElement.textContent, 'Rename');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(document.querySelector('[role=menu]'), null);
    assert.equal(document.activeElement, more);
    more.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
    assert.ok(document.querySelector('[role=menu]'));
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    assert.equal(document.querySelector('[role=menu]'), null);
    controller.open(article);
    document.querySelector('#text').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    assert.equal(document.querySelector('[role=menu]'), null, 'text inputs keep the native context menu');
    controller.open(article);
    document.activeElement.click();
    assert.equal(document.querySelector('[role=menu]'), null, 'selecting an action closes the menu');
    more.getBoundingClientRect = () => ({ left: 500, bottom: 174 });
    controller.open(article, { keyboard: true, anchor: more });
    assert.equal(document.querySelector('[role=menu]').style.left, '500px', 'ellipsis menus anchor to their button rather than the containing card or drawer');
    assert.equal(document.querySelector('[role=menu]').style.top, '181px');
    dom.window.dispatchEvent(new Event('resize'));
    assert.equal(document.querySelector('[role=menu]'), null);
  } finally { dom.window.close(); }
});

test('animated dismissal releases interaction immediately and rapid reopening cannot remove the new menu', async () => {
  const dom = new JSDOM('<button aria-haspopup="menu" data-context-kind="block" data-context-id="b_one">Actions</button>', { pretendToBeVisual: true });
  const { document } = dom.window;
  const animations = [];
  dom.window.HTMLElement.prototype.animate = function(frames, options) {
    let resolve, reject, settled = false;
    const animation = {
      frames, options,
      finished: new Promise((yes, no) => { resolve = yes; reject = no; }),
      cancel() { if (!settled) { settled = true; reject(new Error('Canceled')); } },
      finish() { if (!settled) { settled = true; resolve(); } }
    };
    animations.push(animation); return animation;
  };
  const controller = createContextMenu({ document, itemsFor: () => [{ label: 'Rename', data: { action: 'rename-item' } }], titleFor: () => '<Untrusted title>' });
  try {
    const trigger = document.querySelector('button');
    controller.open(trigger, { keyboard: true });
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(document.querySelector('.menu-heading').textContent, '<Untrusted title>');
    assert.equal(document.querySelector('.menu-heading untrusted'), null);
    assert.ok(document.querySelector('.menu-icon[aria-hidden=true]'));
    controller.close();
    const closing = document.querySelector('.menu-exit');
    assert.equal(document.querySelector('[role=menu]'), null, 'the fading surface is no longer an accessible menu');
    assert.ok(closing.hasAttribute('inert'));
    assert.equal(closing.style.pointerEvents, 'none');
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(animations.at(-1).options.duration, 120);
    const oldExit = animations.at(-1);
    controller.open(trigger);
    const active = document.querySelector('[role=menu]');
    assert.equal(closing.isConnected, false, 'reopening retires the old animation immediately');
    oldExit.finish();
    await Promise.resolve();
    assert.ok(active.isConnected, 'a stale completion cannot remove the new instance');
    controller.close();
    animations.at(-1).finish();
    await Promise.resolve();
    assert.equal(document.querySelector('.menu-exit'), null);
    document.documentElement.dataset.motionInput = 'keyboard';
    const count = animations.length;
    controller.open(trigger);
    controller.close({ restoreFocus: true });
    assert.equal(animations.length, count, 'keyboard operation remains immediate');
    assert.equal(document.activeElement, trigger);
  } finally { controller.destroy(); dom.window.close(); }
});

test('reduced motion skips both menu entrances and exits', () => {
  const dom = new JSDOM('<button data-context-kind="folder" data-context-id="f_one">Folder</button>', { pretendToBeVisual: true });
  dom.window.matchMedia = () => ({ matches: true });
  dom.window.HTMLElement.prototype.animate = () => assert.fail('reduced motion must not start an animation');
  const controller = createContextMenu({ document: dom.window.document, itemsFor: () => [{ label: 'Rename' }] });
  try {
    controller.open(dom.window.document.querySelector('button'));
    controller.close();
    assert.equal(dom.window.document.querySelector('.menu-surface'), null);
  } finally { controller.destroy(); dom.window.close(); }
});
