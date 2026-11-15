import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { setupMotion } from '../web/motion.mjs';

function fixture() {
  const dom = new JSDOM('<body><main id="content"></main><button>Toggle</button></body>', { pretendToBeVisual: true });
  const { document } = dom.window;
  const reduced = new dom.window.EventTarget();
  reduced.matches = false;
  dom.window.matchMedia = () => reduced;
  const calls = [];
  document.querySelector('main').animate = (frames, options) => {
    let resolve, reject;
    const animation = { frames, options, canceled: false, finished: new Promise((yes, no) => { resolve = yes; reject = no; }), cancel() { this.canceled = true; reject(new Error('Canceled')); }, finish() { resolve(); } };
    calls.push(animation); return animation;
  };
  const motion = setupMotion(document);
  const event = type => document.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
  return { dom, document, reduced, calls, motion, event };
}

test('keyboard actions and reduced-motion preferences cancel animation and remain immediate', async () => {
  const f = fixture();
  try {
    const content = f.document.querySelector('main');
    f.motion.enterPage(content);
    assert.equal(f.calls.length, 1);
    f.event('keydown');
    assert.equal(f.calls[0].canceled, true, 'typing interrupts an in-flight pointer transition');
    f.motion.enterPage(content);
    assert.equal(f.calls.length, 1, 'keyboard navigation never starts a new animation');
    let updates = 0;
    f.motion.layout(() => updates++);
    assert.equal(updates, 1, 'layout changes still take effect immediately');
    f.event('pointerdown');
    f.motion.enterPage(content);
    assert.equal(f.calls.length, 2);
    f.reduced.matches = true;
    f.reduced.dispatchEvent(new f.dom.window.Event('change'));
    assert.equal(f.calls[1].canceled, true);
    f.motion.enterPage(content);
    assert.equal(f.calls.length, 2);
  } finally { f.motion.destroy(); f.dom.window.close(); }
});

test('rapid sidebar changes interrupt old snapshots without losing the latest layout update', async () => {
  const f = fixture();
  const transitions = [];
  try {
    f.document.startViewTransition = update => {
      let finish;
      const transition = { ready: Promise.resolve(), updateCallbackDone: Promise.resolve().then(update), finished: new Promise(resolve => { finish = resolve; }), skipped: false, skipTransition() { this.skipped = true; finish(); }, finish() { finish(); } };
      transitions.push(transition); return transition;
    };
    let expanded = true;
    f.motion.layout(() => { expanded = false; });
    await transitions[0].updateCallbackDone;
    assert.equal(expanded, false);
    f.motion.layout(() => { expanded = true; });
    await transitions[1].updateCallbackDone;
    assert.equal(transitions[0].skipped, true);
    assert.equal(expanded, true);
    f.event('keydown');
    assert.equal(transitions[1].skipped, true);
    await transitions[1].finished;
    await Promise.resolve();
    assert.equal(f.document.body.hasAttribute('data-layout-transition'), false);
    f.motion.layout(() => { expanded = false; });
    assert.equal(expanded, false);
    assert.equal(transitions.length, 2, 'keyboard toggles bypass snapshots');
  } finally { f.motion.destroy(); f.dom.window.close(); }
});

test('unavailable snapshot animation falls back to a usable synchronous sidebar', () => {
  const f = fixture();
  try {
    f.document.startViewTransition = () => { throw new Error('Unavailable'); };
    let updates = 0;
    f.motion.layout(() => updates++);
    assert.equal(updates, 1);
    assert.equal(f.document.body.hasAttribute('data-layout-transition'), false);
  } finally { f.motion.destroy(); f.dom.window.close(); }
});
