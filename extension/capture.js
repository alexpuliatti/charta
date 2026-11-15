/* Charta capture adapter. Runs only in the active tab's isolated world. */
(() => {
  'use strict';
  const MAX_MARKDOWN = 500_000;
  const MAX_HTML = 2_000_000;
  const MAX_POSTS = 200;
  const MAX_SCROLLS = 8;
  // Preserve already observed posts when X virtualizes them during an explicit
  // “Load more” action. The cache belongs to this tab, never extension storage.
  const state = globalThis.__jellyCaptureState || { thread: null };
  globalThis.__jellyCaptureState = state;

  function text(value, limit = 2000) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  function httpURL(value, base = document.URL) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const parsed = new URL(value, base);
      return /^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : '';
    } catch { return ''; }
  }

  function canonicalURL() {
    return httpURL(document.querySelector('link[rel~="canonical"]')?.getAttribute('href')) || httpURL(document.URL);
  }

  function engine() {
    if (typeof globalThis.Defuddle !== 'function' || typeof globalThis.Defuddle.createMarkdownContent !== 'function') {
      throw new Error('The packaged article extractor could not be loaded. Reload the Charta extension.');
    }
    return globalThis.Defuddle;
  }

  function markdown(html, url) {
    return engine().createMarkdownContent(html, url).trim();
  }

  function normalizeHTML(html, url) {
    const container = document.createElement('div');
    container.innerHTML = html;
    container.querySelectorAll('script,style,noscript,iframe,object,embed,form,input,button').forEach(el => el.remove());
    for (const el of container.querySelectorAll('*')) {
      for (const attribute of Array.from(el.attributes)) {
        if (/^on/i.test(attribute.name) || attribute.name === 'srcset') el.removeAttribute(attribute.name);
      }
      for (const attr of ['href', 'src', 'poster', 'cite']) {
        if (!el.hasAttribute(attr)) continue;
        const value = el.getAttribute(attr);
        const safe = attr === 'href' && /^mailto:[^\s]+$/i.test(value) ? value : httpURL(value, url);
        if (safe) el.setAttribute(attr, safe);
        else el.removeAttribute(attr);
      }
    }
    return container.innerHTML;
  }

  function wordCount(value) {
    return text(value, MAX_MARKDOWN).split(/\s+/u).filter(Boolean).length;
  }

  function finish(result) {
    if (!result.markdown?.trim()) throw new Error('No readable content was found. Select the text you want to clip, then try again.');
    if (result.markdown.length > MAX_MARKDOWN || result.html.length > MAX_HTML) {
      throw new Error('This capture is too large. Select a smaller part of the page (up to 500,000 Markdown characters).');
    }
    return {
      ...result,
      title: text(result.title || document.title || new URL(result.url).hostname, 500),
      author: text(result.author, 1000),
      published: text(result.published, 100),
      description: text(result.description, 2000),
      wordCount: Number.isFinite(result.wordCount) ? result.wordCount : wordCount(result.markdown)
    };
  }

  function selectionCapture() {
    const selection = globalThis.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !selection.toString().trim()) {
      throw new Error('Select the article text you want to save, then capture the selection.');
    }
    const container = document.createElement('article');
    for (let index = 0; index < selection.rangeCount; index += 1) {
      container.appendChild(selection.getRangeAt(index).cloneContents());
    }
    // The reader sanitizes HTML again. Removing active elements here also keeps
    // their text from becoming unwanted Markdown in a selected fragment.
    container.querySelectorAll('script,style,noscript,iframe,object,embed,form,input,button').forEach(el => el.remove());
    const url = canonicalURL();
    const html = normalizeHTML(container.innerHTML, url);
    return finish({
      title: document.title, url, html, markdown: markdown(html, url),
      author: document.querySelector('meta[name="author"]')?.content || '',
      published: document.querySelector('meta[property="article:published_time"]')?.content || '',
      description: '', wordCount: wordCount(container.textContent),
      extraction: { method: 'defuddle-0.19.2', kind: 'selection', truncated: false, loadedPostCount: 0, warning: '' }
    });
  }

  function articleCapture() {
    const url = canonicalURL();
    // Clone before parsing: Defuddle may normalize attributes and noscript
    // images. Never change the original page or send it to an extraction API.
    const clone = document.cloneNode(true);
    clone.querySelector('link[rel~="canonical"]')?.setAttribute('href', url);
    const result = new (engine())(clone, {
      url, useAsync: false, includeReplies: false, separateMarkdown: true,
      fetch: () => { throw new Error('Network extraction is disabled in Charta.'); }
    }).parse();
    return finish({
      title: result.title, url, html: result.content,
      markdown: result.contentMarkdown || markdown(result.content, url),
      author: result.author, published: result.published,
      description: result.description, wordCount: result.wordCount,
      extraction: {
        method: 'defuddle-0.19.2', kind: 'article', truncated: false, loadedPostCount: 0,
        warning: result.wordCount < 40 ? 'Very little article text was found. Review the preview, or select the text to capture.' : ''
      }
    });
  }

  function statusURL(value) {
    const url = httpURL(value);
    if (!url) return null;
    const parsed = new URL(url);
    if (!/(^|\.)(x\.com|twitter\.com)$/i.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(/^\/(\w{1,15})\/status\/(\d+)(?:\/|$)/);
    return match ? { handle: match[1].toLowerCase(), id: match[2], url: `${parsed.origin}/${match[1]}/status/${match[2]}` } : null;
  }

  function tweetDetails(article) {
    // A timestamp permalink identifies the post itself; content links may point
    // to quoted posts by someone else, so they must never determine the author.
    const times = Array.from(article.querySelectorAll('time'));
    for (const time of times) {
      if (time.closest('article') !== article || quotedContent(time, article)) continue;
      const source = statusURL(time.closest('a')?.getAttribute('href'));
      if (source) return { ...source, published: time.getAttribute('datetime') || '', element: article };
    }
    return null;
  }

  function quotedContent(element, article) {
    for (let parent = element.parentElement; parent && parent !== article; parent = parent.parentElement) {
      if (parent.getAttribute('data-testid') === 'quoteTweet') return true;
      if (parent.getAttribute('role') === 'link' && parent.querySelector('[data-testid="User-Name"]')) return true;
    }
    return false;
  }

  function conversationPosts() {
    const root = document.querySelector('[data-testid="primaryColumn"]') || document.querySelector('main') || document;
    const posts = [];
    // A heading/section after conversation cells is X's recommendation boundary.
    // Ignore headings inside a post and the “Post” heading before the first one.
    for (const el of root.querySelectorAll('article[data-testid="tweet"], article[role="article"], h2, section')) {
      if (el.matches('article')) {
        if (el.parentElement?.closest('article')) continue;
        const post = tweetDetails(el);
        if (post) posts.push(post);
      } else if (posts.length && !el.closest('article') && !el.querySelector('article')) {
        posts.boundary = true;
        break;
      }
    }
    return posts;
  }

  function postHTML(post) {
    const article = post.element;
    const wrapper = document.createElement('section');
    const header = document.createElement('p');
    const source = document.createElement('a');
    source.href = post.url;
    source.textContent = `@${post.handle}${post.published ? ` · ${post.published}` : ''}`;
    header.appendChild(source);
    wrapper.appendChild(header);
    const sourceText = article.querySelector('[data-testid="tweetText"], [data-testid="twitterArticleReadView"], [data-testid="longformRichTextComponent"]');
    if (sourceText) {
      const body = sourceText.cloneNode(true);
      body.querySelectorAll('[data-testid="quoteTweet"],script,style,button').forEach(el => el.remove());
      body.querySelectorAll('img[src*="/emoji/"]').forEach(img => img.replaceWith(img.getAttribute('alt') || ''));
      // tweetText uses CSS white-space: pre-wrap, which Markdown conversion
      // cannot see in a detached fragment. Preserve explicit line breaks.
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) if (walker.currentNode.textContent.includes('\n')) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const fragment = document.createDocumentFragment();
        node.textContent.split('\n').forEach((line, index) => {
          if (index) fragment.appendChild(document.createElement('br'));
          fragment.appendChild(document.createTextNode(line));
        });
        node.replaceWith(fragment);
      }
      wrapper.appendChild(body);
    }
    const images = new Set();
    for (const img of article.querySelectorAll('img[src*="pbs.twimg.com/media/"]')) {
      if (quotedContent(img, article)) continue;
      const src = httpURL(img.getAttribute('src'));
      if (!src || images.has(src)) continue;
      images.add(src);
      const image = document.createElement('img');
      image.src = src;
      image.alt = img.getAttribute('alt') || 'Image from post';
      wrapper.appendChild(image);
    }
    if (article.querySelector('video, [data-testid="videoPlayer"]')) {
      const p = document.createElement('p');
      const link = document.createElement('a');
      link.href = post.url;
      link.textContent = 'Watch video on X';
      p.appendChild(link);
      wrapper.appendChild(p);
    }
    // Card links can be the only reference to an article in a post.
    for (const card of article.querySelectorAll('[data-testid="card.wrapper"] a[href]')) {
      const href = httpURL(card.getAttribute('href'));
      if (!href || statusURL(href)) continue;
      const p = document.createElement('p');
      const link = document.createElement('a');
      link.href = href;
      link.textContent = text(card.textContent) || href;
      p.appendChild(link);
      wrapper.appendChild(p);
    }
    return wrapper.outerHTML;
  }

  function collectThread(target, cache) {
    const visible = conversationPosts();
    let anchor = visible.findIndex(post => post.id === target.id);
    if (anchor < 0) anchor = visible.findIndex(post => cache.posts.has(post.id));
    if (anchor < 0) return { added: 0, boundary: false, lastElement: null };
    let start = anchor;
    while (start > 0 && visible[start - 1].handle === target.handle) start -= 1;
    // Keep the selected post even when a very long loaded ancestor chain
    // exceeds the capture limit.
    start = Math.max(start, anchor - MAX_POSTS + 1);
    let added = 0;
    let boundary = Boolean(visible.boundary);
    let lastElement = null;
    for (let index = start; index < visible.length; index += 1) {
      const post = visible[index];
      if (post.handle !== target.handle) { boundary = true; break; }
      lastElement = post.element;
      if (!cache.posts.has(post.id) && cache.posts.size < MAX_POSTS) {
        const html = postHTML(post);
        cache.posts.set(post.id, { id: post.id, handle: post.handle, url: post.url, published: post.published, html });
        added += 1;
      }
    }
    return { added, boundary, lastElement };
  }

  async function threadCapture(options) {
    const target = statusURL(document.URL);
    if (!target) throw new Error('Open an individual X or Twitter post to capture its thread.');
    const key = `${target.handle}/${target.id}`;
    if (state.thread?.key !== key) state.thread = { key, posts: new Map() };
    const cache = state.thread;
    let collected = collectThread(target, cache);
    if (!cache.posts.has(target.id)) throw new Error('The selected post is not loaded yet. Scroll to it, wait for it to appear, then try again.');
    if (options.loadMore) {
      // Only explicit invocation scrolls. This observes the normal page as it
      // loads; it never calls X APIs, clicks controls, or reads account cookies.
      let unchanged = 0;
      for (let index = 0; index < MAX_SCROLLS && !collected.boundary && cache.posts.size < MAX_POSTS; index += 1) {
        collected.lastElement?.scrollIntoView?.({ block: 'end', behavior: 'instant' });
        globalThis.scrollBy?.({ top: Math.max(500, Math.min(globalThis.innerHeight || 800, 1000)), behavior: 'instant' });
        await new Promise(resolve => setTimeout(resolve, 450));
        collected = collectThread(target, cache);
        unchanged = collected.added ? 0 : unchanged + 1;
        if (unchanged >= 3) break;
      }
    }
    const posts = Array.from(cache.posts.values()).sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id));
    const html = normalizeHTML(posts.map(post => post.html).join('\n<hr>\n'), target.url);
    const value = markdown(html, target.url);
    const warning = `Captured ${posts.length} loaded post${posts.length === 1 ? '' : 's'} by @${target.handle}.${posts.length === MAX_POSTS ? ' Reached the 200-post capture limit.' : ''} X may hide or unload parts of a thread. Review this preview; expand any “Show more” text on the original page, then refresh or load more to include additional posts. Other authors and posts after the first reply or recommendation boundary are excluded.`;
    return finish({
      title: `Thread by @${target.handle}`, url: target.url, html, markdown: value,
      author: `@${target.handle}`, published: posts[0]?.published || '',
      description: '', wordCount: wordCount(value),
      extraction: {
        method: 'jelly-x-dom+defuddle-0.19.2', kind: 'thread', truncated: true,
        loadedPostCount: posts.length, warning,
        canLoadMore: !collected.boundary && posts.length < MAX_POSTS,
        posts: posts.map(({ id, url, handle, published }) => ({ id, url, author: `@${handle}`, published }))
      }
    });
  }

  async function capture(options = {}) {
    if (!httpURL(document.URL)) throw new Error('Charta can capture HTTP and HTTPS pages only.');
    engine();
    const mode = options.mode || 'auto';
    if (!['auto', 'article', 'thread', 'selection'].includes(mode)) throw new Error('Choose article, thread, or selection capture.');
    const hasSelection = Boolean(globalThis.getSelection()?.toString().trim());
    if (mode === 'selection' || (mode === 'auto' && hasSelection)) return selectionCapture();
    if (mode === 'thread' || (mode === 'auto' && statusURL(document.URL))) return threadCapture(options);
    return articleCapture();
  }

  globalThis.__jellyCapture = Object.freeze({ capture });
})();
