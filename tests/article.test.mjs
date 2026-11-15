import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { serializeMarkdown } from '../shared/clip-markdown.mjs';

test('archive renders a saved Markdown clip safely, retaining raw export and capture context', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'jelly-article-'));
  await mkdir(path.join(fixture, 'shared'));
  for (const file of ['article.mjs', 'reader-render.mjs']) await cp(new URL('../web/' + file, import.meta.url), path.join(fixture, file));
  await cp(new URL('../shared/clip-markdown.mjs', import.meta.url), path.join(fixture, 'shared/clip-markdown.mjs'));
  const { renderSavedArticle } = await import(pathToFileURL(path.join(fixture, 'article.mjs')));
  const dom = new JSDOM('<main></main>', { url: 'https://example.github.io/Jelly/', runScripts: 'outside-only' });
  const previous = { marked: globalThis.marked, DOMPurify: globalThis.DOMPurify };
  try {
    for (const file of ['marked.umd.js', 'purify.min.js']) dom.window.eval(await readFile(new URL('../web/vendor/' + file, import.meta.url), 'utf8'));
    globalThis.marked = dom.window.marked;
    globalThis.DOMPurify = dom.window.DOMPurify;
    const capture = { title: 'A saved article', url: 'https://example.com/article', capturedAt: '2026-11-15', category: 'Design', tags: ['reading'], article: { author: 'Ada', published: '2026-11-14' }, extraction: { kind: 'thread', warning: 'Loaded posts only.' }, body: 'A **useful** idea.\n\n[Reference](/source)\n\n<script>bad()</script><img src="x" onerror="bad()"><iframe src="https://evil.example"></iframe>' };
    const block = { title: capture.title, source: { url: capture.url }, article: capture.article, capture: capture.extraction, body: serializeMarkdown(capture), contentFormat: 'markdown' };
    const target = dom.window.document.querySelector('main');
    renderSavedArticle(block, target);
    assert.equal(target.querySelector('.article-byline').textContent, 'Ada · 2026-11-14');
    assert.equal(target.querySelector('.article-warning').textContent, 'Loaded posts only.');
    const body = target.querySelector('.article-body');
    assert.equal(body.querySelector('strong').textContent, 'useful');
    assert.equal(body.querySelector('a').href, 'https://example.com/source');
    assert.equal(body.querySelector('h1'), null, 'title is already displayed by the archive');
    assert.equal(body.querySelector('script,iframe,[onerror]'), null);
    assert.doesNotMatch(body.textContent, /tags:|created:|category:/);
    assert.equal(target.querySelector('.article-markdown pre').textContent, block.body);
    assert.equal(target.querySelector('.article-download').textContent, 'Download Markdown ↓');
  } finally {
    globalThis.marked = previous.marked;
    globalThis.DOMPurify = previous.DOMPurify;
    dom.window.close();
    await rm(fixture, { recursive: true, force: true });
  }
});
