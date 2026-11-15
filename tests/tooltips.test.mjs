import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { setupWarmTooltips } from '../web/tooltips.mjs';

function fixture(t) {
  const dom = new JSDOM('<dialog class="artefact-dialog" open><button title="Close preview" aria-label="Close preview" aria-describedby="existing-help">×</button><button title="Show tags and information" aria-label="Show tags and information">+</button></dialog><button title="Outside">Outside</button>');
  const { window } = dom, { document } = window;
  let clock = 0, nextTimer = 0;
  const timers = new Map();
  Object.defineProperty(window.performance, 'now', { value: () => clock });
  window.setTimeout = (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, due: clock + delay }); return id; };
  window.clearTimeout = id => timers.delete(id);
  const controller = setupWarmTooltips(document), buttons = [...document.querySelectorAll('button')];
  const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
  document.querySelector('dialog').getBoundingClientRect = () => rect(100, 100, 300, 250);
  buttons[0].getBoundingClientRect = () => rect(112, 112, 38, 38);
  buttons[1].getBoundingClientRect = () => rect(350, 300, 38, 38);
  const emit = (target, type, options = {}) => {
    const event = new window.MouseEvent(type, { bubbles: true, relatedTarget: options.relatedTarget || null });
    Object.defineProperty(event, 'pointerType', { value: options.pointerType || 'mouse' });
    target.dispatchEvent(event);
  };
  const keyboardFocus = button => {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    emit(button, 'focusin');
  };
  const tick = amount => {
    clock += amount;
    for (const [id, timer] of [...timers]) if (timer.due <= clock) { timers.delete(id); timer.callback(); }
  };
  t.after(() => { controller.destroy(); dom.window.close(); });
  return { document, window, buttons, controller, tick, emit, keyboardFocus, tooltip: () => document.querySelector('[role=tooltip]') };
}

test('the first tooltip waits, sibling labels stay warm briefly, and native titles return', t => {
  const f = fixture(t), [close, info] = f.buttons;
  f.emit(close, 'pointerover');
  assert.equal(close.hasAttribute('title'), false, 'native tooltips do not compete with the grouped label');
  f.tick(499); assert.equal(f.tooltip(), null);
  f.tick(1); assert.equal(f.tooltip().textContent, 'Close preview');
  assert.equal(f.tooltip().parentElement, close.closest('dialog'), 'the label stays inside the native modal top layer');
  assert.match(close.getAttribute('aria-describedby'), /^existing-help warm-tooltip-/);
  f.emit(close, 'pointerout', { relatedTarget: info });
  assert.equal(close.getAttribute('title'), 'Close preview');
  assert.equal(close.getAttribute('aria-describedby'), 'existing-help');
  f.emit(info, 'pointerover');
  assert.equal(f.tooltip().textContent, 'Show tags and information', 'a sibling label opens immediately while the group is warm');
  f.emit(info, 'pointerout'); f.tick(501); f.emit(close, 'pointerover');
  assert.equal(f.tooltip(), null, 'the group cools after its grace period');
  f.tick(500); assert.equal(f.tooltip().textContent, 'Close preview');
});

test('focus labels appear immediately and pointer presses or Escape dismiss them', t => {
  const f = fixture(t), [close, info] = f.buttons;
  f.emit(close, 'focusin');
  assert.equal(f.tooltip(), null, 'automatic dialog focus does not show a label over the artifact');
  f.emit(close, 'pointerover');
  assert.equal(f.tooltip(), null);
  f.keyboardFocus(close);
  assert.equal(f.tooltip().textContent, 'Close preview', 'keyboard focus bypasses an already pending pointer delay');
  f.emit(close, 'focusout', { relatedTarget: info });
  assert.equal(f.tooltip(), null);
  f.keyboardFocus(info);
  f.document.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(f.tooltip(), null);
  assert.equal(info.getAttribute('title'), 'Show tags and information');
  f.keyboardFocus(close); f.emit(close, 'pointerdown');
  assert.equal(f.tooltip(), null);
  assert.equal(close.getAttribute('aria-describedby'), 'existing-help');
  f.emit(close, 'focusin'); f.tick(500);
  assert.equal(f.tooltip(), null, 'focus following a pointer press keeps the artifact clear');
});

test('touch hover, unrelated buttons, and cancelled hover never show labels', t => {
  const f = fixture(t), [close, , outside] = f.buttons;
  f.emit(close, 'pointerover', { pointerType: 'touch' }); f.tick(500);
  assert.equal(f.tooltip(), null);
  assert.equal(close.getAttribute('title'), 'Close preview');
  f.emit(outside, 'pointerover'); f.tick(500); assert.equal(f.tooltip(), null);
  f.emit(close, 'pointerover'); f.tick(100); f.emit(close, 'pointerout'); f.tick(500);
  assert.equal(f.tooltip(), null);
  assert.equal(close.getAttribute('title'), 'Close preview');
});

test('dynamic control labels update safely and replaced or closed dialogs dismiss stale labels', async t => {
  const f = fixture(t), [, info] = f.buttons;
  f.keyboardFocus(info);
  info.setAttribute('title', 'Hide tags and information');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.tooltip().textContent, 'Hide tags and information');
  assert.equal(info.hasAttribute('title'), false);
  f.emit(info, 'pointerdown');
  assert.equal(info.getAttribute('title'), 'Hide tags and information');
  f.keyboardFocus(info); info.closest('dialog').removeAttribute('open');
  await Promise.resolve();
  assert.equal(f.tooltip(), null);
  assert.equal(info.hasAttribute('aria-describedby'), false);
  info.closest('dialog').setAttribute('open', ''); f.keyboardFocus(info); info.remove();
  await Promise.resolve();
  assert.equal(f.tooltip(), null);
});

test('labels fit the dialog and flip above controls near the bottom edge', t => {
  const f = fixture(t), [, info] = f.buttons;
  const original = f.window.HTMLElement.prototype.getBoundingClientRect;
  f.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.classList.contains('warm-tooltip') ? { width: 180, height: 32 } : original.call(this);
  };
  f.keyboardFocus(info);
  assert.equal(f.tooltip().style.left, '108px', 'long labels stop before the right edge');
  assert.equal(f.tooltip().style.top, '160px', 'labels flip above a lower control');
  f.controller.destroy();
  assert.equal(f.tooltip(), null);
  assert.equal(info.getAttribute('title'), 'Show tags and information');
  f.emit(info, 'pointerover'); f.tick(1000); assert.equal(f.tooltip(), null, 'destroy removes delegated listeners');
});
