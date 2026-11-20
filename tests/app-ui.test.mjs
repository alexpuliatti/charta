import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createHash } from 'node:crypto';
import { applyOperation } from '../shared/model.mjs';
import { classifyResource } from '../shared/resource-routing.mjs';
import { CLIP_MODEL, SEMANTIC_VERSION, embeddingInputHash, TEXT_MODEL, TEXT_SEMANTIC_VERSION, textEmbeddingInputHash } from '../shared/semantic.mjs';

function library() {
  const createdAt = '2026-11-15T10:00:00.000Z';
  const material = (id, type, title, extra = {}) => ({
    schemaVersion: 1, id, type, title, path: `content/blocks/${id}/block.json`,
    category: 'Knowledge', tags: ['ideas'], description: '', body: '', summary: null,
    source: { url: `https://example.com/${id}` }, assets: [], related: [],
    createdAt, updatedAt: createdAt, collectionIds: ['c_inbox'], ...extra
  });
  const blocks = [
    material('b_article', 'link', 'An article about linked ideas', {
      related: ['b_image'],
      suggestedRelated: [
        { id: 'b_thread', reason: 'Both discuss collecting and linking ideas.', method: 'curation-v1' },
        { id: 'b_pdf', reason: 'The book expands on linked archives.', method: 'curation-v1' },
        { id: 'b_image', reason: 'Images stay outside related reading.', method: 'curation-v1' },
      ],
      // A link remains eligible for the reading network even with a thumbnail.
      assets: [{ path: 'assets/preview.png', role: 'thumbnail', mimeType: 'image/png', alt: 'Article preview' }]
    }),
    material('b_thread', 'text', 'A thread about collecting', {
      body: 'A useful thought about collecting and connecting ideas.', related: ['b_article']
    }),
    material('b_image', 'image', 'Image of an orbital map', {
      category: 'Artwork', tags: ['visual'],
      source: { url: 'https://example.com/b_image', arena: { originalTitle: 'Screenshot 2023-09-12 at 17.05.47' } },
      artifact: { text: 'The Moving Target', description: 'Concentric circles on a vintage book jacket.', method: 'ocr' },
      related: ['b_thread'],
      assets: [
        { path: 'assets/original.png', role: 'original', mimeType: 'image/png', alt: 'An orbital map' },
        { path: 'assets/thumbnail.webp', role: 'thumbnail', mimeType: 'image/webp' },
      ]
    }),
    material('b_pdf', 'file', 'Archive Book', {
      category: 'Writing', tags: ['documents'],
      assets: [{ path: 'assets/book.pdf', role: 'original', mimeType: 'application/pdf' }],
      suggestedRelated: [{ id: 'b_article', reason: 'An essay about the same archive.', method: 'curation-v1' }],
    })
  ];
  return {
    schemaVersion: 1, sourceCommit: 'app-ui-fixture',
    library: { schemaVersion: 1, title: 'UI test library', inboxCollectionId: 'c_inbox' },
    folders: [
      { schemaVersion: 1, id: 'f_archive', title: 'Archive', order: 9, parentId: null, path: 'content/collections/archive/folder.json' },
      { schemaVersion: 1, id: 'f_graphic', title: 'Graphic design', order: 1, parentId: null, path: 'content/collections/graphic/folder.json' },
      { schemaVersion: 1, id: 'f_writing', title: 'Writing', order: 0, parentId: null, path: 'content/collections/writing/folder.json' },
      { schemaVersion: 1, id: 'f_writing_sub', title: 'Topics', order: 0, parentId: 'f_writing', path: 'content/collections/writing/topics/folder.json' },
    ],
    collections: [{
      schemaVersion: 1, id: 'c_inbox', title: 'Inbox', description: '', parentId: null,
      path: 'content/collections/inbox/collection.json', createdAt, updatedAt: createdAt,
      items: blocks.map(block => ({ kind: 'block', id: block.id }))
    }, {
      schemaVersion: 1, id: 'c_essays', title: 'Essays', description: '', parentId: 'f_writing_sub',
      path: 'content/collections/writing/topics/essays/collection.json', createdAt, updatedAt: createdAt,
      items: [{ kind: 'block', id: 'b_article' }],
    }, {
      schemaVersion: 1, id: 'c_empty', title: 'Empty collection', parentId: 'f_archive',
      path: 'content/collections/archive/empty/collection.json', items: []
    }, {
      schemaVersion: 1, id: 'c_reference', title: 'Linked inspiration', parentId: 'f_archive',
      path: 'content/collections/archive/linked/collection.json', items: [],
      source: { url: 'https://www.are.na/example/inspiration', arena: { importScope: 'reference' } }
    }],
    blocks
  };
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1500;
  while (!predicate()) {
    if (Date.now() >= deadline) assert.fail(message);
    await pause(5);
  }
}

test('the actual app keeps collection controls available without cluttering the material view', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'jelly-app-ui-'));
  let dom;
  const originals = new Map();
  const install = (name, value) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  try {
    await cp(new URL('../web/', import.meta.url), path.join(fixture, 'web'), { recursive: true });
    await cp(new URL('../shared/', import.meta.url), path.join(fixture, 'web/shared'), { recursive: true });
    await writeFile(path.join(fixture, 'package.json'), '{"type":"module"}\n');
    const errors = [];
    const console = new VirtualConsole();
    console.on('jsdomError', error => errors.push(error.message));
    dom = new JSDOM(await readFile(path.join(fixture, 'web/index.html'), 'utf8'), {
      url: 'http://127.0.0.1:4173/#/all', pretendToBeVisual: true, virtualConsole: console
    });
    const { window } = dom;
    const { document } = window;
    window.matchMedia = query => ({
      media: query, matches: query.includes('min-width: 801px'), onchange: null,
      addEventListener() {}, removeEventListener() {}
    });
    // jsdom has no drawing surface or native dialog top layer. The app still
    // mounts its real dashboard and all dialog/navigation handlers.
    window.HTMLCanvasElement.prototype.getContext = () => null;
    window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    window.HTMLDialogElement.prototype.close = function () {
      if (!this.open) return;
      this.removeAttribute('open');
      // Native dialog close events arrive in a later task, after routing may change.
      window.setTimeout(() => this.dispatchEvent(new window.Event('close')), 0);
    };
    for (const name of ['window', 'document', 'location', 'localStorage', 'HTMLElement', 'HTMLFormElement', 'FormData', 'AbortController']) {
      install(name, name === 'window' ? window : window[name]);
    }
    install('requestAnimationFrame', window.requestAnimationFrame.bind(window));
    install('cancelAnimationFrame', window.cancelAnimationFrame.bind(window));
    install('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    install('Element', window.Element);
    install('CSS', { supports: () => false });
    window.HTMLElement.prototype.scrollTo = function ({ top }) { this.scrollTop = top; };
    const semanticBlocks = library().blocks;
    const vectors = new Float32Array(semanticBlocks.length * CLIP_MODEL.dimensions);
    vectors[0] = 1;
    vectors[CLIP_MODEL.dimensions + 1] = 1;
    vectors[CLIP_MODEL.dimensions * 2] = Math.sqrt(0.9);
    vectors[CLIP_MODEL.dimensions * 2 + 1] = Math.sqrt(0.1);
    vectors[CLIP_MODEL.dimensions * 3 + 2] = 1;
    const textVectors = new Float32Array(semanticBlocks.length * TEXT_MODEL.dimensions);
    textVectors[0] = 1;
    textVectors[TEXT_MODEL.dimensions] = -1;
    textVectors[TEXT_MODEL.dimensions * 2 + 1] = 1;
    textVectors[TEXT_MODEL.dimensions * 3] = Math.sqrt(0.8);
    textVectors[TEXT_MODEL.dimensions * 3 + 1] = Math.sqrt(0.2);
    const manifest = {
      schemaVersion: 1, inputVersion: SEMANTIC_VERSION, model: CLIP_MODEL,
      generatedAt: '2026-11-15T10:00:00.000Z',
      vectors: { path: 'vectors.bin', encoding: 'float32-le', dimensions: CLIP_MODEL.dimensions, sha256: createHash('sha256').update(new Uint8Array(vectors.buffer)).digest('hex') },
      textIndex: { inputVersion: TEXT_SEMANTIC_VERSION, model: TEXT_MODEL, vectors: { path: 'text-vectors.bin', encoding: 'float32-le', sha256: createHash('sha256').update(new Uint8Array(textVectors.buffer)).digest('hex') } },
      entries: await Promise.all(semanticBlocks.map(async (block, row) => ({ id: block.id, type: block.type, row, inputHash: await embeddingInputHash(block), method: 'clip-text', textSource: { inputHash: await textEmbeddingInputHash(block) } }))),
    };
    const requests = [];
    let liveCatalog = library(), failNextSave = false, finishResearch, researchSignal;
    install('fetch', async (input, options = {}) => {
      const url = new URL(String(input), document.baseURI);
      requests.push({ url: url.href, method: options.method || 'GET' });
      if (url.pathname === '/api/search/hybrid') return Response.json({ results: [], mode: 'hybrid' });
      if (url.pathname === '/api/search/ask') { researchSignal = options.signal; return new Promise(resolve => { finishResearch = resolve; }); }
      if (url.pathname === '/api/resource/inspect') {
        const input = JSON.parse(options.body);
        const resource = { type: 'text', title: input.text.split('\n')[0], body: input.text, description: '', url: '' };
        const classification = classifyResource(resource, liveCatalog);
        return new Response(JSON.stringify({ resource: { ...resource, category: classification.category, tags: classification.tags }, classification, files: [], warnings: [] }));
      }
      if (url.pathname === '/api/mutate') {
        assert.equal(options.method, 'POST');
        if (failNextSave) { failNextSave = false; return new Response(JSON.stringify({ error: 'Simulated repository save failure' }), { status: 400 }); }
        const result = applyOperation(liveCatalog, JSON.parse(options.body));
        liveCatalog = result.catalog;
        return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
      }
      assert.equal(options.method || 'GET', 'GET');
      if (url.pathname === '/content/embeddings/index.json') return new Response(JSON.stringify(manifest));
      if (url.pathname === '/content/embeddings/vectors.bin') return new Response(vectors.buffer);
      if (url.pathname === '/content/embeddings/text-vectors.bin') return new Response(textVectors.buffer);
      assert.equal(url.href, 'http://127.0.0.1:4173/api/library', 'UI browsing must only read the local catalog and embedding artifacts');
      return new Response(JSON.stringify(liveCatalog), { headers: { 'Content-Type': 'application/json' } });
    });

    await import(pathToFileURL(path.join(fixture, 'web/app.mjs')));
    assert.equal(document.querySelector('.error-panel'), null, 'the complete app must boot without entering its error state');
    assert.ok(document.querySelector('.archive-dashboard'), 'the home route mounts the compact dashboard');
    assert.equal(document.querySelector('.brand').textContent.trim(), '', 'sidebar branding is logo-only');
    assert.equal(document.querySelector('.brand').getAttribute('aria-label'), 'Charta home');
    assert.equal(document.querySelector('.brand img').getAttribute('src'), './assets/charta.svg');
    assert.equal(document.querySelector('.dashboard-brand h1').getAttribute('aria-label'), 'Charta');
    assert.equal(document.querySelector('.dashboard-brand h1').textContent.trim(), '', 'home branding is logo-only');
    assert.equal(document.title, 'Home — Charta');
    assert.equal(document.querySelector('.archive-dashboard canvas'), null, 'the home dashboard has no background canvas');
    assert.equal(document.querySelector('.dashboard-reading-total').textContent, '2');
    assert.equal(document.querySelectorAll('#content .material-card').length, 0, 'home never renders the archive feed');
    assert.equal(document.querySelector('#content').hidden, true);
    assert.equal(document.querySelector('#toolbar').hidden, true);
    assert.equal(document.querySelector('#toolbar').children.length, 0, 'home has no Materials heading or browse controls');
    assert.equal(document.querySelector('#view-options'), null);
    assert.equal(document.querySelector('#sidebar a[aria-current="page"]').getAttribute('aria-label'), 'Home');
    assert.equal(document.querySelector('#sidebar nav[aria-label="Main"] a[href="#/collection/c_inbox"]'), null, 'Inbox has no dedicated navigation entry');
    document.querySelector('#sidebar a[href="#/materials"]').click();
    await waitFor(() => document.querySelector('#page-header h1')?.textContent === 'All materials', 'the full archive did not open from the sidebar');
    assert.equal(document.querySelector('.archive-dashboard'), null);
    assert.equal(document.querySelector('#content').hidden, false);
    assert.equal(document.querySelectorAll('#content .material-card').length, 4, 'image and document records stay in the archive');
    const imageCard = document.querySelector('#content .material-card.is-image');
    assert.ok(imageCard, 'every image card is identified by its material type rather than a filename pattern');
    assert.equal(imageCard.querySelector('.card-title,.card-source,.card-bottom,.taxonomy-chips'), null, 'image cards present the artifact without a caption or metadata');
    assert.equal(imageCard.querySelector('.card-open').getAttribute('aria-label'), 'Open Image of an orbital map', 'the image title remains available to assistive technology');
    assert.ok(document.querySelector('#sidebar a[href="#/discover"]'), 'all-media discovery has its own navigation entry');
    assert.ok([...document.querySelectorAll('#sidebar .tree > .folder-group > .folder-toggle')].every(button => button.getAttribute('aria-expanded') === 'false'), 'fresh navigation starts with the thematic folders closed');
    document.querySelector('#sidebar a[href="#/collections"]').click();
    await waitFor(() => document.querySelector('.folder-browser'), 'Collections did not open the folder browser');
    assert.ok(document.querySelector('#content .directory-open[href="#/folder/f_writing"]'), 'main folders are directly browsable');
    assert.equal(document.querySelector('#content .directory-open[href="#/collection/c_essays"]'), null, 'deep subfolders do not leak into the root');
    assert.equal(document.querySelector('#content .directory-open[href="#/folder/f_graphic"]'), null, 'empty branches are hidden by default');
    document.querySelector('#content .directory-open[href="#/folder/f_writing"]').click();
    await waitFor(() => document.querySelector('#page-header h1')?.textContent === 'Writing', 'the main folder did not open');
    assert.deepEqual([...document.querySelectorAll('#content .directory-title')].map(item => item.textContent), ['Topics']);
    document.querySelector('#content .directory-open[href="#/folder/f_writing_sub"]').click();
    await waitFor(() => document.querySelector('#page-header h1')?.textContent === 'Topics', 'the nested folder did not open');
    document.querySelector('#content .directory-open[href="#/collection/c_essays"]').click();
    await waitFor(() => document.querySelector('#page-header h1')?.textContent === 'Essays', 'the material folder did not open');
    assert.deepEqual([...document.querySelectorAll('#breadcrumb a')].map(link => link.textContent), ['Collections', 'Writing', 'Topics']);
    assert.equal(document.querySelectorAll('#content .material-card').length, 1);
    document.querySelector('#breadcrumb a[href="#/collections"]').click();
    await waitFor(() => document.querySelector('.folder-browser'), 'the root breadcrumb did not reopen Collections');
    document.querySelector('#content .directory-open[href="#/folder/f_archive"]').click();
    await waitFor(() => document.querySelector('#page-header h1')?.textContent === 'Archive', 'the archive folder did not open');
    assert.equal(document.querySelectorAll('#content .directory-item').length, 0, 'external sources are not empty folder cards');
    assert.equal(document.querySelector('#content .folder-link a').href, 'https://www.are.na/example/inspiration');
    assert.equal(document.querySelector('#sidebar a[href="#/collection/c_empty"]'), null);
    document.querySelector('#view-options').open = true;
    document.querySelector('#show-empty-folders').checked = true;
    document.querySelector('#show-empty-folders').dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.ok(document.querySelector('#content .directory-open[href="#/collection/c_empty"]'), 'empty folders remain available on request');
    window.location.hash = '#/materials';
    await waitFor(() => document.querySelectorAll('#content .material-card').length === 4, 'the full archive did not reopen');
    const topFolders = [...document.querySelectorAll('#sidebar .tree > .folder-group > .folder-toggle')];
    assert.deepEqual(topFolders.map(button => button.dataset.id), ['f_writing', 'f_graphic', 'f_archive'], 'thematic folders follow their authored order rather than physical catalog order');
    document.querySelector('.folder-toggle[data-id="f_graphic"]').click();
    assert.equal(document.querySelector('.folder-toggle[data-id="f_graphic"]').getAttribute('aria-expanded'), 'true');

    document.querySelector('#sidebar a[href="#/all"]').click();
    await waitFor(() => document.querySelector('.dashboard-search'), 'the minimal homepage did not reopen');
    assert.equal(document.querySelectorAll('#content .material-card').length, 0, 'returning home removes the archive DOM');
    const modal = document.querySelector('#modal');
    const search = document.querySelector('#library-search');
    search.focus();
    search.click();
    assert.equal(document.activeElement, search, 'the homepage search is immediately editable');
    assert.equal(modal.open, false, 'focusing search does not open a dialog');
    assert.equal(document.querySelector('#search-dropdown').hidden, true, 'an empty search has no menu');
    assert.equal(search.getAttribute('role'), 'combobox');
    assert.equal(search.hasAttribute('aria-activedescendant'), false, 'opening search keeps the popup clear until a query is entered');
    search.value = 'a';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(document.querySelector('#search-dropdown').hidden, false);
    assert.equal(document.querySelector('#search-dropdown').parentElement, search.closest('.library-search-surface'), 'results appear beneath the field being edited');
    assert.equal(modal.open, false, 'typing search results leaves the page accessible');
    const imageResult = document.querySelector('#search-results [data-id="b_image"]');
    const imageThumbnail = imageResult.querySelector('img');
    assert.equal(imageThumbnail?.src, 'http://127.0.0.1:4173/content/blocks/b_image/assets/thumbnail.webp', 'search shows the saved thumbnail instead of downloading the full original');
    assert.equal(imageThumbnail.alt, '', 'the visible result title labels the decorative thumbnail');
    assert.equal(document.querySelector('#search-results [data-id="b_article"] img')?.src, 'http://127.0.0.1:4173/content/blocks/b_article/assets/preview.png', 'links also display saved previews');
    for (const id of ['b_thread', 'b_pdf', 'c_essays']) {
      const result = document.querySelector(`#search-results [data-id="${id}"]`);
      assert.ok(result.querySelector('.search-result-icon > svg'), 'materials without previews and collections retain their type icon');
      assert.equal(result.querySelector('img'), null);
    }
    imageThumbnail.dispatchEvent(new window.Event('error'));
    assert.equal(imageResult.querySelector('img'), null, 'a failed image falls back to the type icon without a broken-image marker');
    assert.ok(imageResult.querySelector('.search-result-icon > svg'));
    assert.equal(search.getAttribute('aria-activedescendant'), 'search-option-0');
    search.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.equal(search.getAttribute('aria-activedescendant'), 'search-option-1', 'arrow keys move the popup selection');
    assert.equal(document.activeElement, search, 'navigating results keeps typing available in the search field');
    search.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    assert.equal(search.getAttribute('aria-activedescendant'), 'search-option-0');
    search.value = 'zz-no-matching-material-zz';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(search.hasAttribute('aria-activedescendant'), false, 'empty results clear the selected result reference');
    assert.equal(document.querySelector('#search-results-count').textContent, '0 results');
    search.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(document.querySelector('#search-dropdown').hidden, true);
    assert.equal(search.getAttribute('aria-expanded'), 'false');
    assert.equal(document.activeElement, search, 'Escape dismisses results and leaves typing available');
    search.value = '';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(document.querySelector('#search-dropdown').hidden, true, 'clearing the query hides results');
    search.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
    await pause(25);
    assert.equal(document.activeElement, search, 'the search shortcut focuses the homepage field');
    assert.equal(modal.open, false);
    const headerSearch = document.querySelector('#header-library-search');
    headerSearch.focus();
    headerSearch.value = 'orbital';
    headerSearch.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(document.querySelector('#search-dropdown').parentElement, headerSearch.closest('.library-search-surface'), 'the header field anchors its own results');
    assert.equal(headerSearch.getAttribute('aria-activedescendant'), 'search-option-0');
    assert.equal(search.getAttribute('aria-expanded'), 'false');
    document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    assert.equal(document.querySelector('#search-dropdown').hidden, true, 'clicking outside dismisses the dropdown');
    assert.equal(headerSearch.hasAttribute('aria-activedescendant'), false);
    headerSearch.value = '';
    search.focus();
    for (const query of ['Screenshot 2023-09-12', 'Moving Target', 'vintage book jacket']) {
      search.value = query;
      search.dispatchEvent(new window.Event('input', { bubbles: true }));
      assert.equal(document.querySelectorAll('#search-results .search-result').length, 1, 'original imported titles and artifact text remain searchable after retitling');
      assert.equal(document.querySelector('#search-results .search-result').dataset.id, 'b_image');
      assert.equal(document.querySelector('#search-results strong').textContent, 'Image of an orbital map', 'search results retain the compact canonical title');
      assert.ok(document.querySelector('#search-results .search-result-thumbnail'), 'updated results also load their thumbnails');
    }
    search.value = 'Image of an orbital map';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(document.querySelectorAll('#search-results .search-result').length, 1);
    assert.equal(document.querySelector('#search-results .search-result').dataset.id, 'b_image');
    search.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const detail = document.querySelector('#detail');
    const revealDetails = () => {
      const toggle = detail.querySelector('[data-action="toggle-detail-info"]');
      const info = detail.querySelector('#detail-info');
      assert.ok(toggle, 'the artifact viewer offers an information disclosure');
      assert.ok(info, 'the information disclosure has its controlled region');
      if (info.hidden) toggle.click();
      assert.equal(info.hidden, false);
      assert.equal(toggle.getAttribute('aria-expanded'), 'true');
      return info;
    };
    await waitFor(() => detail.open, 'the search result did not open the image detail');
    assert.equal(modal.open, false);
    assert.ok(detail.classList.contains('artefact-dialog'), 'materials use the centered artifact viewer');
    assert.ok(detail.querySelector('.detail-stage img'), 'the image itself fills the initial viewing stage');
    assert.equal(detail.querySelector('.detail-stage img').src, 'http://127.0.0.1:4173/content/blocks/b_image/assets/original.png', 'opening a thumbnail still shows the full original');
    assert.equal(detail.querySelector('.detail-stage .taxonomy-chips,.detail-stage .detail-section,.detail-stage .source-link'), null, 'the viewing stage keeps tags and archive information out of the artwork');
    assert.equal(detail.querySelector('#detail-info').hidden, true, 'opening an artifact starts with its information hidden');
    const infoToggle = detail.querySelector('[data-action="toggle-detail-info"]');
    assert.equal(infoToggle.getAttribute('aria-expanded'), 'false');
    assert.equal(infoToggle.getAttribute('aria-controls'), 'detail-info');
    assert.ok(infoToggle.classList.contains('artefact-info-toggle'), 'the information control uses the plus disclosure styling');
    assert.match(revealDetails().textContent, /Artwork/);
    assert.match(detail.querySelector('#detail-info').textContent, /#visual/);
    infoToggle.click();
    assert.equal(detail.querySelector('#detail-info').hidden, true, 'the plus control hides information again without closing the artifact');
    assert.equal(infoToggle.getAttribute('aria-expanded'), 'false');
    assert.equal(detail.open, true);
    revealDetails();
    assert.equal(detail.querySelector('h2').textContent, 'Image of an orbital map');
    assert.equal(detail.querySelector('[data-action="graph-material"]'), null, 'image details must not offer graph focus');
    assert.equal(detail.querySelector('.detail-network-link'), null);
    assert.equal(detail.querySelector('[data-action="discover-material"]').dataset.id, 'b_image', 'image details offer semantic discovery without entering the reading graph');

    detail.querySelector('[data-action="close-detail"]').click();
    await waitFor(() => window.location.hash === '#/all' && !detail.open && document.querySelector('.archive-dashboard'), 'closing an image did not return to the archive');
    await waitFor(() => document.activeElement === search, 'closing a search result did not return focus to the search field');
    assert.equal(document.querySelector('.folder-toggle[data-id="f_graphic"]').getAttribute('aria-expanded'), 'true', 'page rerenders preserve the user’s folder toggle');

    window.location.hash = '#/collection/c_inbox';
    await waitFor(() => document.querySelector('#page-header h1')?.textContent === 'Inbox', 'the collection route did not render');
    assert.equal(document.querySelector('#page-header .page-eyebrow'), null, 'the heading must not repeat its breadcrumb');
    assert.equal(document.querySelector('#page-header p'), null, 'an empty collection description must not become generic interface copy');
    assert.equal(document.querySelector('#toolbar [data-action="tab-collections"]'), null, 'collections without connected collections need no empty Connections tab');
    let options = document.querySelector('#view-options');
    assert.ok(options, 'secondary controls remain available from the compact disclosure');
    assert.equal(options.open, false, 'the materials remain the default view rather than a wall of controls');
    options.querySelector('summary').click();
    assert.equal(options.open, true);
    const summary = options.querySelector('summary');
    summary.focus();
    summary.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(options.open, false, 'Escape dismisses the disclosure without opening a dialog or changing the collection');
    assert.equal(document.activeElement, summary, 'keyboard dismissal returns focus to the disclosure control');
    summary.click();
    document.querySelector('#page-header h1').dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    assert.equal(options.open, false, 'a pointer press outside the menu dismisses it');
    summary.click();

    const choose = (id, value) => {
      const select = document.getElementById(id);
      assert.ok(select, `${id} remains available in collection options`);
      select.value = value;
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
      assert.equal(window.location.hash, '#/collection/c_inbox', 'adjusting a view must keep its collection');
      options = document.querySelector('#view-options');
      assert.equal(options.open, true, 'filter and sort adjustments must not dismiss the controls mid-use');
    };
    const categorySelect = document.querySelector('#category-filter');
    categorySelect.focus();
    choose('category-filter', 'Artwork');
    assert.equal(categorySelect.isConnected, false, 'the collection view was rebuilt for the applied filter');
    await waitFor(() => document.activeElement === document.querySelector('#category-filter'), 'filtering did not restore keyboard focus to the replacement select');
    assert.equal(document.querySelectorAll('#content .material-card').length, 1);
    assert.equal(document.querySelector('#content .card-open').dataset.id, 'b_image');
    choose('category-filter', '');
    choose('tag-filter', 'ideas');
    assert.equal(document.querySelectorAll('#content .material-card').length, 2);
    assert.equal(document.querySelector('#content .card-open[data-id="b_image"]'), null);
    document.querySelector('[data-action="clear-filters"]').click();
    assert.equal(document.querySelectorAll('#content .material-card').length, 4);
    choose('type-filter', 'text');
    assert.equal(document.querySelectorAll('#content .material-card').length, 1);
    assert.equal(document.querySelector('#content .card-open').dataset.id, 'b_thread');

    document.querySelector('#view-options [data-action="view-list"]').click();
    assert.ok(document.querySelector('#content .materials-list'));
    choose('sort-select', 'oldest');
    assert.equal(document.querySelector('#sort-select').value, 'oldest');
    assert.equal(document.querySelector('#type-filter').value, 'text', 'view changes preserve the current material filter');
    document.querySelector('[data-action="clear-filters"]').click();
    assert.equal(document.querySelectorAll('#content .materials-list .material-card').length, 4);
    assert.equal(document.querySelector('#content .materials-list .is-image .card-copy'), null, 'list view also omits image captions');
    assert.equal(document.querySelector('#sort-select').value, 'oldest', 'clearing filters keeps the chosen order');
    options = document.querySelector('#view-options');
    if (!options.open) options.querySelector('summary').click();
    const editCollection = options.querySelector('[data-action="edit-collection"]');
    assert.ok(editCollection, 'collection editing remains reachable without a permanent header button');
    editCollection.click();
    await waitFor(() => modal.open && document.querySelector('#collection-form'), 'the compact collection action did not open its editor');
    modal.querySelector('[data-action="close-modal"]').click();
    assert.equal(modal.open, false);

    const toggle = document.querySelector('#menu-button');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    toggle.click();
    assert.ok(document.body.classList.contains('sidebar-collapsed'));
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(window.localStorage.getItem('jelly-sidebar-collapsed'), 'true', 'desktop collapse preference persists on the device');

    options = document.querySelector('#view-options');
    if (!options.open) options.querySelector('summary').click();
    const exploreNetwork = options.querySelector('[data-action="view-network"]');
    assert.ok(exploreNetwork, 'the collection connections remain reachable from compact options');
    exploreNetwork.click();
    await waitFor(() => document.querySelectorAll('.network-seed').length === 2, 'the compact collection action did not offer eligible readings');
    assert.equal(document.body.dataset.view, 'graph');
    assert.deepEqual([...document.querySelectorAll('.network-seed')].map(node => node.dataset.id).sort(), ['b_article', 'b_thread']);
    assert.equal(document.querySelector('#page-header h1').textContent, 'Connections');
    assert.equal(document.querySelector('#page-header .title-count'), null, 'the focused view avoids distracting library totals');
    assert.equal(document.querySelector('.network-seed[data-id="b_image"]'), null);
    assert.match(window.location.hash, /collection=c_inbox/, 'collection context is deep linked');
    assert.equal(document.querySelector('.jelly-ambient'), null, 'connections stays free of the removed ambient layer');
    assert.ok(document.body.classList.contains('sidebar-collapsed'), 'navigation preserves the collapsed desktop rail');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');

    document.querySelector('.network-seed[data-id="b_article"]').click();
    await waitFor(() => document.querySelector('.network-focus h2')?.textContent === 'An article about linked ideas' && document.querySelector('.network-neighbour[data-id="b_thread"]'), 'choosing a reading did not show its focused connections');
    assert.match(window.location.hash, /^#\/graph\/b_article\?/, 'the focused reading has a reusable URL');
    assert.equal(document.querySelector('.network-view-toggle [data-view="list"]').getAttribute('aria-pressed'), 'true', 'readable lists are the default view');
    document.querySelector('.network-view-toggle [data-view="map"]').click();
    assert.match(window.location.hash, /view=map/, 'the URL retains the optional map view');
    document.querySelector('.network-view-toggle [data-view="list"]').click();
    assert.doesNotMatch(window.location.hash, /view=/, 'the default list keeps focused URLs concise');
    document.querySelector('.network-neighbour[data-id="b_thread"]').click();
    assert.equal(document.querySelector('.network-inspector h2').textContent, 'A thread about collecting');
    const focusedURL = window.location.hash;
    document.querySelector('.network-open').click();
    await waitFor(() => detail.open && detail.querySelector('h2')?.textContent === 'A thread about collecting', 'the connection preview did not open its reading');
    detail.querySelector('[data-action="close-detail"]').click();
    await waitFor(() => !detail.open && window.location.hash === focusedURL && document.querySelector('.network-inspector h2')?.textContent === 'A thread about collecting', 'closing a reading did not restore the connection preview and its URL');
    document.querySelector('.network-explore').click();
    assert.match(window.location.hash, /^#\/graph\/b_thread\?/, 'exploring a neighbour recentres the deep link');
    document.querySelector('.network-back').click();
    assert.equal(window.location.hash, focusedURL, 'Back restores the focused reading and view');
    window.location.hash = '#/all';
    await waitFor(() => document.querySelector('.archive-dashboard'), 'leaving Connections did not return home');
    window.location.hash = '#/graph/b_article';
    await waitFor(() => document.querySelector('.network-focus h2')?.textContent === 'An article about linked ideas', 'opening a focused deep link did not select its reading');
    assert.equal(document.querySelector('.network-view-toggle [data-view="list"]').getAttribute('aria-pressed'), 'true', 'a focused deep link without a view starts in the list');
    window.location.hash = '#/graph/b_article?view=map';
    await waitFor(() => document.querySelector('.network-view-toggle [data-view="map"]')?.getAttribute('aria-pressed') === 'true', 'a map deep link did not restore the map');
    assert.ok(document.querySelector('.network-map'), 'the requested map is rendered');
    document.querySelector('.network-focus-open').click();
    await waitFor(() => detail.open && detail.querySelector('h2')?.textContent === 'An article about linked ideas', 'the focal reading did not open its source material');
    assert.equal(detail.querySelector('#detail-info').hidden, true, 'a new artifact resets information to its collapsed state');
    revealDetails();
    assert.equal(detail.querySelector('[data-action="graph-material"]').dataset.id, 'b_article', 'text/link details retain network focus');
    const suggestedReading = detail.querySelector('.suggested-readings .connection-pill');
    assert.equal(suggestedReading.textContent, 'A thread about collecting');
    assert.equal(suggestedReading.dataset.id, 'b_thread');
    assert.match(suggestedReading.title, /Suggested reading: Both discuss/);
    assert.match(suggestedReading.getAttribute('aria-label'), /Both discuss collecting and linking ideas/);
    assert.equal(detail.querySelectorAll('.suggested-readings .connection-pill').length, 2, 'related reading includes saved PDFs while excluding image connections');
    detail.querySelector('.suggested-readings [data-id="b_pdf"]').click();
    await waitFor(() => detail.querySelector('h2')?.textContent === 'Archive Book', 'the reading suggestion did not open its saved PDF');
    assert.equal(detail.querySelector('#detail-info').hidden, true, 'switching artifacts does not carry over expanded information');
    const pdfFrame = detail.querySelector('.reader-scroll');
    assert.ok(pdfFrame, 'opening a PDF mounts the custom reading room automatically');
    assert.equal(detail.querySelector('.reader-original').href, 'http://127.0.0.1:4173/content/blocks/b_pdf/assets/book.pdf');
    assert.equal(detail.querySelector('.detail-preview'), null, 'the reader replaces the PDF thumbnail');
    assert.equal(detail.classList.contains('has-pdf'), true, 'PDFs have room to read at desktop sizes');
    revealDetails();
    const readPDF = detail.querySelector('[data-action="open-pdf"]');
    assert.equal(readPDF.hasAttribute('download'), false, 'reading is the primary saved-file action');
    assert.equal(detail.querySelector('[data-action="download-asset"]').getAttribute('download'), 'book.pdf', 'a separate explicit download remains available');
    readPDF.click();
    assert.equal(detail.querySelector('.reader-scroll'), pdfFrame, 'reading the selected file again retains the reading room');
    assert.equal(detail.querySelector('[data-action="graph-material"]'), null, 'PDF details stay outside the reading network');
    assert.equal(detail.querySelector('.suggested-readings [data-id="b_article"]').title, 'Suggested reading: An essay about the same archive.', 'a PDF drawer exposes its related articles and reason');
    detail.querySelector('.suggested-readings [data-id="b_article"]').click();
    await waitFor(() => detail.querySelector('h2')?.textContent === 'An article about linked ideas', 'the PDF’s related reading did not return to the article');
    revealDetails();
    assert.equal(pdfFrame.isConnected, false, 'switching materials unloads the previous document');
    assert.equal(detail.classList.contains('has-pdf'), false);
    assert.deepEqual(requests.filter(request => !request.url.endsWith('/assets/book.pdf') && !request.url.endsWith('/api/search/hybrid')), [{ url: 'http://127.0.0.1:4173/api/library', method: 'GET' }]);

    detail.querySelector('[data-action="discover-material"]').click();
    await waitFor(() => document.querySelectorAll('.discover-card').length === 2, 'the material Similar action did not load its embedding neighbors');
    assert.equal(window.location.hash, '#/discover/b_article');
    assert.equal(detail.open, false);
    assert.equal(document.querySelector('.discover-anchor').textContent, 'An article about linked ideas');
    assert.equal(document.querySelector('#page-header .title-count').textContent, '4');
    assert.equal(document.querySelector('.discover-context-label').textContent, 'Related reading');
    assert.equal(document.querySelector('.discover-card .card-open').dataset.id, 'b_pdf', 'reading anchors use their dedicated text semantic space to rank related documents');
    assert.equal(document.querySelector('.discover-card .is-image'), null, 'a reading anchor compares the saved writing rather than mixing uncalibrated visual scores');
    assert.equal(document.querySelector('.network-node'), null, 'semantic browsing remains separate from the reading graph');

    const imageSearch = document.querySelector('.discover-input');
    imageSearch.value = 'Moving Target';
    imageSearch.dispatchEvent(new window.Event('input', { bubbles: true }));
    document.querySelector('.discover-search-result').click();
    await waitFor(() => window.location.hash === '#/discover/b_image' && document.querySelector('.discover-anchor')?.textContent === 'Image of an orbital map', 'selecting a neighbor did not continue semantic exploration');
    assert.equal(document.querySelector('.discover-context-label').textContent, 'Similar to');
    assert.equal(document.querySelectorAll('.discover-card').length, 3, 'an image anchor keeps all-media visual and text browsing');
    assert.equal(document.querySelector('.discover-card .card-open').dataset.id, 'b_article', 'visual browsing still connects an image to a relevant article');
    const discoveryAnchor = document.querySelector('.discover-anchor');
    discoveryAnchor.focus();
    discoveryAnchor.click();
    await waitFor(() => detail.open && detail.querySelector('h2')?.textContent === 'Image of an orbital map', 'the selected semantic material did not open for reading');
    assert.equal(detail.querySelector('#detail-info').hidden, true);
    detail.dispatchEvent(new window.Event('cancel', { cancelable: true }));
    await waitFor(() => window.location.hash === '#/discover/b_image' && !detail.open, 'closing a discovery detail did not preserve its starting point');

    const discoverySearch = document.querySelector('.discover-input');
    discoverySearch.value = 'Moving Target';
    discoverySearch.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(document.querySelector('.discover-search-result').dataset.discoverId, 'b_image', 'artifact text also locates starting materials for semantic browsing');
    discoverySearch.value = 'collecting';
    discoverySearch.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(document.querySelectorAll('.discover-search-result').length, 1);
    discoverySearch.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.equal(document.activeElement, document.querySelector('.discover-search-result'), 'keyboard users can reach discovery search results');
    document.querySelector('.discover-search-result').click();
    await waitFor(() => window.location.hash === '#/discover/b_thread' && document.querySelector('.discover-anchor')?.textContent === 'A thread about collecting', 'choosing a matching title did not update discovery');
    assert.equal(requests.filter(request => request.url.endsWith('/index.json')).length, 1, 'the same catalog reuses its verified embedding index');
    assert.equal(requests.filter(request => request.url.endsWith('/text-vectors.bin')).length, 1, 'the reading index is fetched once alongside the visual index');
    assert.ok(requests.every(request => request.method === 'GET' || (request.method === 'POST' && request.url.endsWith('/api/search/hybrid'))), 'browsing only reads content and requests local query embeddings; ChatGPT requires explicit submission');
    window.location.hash = '#/collection/c_essays';
    await waitFor(() => document.querySelector('#page-header h1')?.textContent === 'Essays', 'the nested collection did not render');
    for (const id of ['f_writing', 'f_writing_sub']) assert.equal(document.querySelector(`.folder-toggle[data-id="${id}"]`).getAttribute('aria-expanded'), 'true', 'navigating to a collection opens its ancestor chain');
    document.querySelector('.folder-toggle[data-id="f_writing"]').click();
    assert.equal(document.querySelector('.folder-toggle[data-id="f_writing"]').getAttribute('aria-expanded'), 'false', 'the user can close an active collection’s folder without a rerender forcing it open');
    window.location.hash = '#/all';
    await waitFor(() => document.querySelector('.archive-dashboard'), 'the archive did not reopen');
    assert.equal(document.querySelector('.folder-toggle[data-id="f_writing"]').getAttribute('aria-expanded'), 'false');
    window.location.hash = '#/collection/c_essays';
    await waitFor(() => document.querySelector('#page-header h1')?.textContent === 'Essays', 'the collection did not reopen');
    assert.equal(document.querySelector('.folder-toggle[data-id="f_writing"]').getAttribute('aria-expanded'), 'true', 'a new collection navigation reveals the active location again');
    const rightClick = target => target.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 250 }));
    const submit = form => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    rightClick(document.querySelector('.card-open[data-id="b_article"]'));
    assert.ok(document.querySelector('.context-menu [data-action="remove-item"]'), 'a material menu offers removal in the current collection');
    document.querySelector('.context-menu [data-action="rename-item"]').click();
    assert.ok(document.querySelector('#rename-form'), 'the right-click action reaches the actual rename dialog');
    document.querySelector('#field-title').value = 'A renamed article';
    failNextSave = true;
    submit(document.querySelector('#rename-form'));
    await waitFor(() => !document.querySelector('#form-error')?.hidden, 'a failed save did not show a form error');
    assert.equal(document.querySelector('#field-title').value, 'A renamed article', 'failed saves preserve the proposed rename');
    assert.equal(document.querySelector('#save-status').dataset.state, 'error');
    assert.equal(liveCatalog.blocks[0].title, 'An article about linked ideas', 'failed changes never mutate the catalog');
    submit(document.querySelector('#rename-form'));
    await waitFor(() => !modal.open && document.querySelector('.card-title')?.textContent === 'A renamed article', 'retrying the rename did not save and rerender');
    assert.equal(liveCatalog.blocks[0].title, 'A renamed article');
    assert.equal(document.querySelector('#save-status').dataset.state, 'saved');
    document.querySelector('.card-menu').click();
    assert.ok(document.querySelector('.context-menu'), 'the ellipsis opens the same actions without right clicking');
    document.querySelector('.context-menu [data-action="remove-item"]').click();
    await waitFor(() => document.querySelectorAll('#content .material-card').length === 0, 'removing a membership did not update the collection');
    assert.equal(liveCatalog.blocks.length, 4, 'removing from a collection keeps the canonical material');
    assert.ok(liveCatalog.collections.find(c => c.id === 'c_inbox').items.some(item => item.id === 'b_article'));

    rightClick(document.querySelector('#sidebar a[href="#/collection/c_essays"]'));
    document.querySelector('.context-menu [data-action="rename-item"]').click();
    document.querySelector('#field-title').value = 'Reading room';
    submit(document.querySelector('#rename-form'));
    await waitFor(() => document.querySelector('#page-header h1')?.textContent === 'Reading room', 'collection rename did not update the current route');
    assert.ok(document.querySelector('#sidebar a[href="#/collection/c_essays"]').textContent.includes('Reading room'));
    rightClick(document.querySelector('.folder-toggle[data-id="f_writing"]'));
    assert.equal(document.querySelector('.context-menu [data-action="delete-item"]').disabled, true, 'nonempty folders cannot be deleted');
    document.querySelector('.context-menu [data-action="rename-item"]').click();
    document.querySelector('#field-title').value = 'Written work';
    submit(document.querySelector('#rename-form'));
    await waitFor(() => document.querySelector('.folder-browse[data-context-id="f_writing"]')?.textContent === 'Written work', 'folder rename did not save');
    rightClick(document.querySelector('#sidebar a[href="#/collection/c_inbox"]'));
    assert.ok(document.querySelector('.context-menu [data-action="delete-item"]'), 'legacy collections can be deleted like any other collection');
    document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));

    window.location.hash = '#/materials';
    await waitFor(() => document.querySelectorAll('#content .material-card').length === 4, 'the archive did not reopen for deletion');
    document.querySelector('.card-open[data-id="b_article"]').click();
    await waitFor(() => detail.open, 'the renamed material did not open');
    revealDetails();
    detail.querySelector('[data-action="item-menu"]').click();
    assert.ok(detail.querySelector('.context-menu'), 'detail menus mount inside the modal top layer');
    detail.querySelector('.context-menu [data-action="delete-item"]').click();
    assert.ok(document.querySelector('#delete-form'), 'permanent deletion has an explicit confirmation');
    submit(document.querySelector('#delete-form'));
    await waitFor(() => window.location.hash === '#/materials' && document.querySelectorAll('#content .material-card').length === 3, 'deletion did not return to an updated library');
    assert.equal(liveCatalog.blocks.some(block => block.id === 'b_article'), false);
    assert.ok(liveCatalog.collections.every(c => c.items.every(item => item.id !== 'b_article')));
    rightClick(document.querySelector('#sidebar a[href="#/collection/c_inbox"]'));
    document.querySelector('.context-menu [data-action="delete-item"]').click();
    submit(document.querySelector('#delete-form'));
    await waitFor(() => !document.querySelector('#sidebar a[href="#/collection/c_inbox"]'), 'removing the legacy Inbox did not update navigation');
    assert.equal(liveCatalog.library.inboxCollectionId, undefined);
    assert.equal(liveCatalog.blocks.length, 3, 'removing Inbox preserves its materials');
    document.querySelector('.sidebar-save').click();
    assert.equal(document.querySelector('#field-collection').value, '', 'saving outside a collection defaults to All materials');
    assert.equal(document.querySelector('#field-collection option:checked').textContent, 'All materials');
    document.querySelector('[data-action="material-note"]').click();
    assert.equal(document.querySelector('#field-collection').value, '', 'switching save types preserves All materials');
    document.querySelector('#field-title').value = 'An unfiled note';
    document.querySelector('#field-body').value = 'Available in All materials without an Inbox.';
    document.querySelector('#field-category').value = 'Notes';
    document.querySelector('#field-tags').value = 'unfiled';
    submit(document.querySelector('#material-form'));
    await waitFor(() => liveCatalog.blocks.some(block => block.title === 'An unfiled note'), 'the unfiled note was not saved');
    assert.deepEqual(liveCatalog.blocks.find(block => block.title === 'An unfiled note').collectionIds, []);
    assert.equal(document.querySelectorAll('#content .material-card').length, 4);
    window.location.hash = '#/collections';
    await waitFor(() => document.querySelector('.folder-browser'), 'Collections did not reopen for folder creation');
    document.querySelector('#page-header [data-action="new-folder"]').click();
    assert.equal(document.querySelector('#field-contents').value, 'folder', 'main folders contain subfolders by default');
    document.querySelector('#field-title').value = 'Personal';
    submit(document.querySelector('#container-form'));
    await waitFor(() => document.querySelector('#page-header h1')?.textContent === 'Personal', 'creating a main folder did not open it');
    const personal = liveCatalog.folders.find(folder => folder.title === 'Personal');
    assert.equal(personal.parentId, null);
    document.querySelector('#page-header [data-action="new-subfolder"]').click();
    assert.equal(document.querySelector('#field-parent').value, personal.id, 'subfolders inherit the open location');
    assert.equal(document.querySelector('#field-contents').value, 'collection', 'subfolders hold materials by default');
    document.querySelector('#field-title').value = 'Notes';
    submit(document.querySelector('#container-form'));
    await waitFor(() => document.querySelector('#page-header h1')?.textContent === 'Notes', 'creating a subfolder did not open its materials');
    const notes = liveCatalog.collections.find(collection => collection.title === 'Notes');
    assert.equal(notes.parentId, personal.id);
    document.querySelector('.sidebar-save').click();
    assert.equal(document.querySelector('#field-collection').value, notes.id, 'new materials target their current subfolder');
    document.querySelector('[data-action="material-note"]').click();
    document.querySelector('#field-title').value = 'A filed note';
    document.querySelector('#field-body').value = 'Saved inside Personal / Notes.';
    document.querySelector('#field-category').value = 'Notes';
    document.querySelector('#field-tags').value = 'personal';
    submit(document.querySelector('#material-form'));
    await waitFor(() => document.querySelectorAll('#content .material-card').length === 1, 'saving into a subfolder did not update its material list');
    assert.deepEqual(liveCatalog.blocks.find(block => block.title === 'A filed note').collectionIds, [notes.id]);
    document.querySelector('#page-header [data-action="add-material"]').click();
    document.querySelector('[data-action="material-file"]').click();
    assert.equal(document.querySelector('#resource-heading').textContent, 'Upload file');
    assert.equal(document.querySelector('.resource-eyebrow').textContent, 'Personal / Notes');
    assert.match(document.querySelector('#resource-file-input').accept, /image\/\*,video\/\*/);
    assert.equal(document.querySelector('.resource-submit').disabled, true);
    modal.close();
    document.querySelector(`#breadcrumb a[href="#/folder/${personal.id}"]`).click();
    await waitFor(() => document.querySelector('.folder-browser'), 'the parent breadcrumb did not reopen the folder');
    assert.ok(document.querySelector(`#content .directory-open[href="#/collection/${notes.id}"]`));
    window.location.hash = '#/all';
    await waitFor(() => document.querySelector('.add-resource-launch'), 'the homepage Add resource button did not appear');
    document.querySelector('.add-resource-launch').click();
    assert.ok(document.querySelector('#resource-form'), 'the magic resource composer opens from the homepage');
    const resourceText = 'Typography notes\nTypefaces and font families for an editorial project.';
    document.querySelector('#resource-input').value = resourceText;
    const countBeforeImport = liveCatalog.blocks.length;
    failNextSave = true;
    submit(document.querySelector('#resource-form'));
    await waitFor(() => document.querySelector('#resource-error')?.textContent.includes('Simulated repository save failure'), 'a failed resource save did not keep an actionable error');
    assert.equal(document.querySelector('#resource-input').value, resourceText, 'failed saves preserve pasted input');
    assert.equal(liveCatalog.blocks.length, countBeforeImport);
    submit(document.querySelector('#resource-form'));
    await waitFor(() => document.querySelector('#resource-receipt:not([hidden])'), 'the retry did not show a saved resource receipt');
    assert.equal(document.querySelector('.resource-destination span').textContent, 'Graphic design / Typography');
    assert.equal(liveCatalog.blocks.length, countBeforeImport + 1);
    assert.equal(document.querySelectorAll('#content .material-card').length, 0, 'adding a resource keeps the homepage minimal');
    const imported = liveCatalog.blocks.find(block => block.title === 'Typography notes');
    assert.equal(imported.body, resourceText);
    assert.equal(imported.category, 'Graphic design');
    document.querySelector('#resource-receipt [data-action="connect-block"]').click();
    assert.ok(document.querySelector('#connect-form'), 'the receipt lets the owner correct the destination');
    assert.ok(document.querySelector(`#connect-form input[value="${imported.collectionIds[0]}"]`).checked);
    modal.close();

    window.location.hash = '#/materials';
    await waitFor(() => document.querySelector('.explore-launch'), 'the archive did not offer Explore');
    document.querySelector('.explore-launch').click();
    await waitFor(() => document.querySelector('.explore-workspace'), 'the resource gallery did not open');
    assert.equal(document.querySelector('.explore-count').textContent, String(liveCatalog.blocks.length));
    const explorerPreview = document.querySelector('.explore-preview-pane');
    assert.equal(explorerPreview.tagName, 'DIALOG', 'Explore previews use the native modal top layer');
    assert.ok(explorerPreview.classList.contains('artefact-dialog'));
    assert.equal(explorerPreview.open, false, 'the gallery waits for an explicit artifact click');
    const gallery = document.querySelector('.explore-gallery-scroll');
    gallery.scrollTop = 143;
    const explorerImage = document.querySelector('[data-explore-select="b_image"]');
    explorerImage.focus();
    explorerImage.click();
    assert.equal(explorerPreview.open, true, 'clicking an artifact opens its centered popup');
    assert.ok(document.querySelector('.explore-large-image'), 'the popup shows the larger image');
    assert.equal(detail.open, false);
    assert.equal(gallery.scrollTop, 143, 'selection keeps the gallery position');
    assert.equal(document.querySelector('.explore-info').hidden, true, 'Explore also starts with the artifact alone');
    const explorerInfoToggle = document.querySelector('[data-explore="info"]');
    assert.equal(explorerInfoToggle.getAttribute('aria-expanded'), 'false');
    explorerInfoToggle.click();
    assert.equal(document.querySelector('.explore-info').hidden, false);
    assert.equal(explorerInfoToggle.getAttribute('aria-expanded'), 'true');
    assert.match(document.querySelector('.explore-info').textContent, /#visual/);
    explorerPreview.dispatchEvent(new window.Event('cancel', { cancelable: true }));
    assert.equal(explorerPreview.open, false, 'Escape dismisses the artifact popup');
    assert.equal(document.activeElement, explorerImage, 'dismissing the popup restores focus to its gallery card');
    assert.equal(gallery.scrollTop, 143, 'dismissing an artifact preserves the gallery position');
    explorerImage.click();
    assert.equal(document.querySelector('.explore-info').hidden, true, 'reopening an artifact resets its information disclosure');
    explorerInfoToggle.click();
    document.querySelector('.explore-info [data-action="open-block"]').click();
    await waitFor(() => detail.open, 'full details did not open from Explore');
    assert.equal(explorerPreview.open, false, 'the previous artifact modal yields to full details');
    assert.equal(detail.querySelector('#detail-info').hidden, true);
    detail.querySelector('[data-action="close-detail"]').click();
    await waitFor(() => window.location.hash.startsWith('#/explore/'), 'closing details did not return to Explore');
    assert.equal(document.querySelector('.explore-gallery-scroll'), gallery, 'returning from full details preserves the gallery');
    assert.equal(gallery.scrollTop, 143);
    document.querySelector(`#sidebar a[href="#/explore?collection=${notes.id}"]`).click();
    await waitFor(() => document.querySelector('.explore-gallery-heading h1')?.textContent === 'Notes', 'sidebar subfolders did not filter Explore');
    assert.equal(document.querySelector('.explore-count').textContent, '1');
    document.querySelector(`#sidebar a[href="#/explore?folder=${personal.id}"]`).click();
    await waitFor(() => document.querySelector('.explore-gallery-heading h1')?.textContent === 'Personal', 'parent folders did not aggregate their resources');
    assert.equal(document.querySelector('.explore-count').textContent, '1');
    document.querySelector('#sidebar a[href="#/explore"]').click();
    await waitFor(() => document.querySelector('.explore-count')?.textContent === String(liveCatalog.blocks.length), 'All materials did not reset the Explore folder');
    document.querySelector('[data-explore="exit"]').click();
    await waitFor(() => document.querySelectorAll('#content .material-card').length === liveCatalog.blocks.length, 'grid view did not reopen from Explore');
    assert.equal(document.body.dataset.view, 'materials');

    document.querySelector('#sidebar a[href="#/research"]').click();
    await waitFor(() => document.querySelector('.research-compose'), 'the permanent Research entry did not open');
    assert.equal(document.querySelector('#toolbar').hidden, true);
    document.querySelector('#research-question').focus();
    document.querySelector('#research-question').value = 'Explore linked ideas';
    document.querySelector('.research-compose').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => document.querySelector('.research-question')?.textContent === 'Explore linked ideas', 'asking did not open a saved research question');
    const researchRoute = window.location.hash;
    document.querySelector('#sidebar a[href="#/all"]').click();
    await waitFor(() => document.querySelector('.archive-dashboard'), 'research did not allow browsing elsewhere');
    assert.equal(researchSignal.aborted, false, 'page navigation must not cancel research');
    document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    const researchSource = liveCatalog.blocks.find(block => block.type === 'text').id;
    finishResearch(Response.json({ summary: `These resources connect ideas [${researchSource}].`, resources: [{ id: researchSource, reason: 'A useful place to begin.', evidence: [{ text: 'Saved source text.' }] }], limitations: [] }));
    await pause(0);
    document.querySelector('#sidebar a[href="#/research"]').click();
    await waitFor(() => document.querySelector('.research-summary'), 'completed research was not retrievable');
    assert.match(document.querySelector('.research-summary').textContent, /These resources connect ideas \[1\]/);
    const source = document.querySelector('.research-source [data-action="open-block"]');
    const sourceExcerpts = document.querySelector('.research-source details');
    sourceExcerpts.open = true;
    source.click(); await waitFor(() => detail.open, 'research sources did not open the resource preview');
    assert.ok(document.querySelector('.research-workspace'), 'source previews preserve the research view underneath');
    detail.querySelector('[data-action="close-detail"]').click();
    await waitFor(() => !detail.open && document.querySelector('.research-summary'), 'closing a source did not restore its research');
    assert.match(document.querySelector('.research-question').textContent, /Explore linked ideas/);
    assert.equal(document.querySelector('.research-source details'), sourceExcerpts, 'returning preserves the reading position and source disclosures');
    assert.equal(sourceExcerpts.open, true);
    assert.equal(requests.filter(request => request.url.endsWith('/api/search/ask')).length, 1, 'returning never repeats the paid request');
    assert.ok(document.querySelector(`.research-history a[href="${researchRoute}"]`));

    document.querySelector('#settings-button').click();
    document.querySelector('[data-action="connect-github"]').click();
    assert.ok(document.querySelector('#github-form input[type=password]'), 'settings expose a repository connection without embedding credentials');
    modal.close();
    assert.deepEqual(errors, [], 'the app emitted an uncaught DOM error');
  } finally {
    dom?.window.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    await rm(fixture, { recursive: true, force: true });
  }
});
