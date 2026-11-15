import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const fixtureCatalog = () => {
  const blocks = Array.from({ length: 230 }, (_, index) => ({
    id: `n_${String(index).padStart(3, '0')}`,
    title: `Reading ${String(index).padStart(3, '0')}`,
    type: index % 2 ? 'text' : 'link',
    category: 'Reading',
    tags: ['ideas'],
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    source: { url: 'https://example.com/article' },
  }));
  blocks[229].title = 'Zebra personal archive';
  blocks[229].related = ['n_228'];
  blocks[229].suggestedRelated = [{ id: 'n_227', reason: 'Both explore personal archives.', method: 'curation-v1' }];
  blocks[229].tags.push('personal-web');
  blocks[228].title = '<img src=x onerror=alert(1)> archive';
  blocks[228].tags.push('personal-web');
  blocks[228].description = '<script>Unsafe markup stays text</script>';
  blocks.push(
    { id: 'unconnected', title: 'A separate topic', type: 'text', category: 'Elsewhere', tags: ['unrelated'] },
    { id: 'image', title: 'Not a reading', type: 'image', category: 'Image only', tags: ['image-only'] },
  );
  return {
    blocks,
    collections: [
      { id: 'readings', title: 'Reading room', items: [{ kind: 'block', id: 'n_229' }, { kind: 'block', id: 'n_228' }] },
      { id: 'images', title: 'Images only', items: [{ kind: 'block', id: 'image' }] },
    ],
  };
};

async function withRenderer(catalog, options, run) {
  const fixture = await mkdtemp(path.join(tmpdir(), 'charta-connections-'));
  await mkdir(path.join(fixture, 'shared'));
  await cp(new URL('../web/network.mjs', import.meta.url), path.join(fixture, 'network.mjs'));
  await mkdir(path.join(fixture, 'vendor'));
  await cp(new URL('../web/vendor/connections-react.mjs', import.meta.url), path.join(fixture, 'vendor/connections-react.mjs'));
  await cp(new URL('../shared/network.mjs', import.meta.url), path.join(fixture, 'shared/network.mjs'));
  const { renderNetwork } = await import(pathToFileURL(path.join(fixture, 'network.mjs')));
  const dom = new JSDOM('<main></main>', { pretendToBeVisual: true, url: 'https://example.com/' });
  const names = ['window', 'document', 'Element', 'CSS', 'AbortController', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver'];
  const original = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Element: dom.window.Element,
    CSS: { supports: () => false },
    AbortController: dom.window.AbortController,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  });
  dom.window.matchMedia = query => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} });
  dom.window.HTMLElement.prototype.scrollTo = function ({ top }) { this.scrollTop = top; };
  let renderer;
  const states = [];
  const opened = [];
  try {
    renderer = renderNetwork(dom.window.document.querySelector('main'), catalog, {
      ...options,
      onStateChange: state => states.push(state),
      onOpen: id => opened.push(id),
    });
    await renderer.ready;
    await run({ renderer, document: dom.window.document, window: dom.window, states, opened });
  } finally {
    renderer?.destroy();
    dom.window.close();
    for (const [name, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    await rm(fixture, { recursive: true, force: true });
  }
}

function search(document, window, value) {
  const input = document.querySelector('[aria-label="Find a reading to explore"]');
  assert.ok(input, 'a labelled search is the primary entry point');
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  return input;
}

test('connections starts with recent reading choices and searches the complete reading library', async () => {
  await withRenderer(fixtureCatalog(), {}, ({ document, window, renderer }) => {
    const seeds = [...document.querySelectorAll('.network-seed')];
    assert.ok(seeds.length > 0 && seeds.length <= 6, 'landing stays a small set of starting points');
    assert.equal(document.querySelector('.network-focus'), null, 'the entire library is not graphed on entry');
    assert.equal(document.querySelector('.network-seed[data-id="image"]'), null);
    assert.doesNotMatch(document.querySelector('.network-filter-panel').textContent, /Image only|image-only|Images only/);

    search(document, window, 'Zebra personal archive');
    const result = document.querySelector('.network-search-result[data-id="n_229"]');
    assert.ok(result, 'a reading after the old alphabetical 200-item cutoff remains reachable');
    assert.equal(result.tagName, 'BUTTON');
    result.focus();
    assert.equal(document.activeElement, result);
    result.click();
    assert.equal(renderer.getState().focus, 'n_229');
    assert.equal(document.querySelector('.network-focus h2').textContent, 'Zebra personal archive');
    assert.equal(document.querySelectorAll('.network-neighbour').length, 8);
    assert.ok(document.querySelector('[data-react-bits="AnimatedList"] .animated-list__viewport'), 'the actual React Bits list renders the reading results');
    assert.equal(document.querySelector('.network-neighbour').dataset.id, 'n_228', 'authored connections rank first');
    assert.equal(document.querySelector('.network-neighbour[data-id="image"]'), null);
    assert.equal(renderer.getState().view, 'list');
  });
});

test('preview, explore, and back keep the chosen reading and restore the prior exploration', async () => {
  const catalog = fixtureCatalog();
  await withRenderer(catalog, { filters: { focus: 'n_229' } }, ({ document, window, renderer, opened }) => {
    const restoredScroll = [];
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: {
      scrollTop: 420,
      scrollTo: options => restoredScroll.push(options),
    } });
    const category = document.querySelector('[aria-label="Filter connections by category"]');
    category.value = 'Reading';
    category.dispatchEvent(new window.Event('change', { bubbles: true }));
    document.querySelector('.network-more').click();
    assert.equal(document.querySelectorAll('.network-neighbour').length, 16);
    document.querySelector('.network-view-toggle [data-view="map"]').click();
    assert.equal(renderer.getState().view, 'map');
    const target = document.querySelector('.network-map-node[data-id="n_228"]');
    assert.ok(target);
    assert.ok(document.querySelector('[data-react-bits="BranchedMenu"] .branched-menu__lines .branched-menu__reach'), 'the actual React Bits tree draws the branches');
    assert.match(target.textContent, /archive/);
    target.click();
    assert.equal(renderer.getState().focus, 'n_229', 'preview does not silently change the exploration anchor');
    assert.equal(renderer.getState().selectedId, 'n_228');
    assert.equal(document.querySelector('.network-inspector h2').textContent, catalog.blocks[228].title);
    assert.equal(document.querySelector('.network-inspector img,.network-inspector script'), null, 'saved titles and notes stay inert text');
    document.querySelector('.network-inspector .network-open').click();
    assert.deepEqual(opened, ['n_228']);

    document.querySelector('.network-explore').click();
    assert.equal(renderer.getState().focus, 'n_228');
    document.scrollingElement.scrollTop = 900;
    const nextCategory = document.querySelector('[aria-label="Filter connections by category"]');
    nextCategory.value = 'Elsewhere';
    nextCategory.dispatchEvent(new window.Event('change', { bubbles: true }));
    document.querySelector('.network-back').click();
    const restored = renderer.getState();
    assert.equal(restored.focus, 'n_229');
    assert.equal(restored.selectedId, 'n_228');
    assert.equal(restored.view, 'map');
    assert.equal(restored.limit, 16);
    assert.equal(restored.category, 'Reading');
    assert.deepEqual(restoredScroll, [{ top: 420, behavior: 'instant' }], 'Back restores the previous reading position');
    assert.equal(document.querySelector('.network-inspector h2').textContent, catalog.blocks[228].title);

    document.querySelector('.network-view-toggle [data-view="list"]').click();
    assert.equal(renderer.getState().selectedId, 'n_228', 'changing presentation keeps the preview');
    document.querySelector('.network-change').click();
    assert.equal(renderer.getState().focus, '');
    assert.ok(document.querySelector('.network-start'));
  });
});

test('keyboard focus survives closing search and revealing additional readings or connections', async () => {
  await withRenderer(fixtureCatalog(), { filters: { focus: 'n_229' } }, async ({ document, window, renderer }) => {
    const input = search(document, window, 'Reading');
    const dropdown = document.querySelector('.network-search-results');
    const firstResult = dropdown.querySelector('.network-search-result');
    firstResult.focus();
    firstResult.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(document.activeElement, input, 'Escape returns focus to the search input');
    assert.equal(dropdown.hidden, true, 'refocusing search must not reopen the dismissed results');
    assert.equal(input.getAttribute('aria-expanded'), 'false');

    search(document, window, 'Reading');
    const previousSearchCount = dropdown.querySelectorAll('.network-search-result').length;
    const moreReadings = dropdown.querySelector('.network-search-more');
    moreReadings.focus();
    moreReadings.click();
    const expandedReadings = dropdown.querySelectorAll('.network-search-result');
    assert.ok(expandedReadings.length > previousSearchCount);
    assert.equal(document.activeElement, expandedReadings[previousSearchCount], 'search expansion moves focus to the first newly revealed reading');

    document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const previousConnectionCount = document.querySelectorAll('.network-neighbour').length;
    const moreConnections = document.querySelector('.network-more');
    moreConnections.focus();
    moreConnections.click();
    const expandedConnections = document.querySelectorAll('.network-neighbour');
    assert.ok(expandedConnections.length > previousConnectionCount);
    assert.equal(document.activeElement, expandedConnections[previousConnectionCount], 'connection expansion moves focus to the first newly revealed connection');
    assert.equal(renderer.getState().focus, 'n_229');
    assert.equal(renderer.getState().selectedId, '', 'revealing results does not implicitly preview one');
  });
});

test('official React Bits list navigation and branch folding remain functional across previews', async () => {
  await withRenderer(fixtureCatalog(), { filters: { focus: 'n_229' } }, async ({ document, window, renderer }) => {
    const list = document.querySelector('.animated-list');
    const viewport = list.querySelector('[role="listbox"]');
    assert.equal(viewport.querySelectorAll('[role="option"] button').length, 0, 'listbox options do not contain inaccessible nested controls');
    viewport.focus();
    viewport.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await new Promise(resolve => setImmediate(resolve));
    viewport.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(renderer.getState().selectedId, 'n_228', 'the upstream listbox keyboard handler previews the selected reading');
    assert.equal(document.querySelector('.animated-list'), list, 'opening a preview retains the mounted upstream component');
    document.querySelector('.network-more').click();
    assert.equal(document.querySelector('.animated-list'), list, 'expansion updates the real component rather than recreating it');

    document.querySelector('[data-view="map"]').click();
    const tree = document.querySelector('.branched-menu');
    const head = tree.querySelector('.branched-menu__head');
    assert.equal(head.getAttribute('aria-expanded'), 'true');
    head.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(head.getAttribute('aria-expanded'), 'false');
    assert.ok([...tree.querySelectorAll('.branched-menu__item')].every(item => item.tabIndex === -1), 'collapsed branches leave the keyboard tab order');
    head.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(head.getAttribute('aria-expanded'), 'true');
    assert.ok([...tree.querySelectorAll('.branched-menu__item')].every(item => item.tabIndex === 0));
    const neighbour = tree.querySelector('.network-map-node[data-id="n_227"]');
    neighbour.click();
    assert.equal(renderer.getState().selectedId, 'n_227');
    assert.equal(document.querySelector('.branched-menu'), tree, 'previewing a branch retains the actual tree and its open state');
    assert.equal(document.querySelector('.network-map-node[data-id="n_227"]').getAttribute('aria-current'), 'true');
  });
});

test('relationship explanations preserve authorship and reviewed suggestion provenance', async () => {
  await withRenderer(fixtureCatalog(), { filters: { focus: 'n_229' } }, ({ document }) => {
    const related = document.querySelector('.network-neighbour[data-id="n_228"]');
    const suggested = document.querySelector('.network-neighbour[data-id="n_227"]');
    assert.match(related.textContent, /you linked|your link|linked by you/i);
    assert.match(suggested.textContent, /reviewed|suggested/i);
    assert.match(suggested.textContent, /Both explore personal archives\./);
    assert.doesNotMatch(suggested.textContent, /you linked|your link|linked by you/i);
    const tagOnly = [...document.querySelectorAll('.network-neighbour')].find(button => !['n_228', 'n_227'].includes(button.dataset.id));
    assert.match(tagOnly.textContent, /ideas/);
    assert.equal(document.querySelector('.network-results').getAttribute('aria-label'), 'Related readings');
  });
});

test('filters preserve the anchor and offer recovery when no connections match', async () => {
  await withRenderer(fixtureCatalog(), { filters: { focus: 'n_229' } }, ({ document, window, renderer }) => {
    const category = document.querySelector('[aria-label="Filter connections by category"]');
    category.value = 'Elsewhere';
    category.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(renderer.getState().focus, 'n_229');
    assert.equal(document.querySelector('.network-focus h2').textContent, 'Zebra personal archive');
    assert.equal(document.querySelectorAll('.network-neighbour').length, 0);
    assert.match(document.querySelector('.network-results').textContent, /no .*connections|no .*readings/i);
    document.querySelector('.network-clear-filters').click();
    assert.equal(renderer.getState().category, '');
    assert.equal(document.querySelectorAll('.network-neighbour').length, 8);
  });
});

test('empty search and empty libraries give an honest next step, and destroyed controls stop responding', async () => {
  await withRenderer(fixtureCatalog(), {}, ({ document, window, renderer, states, opened }) => {
    search(document, window, 'No reading could possibly match this phrase');
    assert.equal(document.querySelectorAll('.network-search-result').length, 0);
    assert.match(document.querySelector('.network-view').textContent, /no .*readings|no .*matches/i);
    search(document, window, 'Zebra personal archive');
    const result = document.querySelector('.network-search-result[data-id="n_229"]');
    const count = states.length;
    renderer.destroy();
    result.click();
    assert.equal(states.length, count, 'destroy aborts event handlers even on retained DOM nodes');
    assert.deepEqual(opened, []);
  });
  await withRenderer({ blocks: [], collections: [] }, {}, ({ document }) => {
    assert.equal(document.querySelectorAll('.network-seed').length, 0);
    assert.match(document.querySelector('.network-view').textContent, /add .*link|add .*note|save .*reading/i);
  });
});
