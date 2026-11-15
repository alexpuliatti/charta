import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const extractor = await readFile(new URL('../vendor/defuddle.js', import.meta.url), 'utf8');
const adapter = await readFile(new URL('../capture.js', import.meta.url), 'utf8');

function page(html, url = 'https://example.com/article') {
  const dom = new JSDOM(`<!doctype html><html>${html}</html>`, { url, runScripts: 'outside-only' });
  dom.window.fetch = () => { throw new Error('Capture must never fetch.'); };
  dom.window.eval(extractor);
  dom.window.eval(adapter);
  return dom;
}

function tweet(id, handle = 'ada', body = `Post ${id}`, extra = '') {
  return `<article data-testid="tweet"><div data-testid="User-Name"><a href="/${handle}">@${handle}</a></div><a href="/${handle}/status/${id}"><time datetime="2026-11-15T10:00:00Z">Today</time></a><div data-testid="tweetText">${body}</div>${extra}</article>`;
}

test('real packaged Defuddle preserves article Markdown and metadata without mutating the page', async () => {
  const dom = page(`<head><title>A useful article</title><link rel="canonical" href="/canonical"><meta name="author" content="Ada Lovelace"><meta property="article:published_time" content="2026-11-14"><meta name="description" content="An article about useful ideas."></head><body><nav>Unrelated navigation</nav><article><h1>A useful article</h1><p>Hello <strong>world</strong>. This readable article contains ideas and supporting details.</p><h2>A section</h2><ul><li>First point</li><li>Second point</li></ul><p><a href="/reference">Reference</a></p><pre><code>const answer = 42;</code></pre><img src="/image.jpg" alt="An illustration" width="800" height="600"></article></body>`);
  try {
    const before = dom.window.document.documentElement.outerHTML;
    const result = await dom.window.__jellyCapture.capture({ mode: 'article' });
    assert.equal(result.title, 'A useful article');
    assert.equal(result.author, 'Ada Lovelace');
    assert.equal(result.published, '2026-11-14');
    assert.equal(result.url, 'https://example.com/canonical');
    assert.match(result.markdown, /\*\*world\*\*/);
    assert.match(result.markdown, /## A section/);
    assert.match(result.markdown, /- First point/);
    assert.match(result.markdown, /\[Reference\]\(https:\/\/example.com\/reference\)/);
    assert.match(result.markdown, /```\nconst answer = 42;/);
    assert.match(result.markdown, /!\[An illustration\]\(https:\/\/example.com\/image.jpg\)/);
    assert.doesNotMatch(result.markdown, /Unrelated navigation/);
    assert.equal(result.extraction.method, 'defuddle-0.19.2');
    assert.equal(result.extraction.kind, 'article');
    assert.equal(dom.window.document.documentElement.outerHTML, before);
  } finally { dom.window.close(); }
});

test('selection capture preserves rich formatting and uses the current URL without a canonical', async () => {
  const dom = page('<head><title>Selection</title></head><body><article><h2>Selected heading</h2><p>A <em>formatted</em> <a href="/linked">passage</a>.</p><button>Ignore button</button></article></body>');
  try {
    const range = dom.window.document.createRange();
    range.selectNodeContents(dom.window.document.querySelector('article'));
    dom.window.getSelection().addRange(range);
    const result = await dom.window.__jellyCapture.capture();
    assert.equal(result.url, 'https://example.com/article');
    assert.equal(result.extraction.kind, 'selection');
    assert.match(result.markdown, /## Selected heading/);
    assert.match(result.markdown, /\*formatted\*/);
    assert.match(result.markdown, /\[passage\]\(https:\/\/example.com\/linked\)/);
    assert.doesNotMatch(result.markdown, /Ignore button/);
  } finally { dom.window.close(); }
});

test('thread capture keeps contiguous author posts, links, dates and media; excludes replies and quotes', async () => {
  const quote = '<div role="link"><div data-testid="User-Name">@someone</div><a href="/someone/status/999"><time datetime="2026-01-01">Quoted</time></a><div data-testid="tweetText">Quoted person</div><img src="https://pbs.twimg.com/media/quoted.jpg"></div>';
  const dom = page(`<head><title>X</title></head><body><main data-testid="primaryColumn"><h2>Post</h2>${tweet('101', 'ada', 'First post')}${tweet('102', 'ada', 'A <a href="https://example.org/source">source</a>\nSecond line', '<img src="https://pbs.twimg.com/media/photo.jpg" alt="Useful image">' + quote + '<div data-testid="videoPlayer"></div>')}${tweet('103', 'ada', 'Third post')}${tweet('201', 'other', 'A reply by someone else')}${tweet('104', 'ada', 'A later reply outside the thread')}</main></body>`, 'https://x.com/ada/status/102');
  try {
    const result = await dom.window.__jellyCapture.capture();
    assert.equal(result.extraction.kind, 'thread');
    assert.equal(result.extraction.loadedPostCount, 3);
    assert.equal(result.author, '@ada');
    assert.equal(result.url, 'https://x.com/ada/status/102');
    assert.equal(result.published, '2026-11-15T10:00:00Z');
    assert.match(result.markdown, /First post/);
    assert.match(result.markdown, /Third post/);
    assert.match(result.markdown, /https:\/\/x.com\/ada\/status\/102/);
    assert.match(result.markdown, /2026-11-15T10:00:00Z/);
    assert.match(result.markdown, /\[source\]\(https:\/\/example.org\/source\)/);
    assert.match(result.markdown, /!\[Useful image\]\(https:\/\/pbs.twimg.com\/media\/photo.jpg\)/);
    assert.match(result.markdown, /Watch video on X/);
    assert.doesNotMatch(result.markdown, /Quoted person|quoted.jpg|someone else|outside the thread/);
    assert.equal(result.extraction.canLoadMore, false);
    assert.equal(result.extraction.truncated, true);
    assert.match(result.extraction.warning, /may hide or unload/);
    assert.deepEqual(JSON.parse(JSON.stringify(result.extraction.posts)).map(post => post.id), ['101', '102', '103']);
  } finally { dom.window.close(); }
});

test('recommendation heading ends a thread before unrelated posts by the same author', async () => {
  const dom = page(`<body><main>${tweet('102')}<h2>Discover more</h2>${tweet('103', 'ada', 'Recommendation')}</main></body>`, 'https://twitter.com/ada/status/102');
  try {
    const result = await dom.window.__jellyCapture.capture();
    assert.equal(result.extraction.loadedPostCount, 1);
    assert.equal(result.extraction.canLoadMore, false);
    assert.doesNotMatch(result.markdown, /Recommendation/);
  } finally { dom.window.close(); }
});

test('explicit load more retains posts across X virtualization, deduplicates and stops at replies', async () => {
  const dom = page(`<body><main>${tweet('101')}${tweet('102')}${tweet('103')}</main></body>`, 'https://x.com/ada/status/102');
  try {
    let scrolls = 0;
    dom.window.scrollBy = () => {
      scrolls += 1;
      dom.window.document.querySelector('main').innerHTML = scrolls === 1
        ? tweet('103') + tweet('104')
        : tweet('104') + tweet('201', 'other', 'Excluded reply');
    };
    const result = await dom.window.__jellyCapture.capture({ mode: 'thread', loadMore: true });
    assert.equal(scrolls, 2);
    assert.equal(result.extraction.loadedPostCount, 4);
    assert.deepEqual(JSON.parse(JSON.stringify(result.extraction.posts)).map(post => post.id), ['101', '102', '103', '104']);
    assert.equal(result.markdown.match(/Post 103/g).length, 1);
    assert.doesNotMatch(result.markdown, /Excluded reply/);
    assert.equal(result.extraction.canLoadMore, false);
  } finally { dom.window.close(); }
});

test('thread capture refuses to substitute a different loaded post for the target', async () => {
  const dom = page(`<body><main>${tweet('999', 'someone')}</main></body>`, 'https://x.com/ada/status/102');
  try {
    await assert.rejects(dom.window.__jellyCapture.capture(), /selected post is not loaded/);
  } finally { dom.window.close(); }
});

test('oversized selections fail visibly instead of silently truncating archived Markdown', async () => {
  const dom = page(`<body><article>${'Long content '.repeat(42_000)}</article></body>`);
  try {
    const range = dom.window.document.createRange();
    range.selectNodeContents(dom.window.document.querySelector('article'));
    dom.window.getSelection().addRange(range);
    await assert.rejects(dom.window.__jellyCapture.capture({ mode: 'selection' }), /too large/);
  } finally { dom.window.close(); }
});

test('dangerous canonicals are ignored and unsupported modes are rejected', async () => {
  const dom = page('<head><link rel="canonical" href="javascript:alert(1)"></head><body><article><p>Readable page content.</p></article></body>');
  try {
    const result = await dom.window.__jellyCapture.capture({ mode: 'article' });
    assert.equal(result.url, 'https://example.com/article');
    await assert.rejects(dom.window.__jellyCapture.capture({ mode: 'unknown' }), /Choose article/);
  } finally { dom.window.close(); }
});
