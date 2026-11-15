import { loadSemanticIndex, nearestNeighbors, getEmbeddingStatus, semanticSpace } from './shared/semantic.mjs';

const indexes = new WeakMap();

/** Only known inert embedding artifacts can be read from a connected project. */
export function semanticFolderFetcher(directoryHandle, baseURL) {
  const base = new URL('content/embeddings/', baseURL);
  const allowed = new Map(['index.json', 'vectors.bin', 'text-vectors.bin'].map(name => [new URL(name, base).href, name]));
  return async (input, options = {}) => {
    const url = new URL(input, base);
    const name = allowed.get(url.href);
    if (!name || (options.method || 'GET') !== 'GET') throw new Error('Unsupported embedding file read.');
    try {
      const content = await directoryHandle.getDirectoryHandle('content');
      const embeddings = await content.getDirectoryHandle('embeddings');
      const handle = await embeddings.getFileHandle(name);
      const file = await handle.getFile();
      return new Response(await file.arrayBuffer(), { headers: { 'Content-Type': name.endsWith('.json') ? 'application/json' : 'application/octet-stream' } });
    } catch (error) {
      if (error.name === 'NotFoundError') return new Response(null, { status: 404 });
      throw error;
    }
  };
}

function cachedIndex(catalog, baseURL, directoryHandle) {
  if (!indexes.has(catalog)) indexes.set(catalog, new Map());
  const cache = indexes.get(catalog);
  const source = directoryHandle || new URL('content/embeddings/', baseURL).href;
  if (!cache.has(source)) {
    const options = { blocks: catalog.blocks };
    if (directoryHandle) options.fetch = semanticFolderFetcher(directoryHandle, baseURL);
    const pending = loadSemanticIndex(new URL('content/embeddings/', baseURL), options);
    cache.set(source, pending);
    pending.catch(() => cache.delete(source));
  }
  return cache.get(source);
}

// Begin with a small mix of the archive rather than an arbitrary run of images.
export function discoverySeeds(blocks, allowedIds, limit = 18) {
  const groups = new Map();
  for (const block of blocks) {
    if (!allowedIds.has(block.id)) continue;
    if (!groups.has(block.type)) groups.set(block.type, []);
    groups.get(block.type).push(block);
  }
  const result = [];
  while (result.length < limit) {
    let added = false;
    for (const group of groups.values()) {
      if (!group.length) continue;
      result.push(group.shift());
      added = true;
      if (result.length === limit) break;
    }
    if (!added) break;
  }
  return result;
}

export function renderDiscover(container, catalog, {
  selectedId = '', onSelect = () => {}, renderCard,
  directoryHandle = null,
  loadIndex = () => cachedIndex(catalog, container.ownerDocument.baseURI, directoryHandle),
  onStatus = () => {},
} = {}) {
  const doc = container.ownerDocument;
  const make = (name, className, text) => {
    const node = doc.createElement(name);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const blocks = new Map(catalog.blocks.map(block => [block.id, block]));
  let alive = true;
  let index;
  let allowedIds = new Set();
  const events = new doc.defaultView.AbortController();
  const root = make('div', 'discover');
  const controls = make('div', 'discover-controls');
  const search = make('form', 'discover-search');
  search.setAttribute('role', 'search');
  const input = make('input', 'discover-input');
  input.type = 'search';
  input.placeholder = 'Start with a material…';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Find a material to explore similar content');
  input.setAttribute('aria-controls', 'discover-search-results');
  input.setAttribute('aria-expanded', 'false');
  const suggestions = make('div', 'discover-search-results');
  suggestions.id = 'discover-search-results';
  suggestions.hidden = true;
  const status = make('p', 'discover-status', 'Loading embeddings…');
  status.setAttribute('role', 'status');
  const context = make('div', 'discover-context');
  const results = make('div', 'materials-grid discover-grid');
  results.setAttribute('aria-label', 'Similar materials');
  search.append(input, suggestions);
  controls.append(search, status);
  root.append(controls, context, results);
  container.replaceChildren(root);

  function closeSuggestions() {
    suggestions.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  }

  function select(id) {
    closeSuggestions();
    onSelect(id);
  }

  function card(block) {
    const wrapper = make('div', 'discover-card');
    if (renderCard) {
      // The app card renderer escapes canonical record text and media URLs.
      wrapper.innerHTML = renderCard(block);
      wrapper.querySelectorAll('.taxonomy-chips,.card-menu').forEach(node => node.remove());
      const button = wrapper.querySelector('.card-open');
      if (button) {
        button.dataset.action = 'discover-material';
        button.setAttribute('aria-label', `Find similar to ${block.title}`);
      }
    } else {
      const button = make('button', 'discover-fallback', block.type === 'image' ? 'Image' : block.title);
      button.type = 'button';
      button.dataset.action = 'discover-material';
      button.dataset.id = block.id;
      button.setAttribute('aria-label', `Find similar to ${block.title}`);
      wrapper.append(button);
    }
    const open = make('button', 'discover-open', '↗');
    open.type = 'button';
    open.dataset.action = 'open-block';
    open.dataset.id = block.id;
    open.setAttribute('aria-label', `Open ${block.title}`);
    open.title = 'Open material';
    wrapper.append(open);
    return wrapper;
  }

  function showSuggestions() {
    const query = input.value.trim().toLocaleLowerCase();
    suggestions.replaceChildren();
    if (!query || !index) { closeSuggestions(); return; }
    const matches = catalog.blocks.filter(block => allowedIds.has(block.id) &&
      [block.title, block.source?.arena?.originalTitle, block.artifact?.text, block.artifact?.description, block.category, ...(block.tags || []), block.source?.url || ''].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)).slice(0, 12);
    for (const block of matches) {
      const button = make('button', 'discover-search-result');
      button.type = 'button';
      button.dataset.discoverId = block.id;
      button.append(make('span', 'discover-result-title', block.title), make('small', '', block.category || block.type));
      suggestions.append(button);
    }
    if (!matches.length) suggestions.append(make('p', 'discover-no-results', 'No matches'));
    suggestions.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  input.addEventListener('input', showSuggestions, { signal: events.signal });
  input.addEventListener('focus', showSuggestions, { signal: events.signal });
  search.addEventListener('submit', event => {
    event.preventDefault();
    const first = suggestions.querySelector('[data-discover-id]');
    if (first) select(first.dataset.discoverId);
  }, { signal: events.signal });
  search.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeSuggestions(); input.focus(); }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key) || suggestions.hidden) return;
    const options = [...suggestions.querySelectorAll('button')];
    if (!options.length) return;
    event.preventDefault();
    const current = options.indexOf(doc.activeElement);
    const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
    if (next < 0) input.focus();
    else options[Math.min(next, options.length - 1)].focus();
  }, { signal: events.signal });
  suggestions.addEventListener('click', event => {
    const button = event.target.closest('[data-discover-id]');
    if (button) select(button.dataset.discoverId);
  }, { signal: events.signal });
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-action="discover-material"]');
    if (!button) return;
    event.stopPropagation();
    select(button.dataset.id);
  }, { signal: events.signal });
  doc.addEventListener('pointerdown', event => {
    if (!search.contains(event.target)) closeSuggestions();
  }, { signal: events.signal });

  Promise.resolve().then(loadIndex).then(loaded => {
    if (!alive) return;
    index = loaded;
    const info = getEmbeddingStatus(index, catalog.blocks);
    allowedIds = index.validIds || new Set(index.entries.map(entry => entry.id));
    onStatus(info);
    status.textContent = info.state === 'ready' ? '' : `${info.valid} of ${info.total} indexed`;
    status.hidden = !status.textContent;
    const selected = blocks.get(selectedId);
    if (selectedId && (!selected || !allowedIds.has(selectedId))) {
      status.hidden = false;
      status.textContent = selected ? 'Similarity is not ready for this material.' : 'Material not found.';
    }
    let visible;
    if (selected && allowedIds.has(selectedId)) {
      const space = semanticSpace(index, selectedId);
      const label = make('span', 'discover-context-label', space.space === 'text' ? 'Related reading' : 'Similar to');
      label.dataset.space = space.space;
      label.title = space.space === 'text' ? 'Connections based on saved writing.' : 'Connections based on images and saved text.';
      const source = make('button', 'discover-anchor', selected.title);
      source.type = 'button';
      source.dataset.action = 'open-block';
      source.dataset.id = selected.id;
      source.setAttribute('aria-label', `Open ${selected.title}`);
      const reset = make('a', 'discover-reset', 'Clear');
      reset.href = '#/discover';
      context.append(label, source, reset);
      visible = nearestNeighbors(index, selectedId, { limit: 24 }).map(match => blocks.get(match.id)).filter(Boolean);
      if (!visible.length) {
        status.hidden = false;
        status.textContent = 'No similar materials yet.';
      }
    } else {
      context.append(make('span', 'discover-context-label', 'Choose a starting point'));
      visible = discoverySeeds(catalog.blocks, allowedIds);
    }
    results.replaceChildren(...visible.map(card));
    showSuggestions();
  }).catch(() => {
    if (!alive) return;
    status.textContent = 'Embeddings aren’t available yet.';
    status.hidden = false;
    input.disabled = true;
    onStatus({ state: 'missing', total: catalog.blocks.length, valid: 0, indexed: 0 });
  });

  return { destroy() { alive = false; events.abort(); } };
}
