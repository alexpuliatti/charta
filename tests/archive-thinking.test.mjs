import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { setupResearch } from '../web/research.mjs';

test('research releases the Orb on completion, failure, cancellation, and navigation', async () => {
  const dom = new JSDOM('<main class="research-content"></main>', { url: 'http://localhost/' });
  const { document } = dom.window, root = document.querySelector('main');
  const mounts = [], destroyed = [], requests = [], pending = [];
  const animation = { mountArchiveThinking(element) {
    mounts.push(element); element.append(document.createElement('canvas'));
    return { destroy() { destroyed.push(element); element.replaceChildren(); } };
  } };
  let loadThinking = () => Promise.resolve(animation), controller;
  try {
    controller = setupResearch({ document, getCatalog: () => ({ blocks: [] }),
      navigate(hash) { controller.render(root, hash.split('/').at(-1)); },
      loadThinking: () => loadThinking(),
      fetch(url, options) { requests.push({ url, options }); return new Promise(resolve => pending.push(resolve)); },
    });
    controller.render(root, 'new');
    assert.equal(mounts.length, 0, 'the animation stays unloaded until a running question is shown');
    controller.start('A question to complete'); await pause(0);
    assert.equal(mounts.length, 1); assert.ok(root.querySelector('[data-react-bits="Orb"] canvas'));
    assert.equal(root.querySelector('.archive-thinking-visual').getAttribute('aria-hidden'), 'true');
    pending[0](Response.json({ summary: 'The answer is ready.', resources: [] })); await pause(0);
    assert.equal(destroyed.length, 1); assert.equal(root.querySelector('canvas'), null);
    assert.match(root.textContent, /The answer is ready/);

    controller.start('A question to cancel'); await pause(0);
    root.querySelector('[data-research-cancel]').click();
    assert.equal(requests[1].options.signal.aborted, true);
    assert.equal(destroyed.length, 2); assert.equal(root.querySelector('canvas'), null);
    pending[1](Response.json({ summary: 'A stale cancelled answer.', resources: [] })); await pause(0);
    assert.equal(root.textContent.includes('A stale cancelled answer'), false);

    controller.start('A question that fails'); await pause(0);
    pending[2](Response.json({ error: 'ChatGPT is unavailable.' }, { status: 503 })); await pause(0);
    assert.equal(destroyed.length, 3); assert.match(root.textContent, /ChatGPT is unavailable/);

    controller.start('A question to leave running'); await pause(0);
    controller.unmount(); root.replaceChildren();
    assert.equal(destroyed.length, 4);
    assert.equal(requests[3].options.signal.aborted, false, 'leaving the view stops drawing while research continues');
    controller.render(root); await pause(0);
    assert.equal(mounts.length, 5, 'returning to a running question mounts a fresh Orb');
    pending[3](Response.json({ summary: 'The background request completed.', resources: [] })); await pause(0);
    assert.equal(destroyed.length, 5);

    let finishLoading;
    loadThinking = () => new Promise(resolve => { finishLoading = resolve; });
    controller.start('Cancel before the animation downloads');
    root.querySelector('[data-research-cancel]').click(); finishLoading(animation); await pause(0);
    assert.equal(mounts.length, 5, 'a late module cannot mount after cancellation');
    pending[4](Response.json({ summary: 'Late answer.', resources: [] })); await pause(0);

    loadThinking = () => Promise.reject(new Error('Animation unavailable'));
    controller.start('Keep working if the animation cannot load'); await pause(0);
    assert.ok(root.querySelector('.archive-thinking-fallback'));
    assert.equal(requests.length, 6);
    pending[5](Response.json({ summary: 'The request still completed.', resources: [] })); await pause(0);
    assert.match(root.textContent, /The request still completed/);
  } finally { controller?.unmount(); dom.window.close(); }
});
