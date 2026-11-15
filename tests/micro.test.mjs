import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { setupGlideSelect } from '../web/glide-select.mjs';
import { setupMicroInteractions, shredAttachment } from '../web/micro.mjs';

function fixture(t, extra = '') {
  const dom = new JSDOM(`<form><label>Resource type<select id="kind" class="filter-select" name="kind"><option value="all">All types</option><option value="unavailable" disabled>Unavailable</option><option value="image">Images</option><option value="text">Notes</option></select></label></form>${extra}`, { pretendToBeVisual: true });
  dom.window.matchMedia = () => ({ matches: false });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  return { dom, doc, $: selector => doc.querySelector(selector), key(node, key) { node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); } };
}

test('Glide Select keeps native form values and emits one real change event for a pointer choice', t => {
  const f = fixture(t), control = setupGlideSelect(f.doc); t.after(() => control.destroy());
  let changes = 0; f.$('select').addEventListener('change', () => changes++);
  f.$('.glide-trigger').click();
  assert.equal(f.$('.glide-menu').getAttribute('role'), 'listbox');
  f.doc.querySelectorAll('.glide-option')[2].click();
  assert.equal(f.$('select').value, 'image'); assert.equal(changes, 1);
  assert.equal(new f.dom.window.FormData(f.$('form')).get('kind'), 'image');
  assert.match(f.$('.glide-trigger').getAttribute('aria-label'), /Images/);
  assert.equal(f.$('.glide-menu'), null);
  assert.equal(f.doc.activeElement, f.$('.glide-trigger'));
});

test('keyboard navigation skips disabled choices and Escape cancels without changing the selected value', t => {
  const f = fixture(t), control = setupGlideSelect(f.doc); t.after(() => control.destroy());
  const trigger = f.$('.glide-trigger'); trigger.focus(); f.key(trigger, 'ArrowDown');
  const list = f.$('.glide-menu'); f.key(list, 'ArrowDown');
  assert.equal(list.getAttribute('aria-activedescendant'), f.doc.querySelectorAll('.glide-option')[2].id);
  f.key(list, 'Escape'); assert.equal(f.$('select').value, 'all'); assert.equal(f.doc.activeElement, trigger);
  f.key(trigger, 'ArrowDown'); f.key(f.$('.glide-menu'), 'n'); f.key(f.$('.glide-menu'), 'Enter');
  assert.equal(f.$('select').value, 'text');
});

test('filter refreshes synchronize programmatic updates, dismiss detached controls, and restore native semantics on teardown', t => {
  const f = fixture(t), control = setupGlideSelect(f.doc);
  const select = f.$('select'); select.value = 'text'; control.refresh();
  assert.match(f.$('.glide-trigger').textContent, /Notes/);
  f.$('.glide-trigger').click();
  f.doc.body.dispatchEvent(new f.dom.window.Event('pointerdown', { bubbles: true }));
  assert.equal(f.$('.glide-menu'), null);
  f.$('.glide-trigger').click(); f.$('form').remove(); control.refresh();
  assert.equal(f.$('.glide-menu'), null); control.destroy();
  const fresh = f.doc.createElement('select'); fresh.className = 'filter-select'; fresh.innerHTML = '<option>Visible again</option>'; f.doc.body.append(fresh);
  const second = setupGlideSelect(f.doc); second.destroy();
  assert.equal(fresh.getAttribute('tabindex'), null); assert.equal(fresh.getAttribute('aria-hidden'), null); assert.equal(fresh.closest('.glide-control'), null);
});

test('segmented controls retain native keyboard actions and the wake slider retains native range values', async t => {
  const f = fixture(t, '<div class="view-toggle"><button aria-pressed="true">Grid</button><button aria-pressed="false">List</button></div><label class="wake-slider"><input type="range" min="20" max="200" value="100" aria-label="Canvas zoom"></label>');
  let picked = '';
  f.$('.view-toggle').addEventListener('click', event => { picked = event.target.textContent; });
  const micro = setupMicroInteractions(f.doc); t.after(() => micro.destroy());
  const errors = []; f.dom.window.addEventListener('error', event => errors.push(event.message));
  f.key(f.doc, 'ArrowLeft'); f.key(f.doc, 'Escape');
  assert.deepEqual(errors, [], 'page keyboard shortcuts do not require an element target');
  f.key(f.$('.view-toggle button'), 'ArrowRight'); assert.equal(picked, 'List');
  const input = f.$('.wake-slider input'); input.value = '150'; input.dispatchEvent(new f.dom.window.Event('input', { bubbles: true }));
  assert.equal(input.value, '150'); assert.equal(input.getAttribute('aria-label'), 'Canvas zoom');
  assert.ok(f.doc.querySelectorAll('.wake-bars i[data-on=true]').length > 14);
  micro.destroy(); await new Promise(resolve => f.dom.window.requestAnimationFrame(resolve));
});

test('reduced motion never creates attachment shredding overlays', t => {
  const f = fixture(t, '<div class="resource-file">A pending document</div>');
  f.dom.window.matchMedia = () => ({ matches: true });
  shredAttachment(f.$('.resource-file'));
  assert.equal(f.$('.micro-shred'), null); assert.match(f.$('.resource-file').textContent, /pending document/);
});
