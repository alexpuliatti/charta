import test from 'node:test';
import assert from 'node:assert/strict';
import { isTweet, tweetText } from '../shared/tweets.mjs';
import { loadLibrary } from '../scripts/library.mjs';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

test('tweet detection recognizes X, Twitter, and curated imports without matching profiles or other hosts', () => {
  for (const url of ['https://x.com/ada/status/123', 'https://www.twitter.com/ada/status/123?s=20', 'https://mobile.twitter.com/ada/status/123/video/1', 'https://x.com/i/web/status/123']) {
    assert.equal(isTweet({ source: { url } }), true, url);
  }
  for (const url of ['https://x.com/ada', 'https://example.com/ada/status/123', 'https://x.com.example.com/ada/status/123', 'https://example.com/?url=https://x.com/ada/status/123', 'invalid']) {
    assert.equal(isTweet({ source: { url } }), false, url);
  }
  assert.equal(isTweet({ curation: { genre: 'tweet' } }), true);
  for (const type of ['image', 'video']) assert.equal(isTweet({ type, source: { url: 'https://x.com/ada/status/123' } }), false, 'saved media keeps its own preview');
  assert.equal(tweetText({ description: 'An archive note', artifact: { text: 'OCR description' } }), '');
  assert.equal(tweetText({ body: '---\ntitle: Saved tweet\n---\n[ada](https://x.com/ada)\n\nA thought.\nAnother line.' }), 'ada\n\nA thought.\nAnother line.');
});

test('all four saved tweets have captured text, including both Thomson imports', async () => {
  const catalog = await loadLibrary(fileURLToPath(new URL('../', import.meta.url)));
  const tweets = catalog.blocks.filter(block => block.curation?.genre === 'tweet');
  assert.equal(tweets.length, 4);
  for (const block of tweets) assert.ok(tweetText(block), `Missing captured text: ${block.id}`);
  for (const id of ['b_arena_52320362', 'b_arena_52320357']) {
    const block = tweets.find(block => block.id === id);
    assert.equal(tweetText(block), 'The weather looks beautiful today');
    assert.equal(new URL(block.source.url).pathname, '/willthomson__/status/2117673434066923965/video/1');
  }
});

test('the actual app shows all archived tweet bodies in cards and opens short tweets as text', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'charta-tweets-app-'));
  let dom;
  const globals = new Map(), errors = [];
  const install = (key, value) => {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  try {
    const catalog = await loadLibrary(fileURLToPath(new URL('../', import.meta.url)));
    catalog.blocks = catalog.blocks.filter(block => block.curation?.genre === 'tweet');
    catalog.collections = catalog.collections.filter(collection => collection.id === 'c_curated_writing_tweets');
    await cp(new URL('../web/', import.meta.url), path.join(root, 'web'), { recursive: true });
    await cp(new URL('../shared/', import.meta.url), path.join(root, 'web/shared'), { recursive: true });
    const virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', error => errors.push(error.message));
    dom = new JSDOM(await readFile(path.join(root, 'web/index.html'), 'utf8'), {
      url: 'http://127.0.0.1:4173/#/collection/c_curated_writing_tweets', pretendToBeVisual: true, virtualConsole
    });
    const { window } = dom, document = window.document;
    window.matchMedia = query => ({ matches: query.includes('min-width: 801px'), addEventListener() {}, removeEventListener() {} });
    window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    for (const key of ['window', 'document', 'location', 'localStorage', 'HTMLElement', 'HTMLFormElement', 'FormData', 'AbortController']) install(key, key === 'window' ? window : window[key]);
    install('requestAnimationFrame', window.requestAnimationFrame.bind(window));
    install('cancelAnimationFrame', window.cancelAnimationFrame.bind(window));
    install('ResizeObserver', undefined);
    install('fetch', async () => new Response(JSON.stringify(catalog), { headers: { 'Content-Type': 'application/json' } }));
    await import(pathToFileURL(path.join(root, 'web/app.mjs')));
    assert.equal(document.querySelectorAll('#content .material-card').length, 4);
    for (const block of catalog.blocks) {
      const card = document.querySelector(`#content [data-context-id="${block.id}"]`);
      assert.ok(card.querySelector('.note-preview').textContent.includes(tweetText(block).slice(0, 400)));
      assert.equal(card.querySelector('img'), null, `${block.title} must display text instead of a screenshot`);
    }
    document.querySelector('#content [data-context-id="b_arena_52320362"] .card-open').click();
    for (let i = 0; i < 100 && !document.querySelector('#detail').open; i++) await pause(10);
    assert.equal(document.querySelector('#detail').open, true);
    assert.equal(document.querySelector('.artefact-text').textContent, 'The weather looks beautiful today');
    assert.equal(document.querySelector('.detail-stage img'), null);
    assert.deepEqual(errors, []);
  } finally {
    dom?.window.close();
    for (const [key, previous] of globals) {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else delete globalThis[key];
    }
    await rm(root, { recursive: true, force: true });
  }
});
