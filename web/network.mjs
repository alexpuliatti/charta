import { createConnectionIndex } from './shared/network.mjs';

const key = value => String(value || '').normalize('NFKC').trim().toLowerCase();
const excerpt = block => String(block.summary?.text || block.description || block.body || '').replace(/\s+/g, ' ').trim();
const readingType = node => node.type === 'text' ? 'Note' : /(?:twitter\.com|x\.com)\//i.test(node.block.source?.url || '') ? 'Thread' : 'Article';
let nextInstance = 0;

/** One reading at a time. All canonical content is rendered as text. */
export function renderNetwork(container, catalog, options = {}) {
  const doc = container.ownerDocument;
  const events = new doc.defaultView.AbortController();
  const index = createConnectionIndex(catalog);
  const byId = new Map(index.nodes.map(node => [node.id, node]));
  const initial = options.filters || {};
  const state = {
    category: initial.category || '', tag: initial.tag || '', collection: initial.collection || '',
    query: initial.query || '', focus: initial.focus || options.focusId || '',
    selectedId: initial.selectedId || '', view: initial.view === 'map' ? 'map' : 'list',
    limit: Math.max(8, Math.min(index.nodes.length || 8, Number(initial.limit) || 8)),
  };
  const snapshot = value => ({ category: value.category || '', tag: value.tag || '', collection: value.collection || '', query: value.query || '', focus: value.focus || '', selectedId: value.selectedId || '', view: value.view === 'map' ? 'map' : 'list', limit: Math.max(8, Number(value.limit) || 8), scrollY: Math.max(0, Number(value.scrollY) || 0) });
  let history = (Array.isArray(initial.history) ? initial.history : []).filter(item => byId.has(item?.focus)).slice(-50).map(snapshot);
  let alive = true, searchLimit = 8, result, componentAPI, componentMount, componentError;
  if (!byId.has(state.focus)) { state.focus = ''; state.selectedId = ''; history = []; }
  const make = (name, className, text) => {
    const element = doc.createElement(name);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const button = (text, className, action, id) => {
    const element = make('button', className, text);
    element.type = 'button';
    if (action) element.dataset.networkAction = action;
    if (id) element.dataset.id = id;
    return element;
  };
  const root = make('div', 'network-view');
  const toolbar = make('div', 'network-toolbar');
  const search = make('form', 'network-search');
  search.setAttribute('role', 'search');
  const searchLabel = make('label', 'network-search-label');
  searchLabel.append(make('span', 'network-search-symbol', '⌕'));
  searchLabel.firstChild.setAttribute('aria-hidden', 'true');
  const input = make('input', 'network-search-input');
  input.type = 'search'; input.name = 'reading'; input.autocomplete = 'off';
  input.placeholder = 'Find a reading to explore…'; input.value = state.query;
  input.setAttribute('aria-label', 'Find a reading to explore');
  const searchId = `network-search-${++nextInstance}`;
  input.setAttribute('aria-controls', searchId);
  input.setAttribute('aria-expanded', 'false');
  searchLabel.append(input);
  const searchResults = make('div', 'network-search-results');
  searchResults.id = searchId; searchResults.hidden = true;
  searchResults.setAttribute('aria-label', 'Matching readings');
  search.append(searchLabel, searchResults);
  const filters = make('details', 'network-filter-panel');
  const filterSummary = make('summary', 'network-filter-toggle', 'Filters');
  const filterBody = make('div', 'network-filters');
  const fields = {};
  for (const [name, title, choices] of [
    ['category', 'Category', index.categories.map(value => [value, value])],
    ['tag', 'Tag', index.tags.map(value => [value, value])],
    ['collection', 'Collection', index.collections.map(value => [value.id, value.title])],
  ]) {
    const label = make('label', 'network-field');
    label.append(make('span', '', title));
    const select = make('select'); select.name = name;
    select.setAttribute('aria-label', `Filter connections by ${name}`);
    const all = make('option', '', `All ${name === 'category' ? 'categories' : `${name}s`}`); all.value = ''; select.append(all);
    for (const [value, title] of choices) { const option = make('option', '', title); option.value = value; select.append(option); }
    state[name] = choices.find(([value]) => key(value) === key(state[name]))?.[0] || '';
    select.value = state[name]; fields[name] = select;
    label.append(select); filterBody.append(label);
    select.addEventListener('change', () => { state[name] = select.value; state.limit = 8; searchLimit = 8; render(); }, { signal: events.signal });
  }
  filterBody.append(button('Clear filters', 'network-clear-filters', 'clear-filters'));
  filters.append(filterSummary, filterBody);
  toolbar.append(search, filters);
  const filterStatus = make('div', 'network-active-filters');
  const content = make('div', 'network-content-area');
  const resultHost = make('div', 'network-component-host');
  const announcement = make('p', 'network-status');
  announcement.setAttribute('role', 'status'); announcement.setAttribute('aria-live', 'polite');
  root.append(toolbar, filterStatus, content, announcement);
  container.replaceChildren(root);

  function getState() { return { ...state, history: history.map(item => ({ ...item })) }; }
  function notify() { if (alive) options.onStateChange?.(getState()); }
  function hasFilters() { return Boolean(state.category || state.tag || state.collection); }
  function choose(id) {
    if (!alive || !byId.has(id)) return;
    if (state.focus && state.focus !== id) history.push(snapshot({ ...state, scrollY: doc.scrollingElement?.scrollTop || doc.defaultView.scrollY }));
    if (history.length > 50) history.shift();
    state.focus = id; state.selectedId = ''; state.query = ''; state.limit = 8;
    input.value = ''; closeSearch(); render();
    content.querySelector('.network-focus h2')?.focus();
  }
  function closeSearch() { searchResults.hidden = true; input.setAttribute('aria-expanded', 'false'); }
  function updateSearch() {
    searchResults.replaceChildren();
    if (!state.query.trim()) { closeSearch(); return; }
    const found = index.search({ ...state, limit: searchLimit });
    for (const node of found.nodes) {
      const item = button('', 'network-search-result', 'choose', node.id);
      item.append(make('strong', '', node.title), make('small', '', `${readingType(node)} · ${node.category}`));
      searchResults.append(item);
    }
    if (!found.nodes.length) searchResults.append(make('p', 'network-search-empty', hasFilters() ? 'No readings found. Try another search or clear the filters.' : 'No readings found. Try a title, tag or phrase.'));
    if (found.total > found.nodes.length) searchResults.append(button(`Show more readings (${found.total - found.nodes.length} remaining)`, 'network-search-more', 'search-more'));
    searchResults.hidden = false; input.setAttribute('aria-expanded', 'true');
    announcement.textContent = `${found.total} matching reading${found.total === 1 ? '' : 's'}`;
  }
  function renderFilters() {
    const active = ['category', 'tag', 'collection'].filter(name => state[name]);
    filterSummary.textContent = active.length ? `Filters · ${active.length}` : 'Filters';
    filterStatus.replaceChildren();
    for (const name of active) {
      const title = name === 'collection' ? index.collections.find(item => item.id === state[name])?.title : state[name];
      const chip = button(`${title} ×`, 'network-filter-chip', 'remove-filter');
      chip.dataset.filter = name; chip.setAttribute('aria-label', `Remove ${name} filter: ${title}`);
      filterStatus.append(chip);
    }
    if (active.length) filterStatus.append(button('Clear all', 'network-clear-filters', 'clear-filters'));
    filterStatus.hidden = !active.length;
    for (const name of Object.keys(fields)) fields[name].value = state[name];
  }
  function reasonsFor(connection) {
    const reasons = [];
    const direct = connection.reasons.filter(reason => reason.type === 'related');
    if (direct.length) reasons.push(direct.some(reason => reason.from === state.focus) ? 'You linked to this reading' : 'This reading links to your starting reading');
    const suggested = connection.reasons.find(reason => reason.type === 'suggested');
    if (suggested) reasons.push(`Reviewed suggestion · ${suggested.label}`);
    const tags = connection.reasons.filter(reason => reason.type === 'tag').map(reason => reason.label);
    if (tags.length) reasons.push(`Shared ${tags.length === 1 ? 'tag' : 'tags'} · ${tags.join(', ')}`);
    return reasons;
  }
  function reasonLabel(connection) { return reasonsFor(connection)[0] || ''; }
  function preview(id) {
    if (!alive || !result?.connections.some(connection => connection.node.id === id)) return;
    state.selectedId = id; render();
    const title = content.querySelector('.network-inspector h2');
    if (title) { title.tabIndex = -1; title.focus(); }
  }
  function resultControls() { return [...content.querySelectorAll('.network-neighbour[data-id],.network-map-node[data-id]')]; }
  function renderStart() {
    const start = make('section', 'network-start');
    const intro = make('div', 'network-start-intro');
    const emblem = make('div', 'network-start-emblem'); emblem.setAttribute('aria-hidden', 'true');
    emblem.append(make('i'), make('i'), make('i'), make('i'));
    intro.append(emblem, make('h2', '', 'Start with a reading'), make('p', '', 'Find the ideas around an article, thread or note.'));
    start.append(intro);
    const found = index.search({ ...state, query: '', limit: 6 });
    const heading = make('div', 'network-section-heading');
    heading.append(make('h3', '', hasFilters() ? 'Readings in this selection' : 'Recently saved'), make('span', 'network-scope', 'Articles, threads & notes'));
    start.append(heading);
    const seeds = make('div', 'network-seeds');
    for (const node of found.nodes) {
      const seed = button('', 'network-seed', 'choose', node.id);
      seed.append(make('span', 'network-item-meta', `${readingType(node)} · ${node.category}`), make('strong', '', node.title));
      const description = excerpt(node.block);
      if (description) seed.append(make('span', 'network-seed-description', description.slice(0, 150)));
      seed.append(make('span', 'network-seed-action', 'Explore connections →'));
      seeds.append(seed);
    }
    if (!found.nodes.length) {
      const empty = make('div', 'network-empty');
      empty.append(make('p', '', index.nodes.length ? 'No readings match these filters.' : 'Save an article, thread or note to start exploring.'));
      if (hasFilters()) empty.append(button('Clear filters', 'network-clear-filters', 'clear-filters'));
      seeds.append(empty);
    }
    start.append(seeds); content.append(start);
    announcement.textContent = found.nodes.length ? 'Choose a reading to explore its connections.' : 'No readings to show.';
  }
  function renderPreview(connection) {
    const node = connection.node;
    const inspector = make('aside', 'network-inspector');
    inspector.setAttribute('aria-label', 'Reading preview');
    const top = make('div', 'network-preview-top');
    top.append(make('span', 'network-item-meta', 'Connection preview'));
    const close = button('×', 'network-preview-close', 'close-preview'); close.setAttribute('aria-label', 'Close preview');
    top.append(close); inspector.append(top, make('span', 'network-preview-category', `${readingType(node)} · ${node.category}`), make('h2', '', node.title));
    const why = make('div', 'network-preview-why');
    why.append(make('h3', '', 'Why it’s connected'));
    for (const reason of reasonsFor(connection)) why.append(make('p', '', reason));
    inspector.append(why);
    const description = excerpt(node.block);
    if (description) inspector.append(make('p', 'network-description', description.slice(0, 500) + (description.length > 500 ? '…' : '')));
    const collections = connection.reasons.filter(reason => reason.type === 'collection').map(reason => reason.label);
    if (collections.length) inspector.append(make('p', 'network-preview-context', `Also filed together · ${collections.join(', ')}`));
    if (node.tags.length) {
      const tags = make('div', 'network-tags');
      for (const tag of node.tags.slice(0, 6)) tags.append(make('span', '', `#${tag}`));
      inspector.append(tags);
    }
    const actions = make('div', 'network-preview-actions');
    actions.append(button('Open reading ↗', 'network-open', 'open', node.id), button('Explore from here →', 'network-explore', 'choose', node.id));
    inspector.append(actions); return inspector;
  }
  function renderFocus() {
    result = index.connections(state.focus, { ...state });
    const focus = result.focus;
    if (!focus) { state.focus = ''; renderStart(); return; }
    const navigation = make('div', 'network-navigation');
    if (history.length) {
      const back = button('← Back', 'network-back', 'back');
      back.setAttribute('aria-label', `Back to ${byId.get(history.at(-1).focus)?.title || 'previous reading'}`); navigation.append(back);
      navigation.append(make('span', 'network-trail', byId.get(history.at(-1).focus)?.title || ''));
    }
    navigation.append(button(history.length ? 'All readings' : '← All readings', 'network-change', 'change'));
    const header = make('section', 'network-focus');
    header.append(make('span', 'network-item-meta', `${readingType(focus)} · ${focus.category}`));
    const title = make('h2', '', focus.title); title.tabIndex = -1; header.append(title);
    const description = excerpt(focus.block);
    if (description) header.append(make('p', 'network-focus-description', description.slice(0, 220) + (description.length > 220 ? '…' : '')));
    header.append(button('Open reading ↗', 'network-focus-open', 'open', focus.id));
    const bar = make('div', 'network-results-bar');
    const heading = make('div', 'network-section-heading');
    heading.append(make('h3', '', 'Related readings'), make('span', 'network-count', result.total ? `${result.connections.length} of ${result.total}` : '0 connections'));
    const toggle = make('div', 'network-view-toggle'); toggle.setAttribute('role', 'group'); toggle.setAttribute('aria-label', 'Connection view');
    for (const [value, title] of [['list', 'List'], ['map', 'Map']]) {
      const control = button(title, '', 'view'); control.dataset.view = value;
      control.setAttribute('aria-pressed', String(state.view === value)); toggle.append(control);
    }
    bar.append(heading, toggle);
    const workspace = make('div', 'network-workspace');
    const readings = make('section', 'network-results'); readings.setAttribute('aria-label', 'Related readings');
    if (result.connections.length) {
      readings.append(resultHost);
      if (result.total > result.connections.length) readings.append(button(`Show ${Math.min(8, result.total - result.connections.length)} more connections`, 'network-more', 'more'));
    } else {
      const empty = make('div', 'network-empty');
      empty.append(make('h3', '', hasFilters() ? 'No connections match these filters' : 'No connections yet'), make('p', '', hasFilters() ? 'Try clearing the filters to see this reading’s connections.' : 'Connections appear when readings share tags, have direct links or reviewed suggestions.'));
      if (hasFilters()) empty.append(button('Clear filters', 'network-clear-filters', 'clear-filters'));
      readings.append(empty);
    }
    workspace.append(readings);
    const selected = result.connections.find(connection => connection.node.id === state.selectedId);
    if (selected) { workspace.classList.add('has-preview'); workspace.append(renderPreview(selected)); }
    else state.selectedId = '';
    content.append(navigation, header, bar, workspace);
    if (result.connections.length && componentAPI) {
      const props = { view: state.view, focus, connections: result.connections, selectedId: state.selectedId, reasonLabel, onPreview: preview };
      if (componentMount) componentMount.update(props);
      else componentMount = componentAPI.mountConnectionResults(resultHost, props);
    } else {
      componentMount?.destroy(); componentMount = undefined;
      if (result.connections.length) resultHost.replaceChildren(make('p', 'network-component-status', componentError ? 'Connections could not load. Reload the page to try again.' : 'Loading connections…'));
    }
    announcement.textContent = `${result.total} related reading${result.total === 1 ? '' : 's'} for ${focus.title}. Showing ${result.connections.length}.`;
  }
  function render() {
    if (!alive) return;
    // Keep the React root alive when a preview opens, filters change, or the
    // result window grows. Only its host moves into the new workspace.
    resultHost.remove(); content.replaceChildren(); renderFilters();
    if (!state.focus) { componentMount?.destroy(); componentMount = undefined; }
    if (state.focus) renderFocus(); else renderStart();
    if (state.query.trim()) updateSearch();
    notify();
  }
  root.addEventListener('click', event => {
    const target = event.target.closest('[data-network-action]');
    if (!target || !root.contains(target)) return;
    const action = target.dataset.networkAction;
    if (action === 'choose') { choose(target.dataset.id); return; }
    if (action === 'open') { options.onOpen?.(target.dataset.id); return; }
    if (action === 'search-more') {
      const previousCount = searchResults.querySelectorAll('.network-search-result').length;
      searchLimit += 8; updateSearch();
      searchResults.querySelectorAll('.network-search-result')[previousCount]?.focus(); return;
    }
    if (action === 'close-preview') {
      const previous = state.selectedId; state.selectedId = ''; render();
      resultControls().find(element => element.dataset.id === previous)?.focus({ preventScroll: true }); return;
    }
    if (action === 'more') {
      const previousCount = result.connections.length;
      state.limit += 8; render();
      resultControls()[previousCount]?.focus();
    }
    if (action === 'view') { state.view = target.dataset.view; render(); content.querySelector(`[data-view="${state.view}"]`)?.focus({ preventScroll: true }); }
    if (action === 'back') {
      const previous = history.pop();
      if (previous) {
        const { scrollY, ...previousState } = previous;
        Object.assign(state, previousState); input.value = state.query; render();
        content.querySelector('.network-focus h2')?.focus({ preventScroll: true });
        doc.scrollingElement?.scrollTo?.({ top: scrollY, behavior: 'instant' });
      }
    }
    if (action === 'change') { state.focus = ''; state.selectedId = ''; state.query = ''; state.limit = 8; history = []; input.value = ''; closeSearch(); render(); input.focus(); }
    if (action === 'clear-filters' || action === 'remove-filter') {
      if (action === 'clear-filters') state.category = state.tag = state.collection = '';
      else state[target.dataset.filter] = '';
      state.limit = 8; searchLimit = 8; render(); filterSummary.focus({ preventScroll: true });
    }
  }, { signal: events.signal });
  input.addEventListener('input', () => { state.query = input.value; searchLimit = 8; updateSearch(); notify(); }, { signal: events.signal });
  input.addEventListener('focus', updateSearch, { signal: events.signal });
  search.addEventListener('submit', event => { event.preventDefault(); const first = searchResults.querySelector('.network-search-result'); if (first) choose(first.dataset.id); }, { signal: events.signal });
  root.addEventListener('keydown', event => {
    const option = event.target.closest('.network-neighbour[role="option"]');
    if (option && ['Enter', ' '].includes(event.key)) { event.preventDefault(); preview(option.dataset.id); return; }
    if (event.key === 'Escape') {
      if (!searchResults.hidden) { input.focus(); closeSearch(); }
      else if (filters.open) { filters.open = false; filterSummary.focus(); }
      else if (state.selectedId) { const id = state.selectedId; state.selectedId = ''; render(); resultControls().find(item => item.dataset.id === id)?.focus(); }
      return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const inSearch = search.contains(event.target) && !searchResults.hidden;
    const inResults = event.target.closest('.network-list,.network-map');
    // The official AnimatedList owns arrow navigation on its listbox.
    if (event.target.classList.contains('animated-list__viewport')) return;
    if (!inSearch && !inResults) return;
    const items = [...(inSearch ? searchResults : inResults).querySelectorAll(inSearch ? 'button' : '.network-neighbour,.network-map-node,.branched-menu__head')];
    const at = items.indexOf(doc.activeElement), next = at + (event.key === 'ArrowDown' ? 1 : -1);
    if (!items.length) return;
    event.preventDefault();
    if (next < 0 && inSearch) input.focus(); else items[Math.max(0, Math.min(items.length - 1, next))].focus();
  }, { signal: events.signal });
  root.addEventListener('focusout', event => { if (event.relatedTarget && !search.contains(event.relatedTarget)) closeSearch(); }, { signal: events.signal });
  doc.addEventListener('pointerdown', event => { if (!search.contains(event.target)) closeSearch(); if (!filters.contains(event.target)) filters.open = false; }, { signal: events.signal });
  render();
  // The React runtime is fetched only after Connections is opened. Other
  // library routes continue to use the existing lightweight DOM application.
  const ready = import('./vendor/connections-react.mjs').then(api => {
    if (!alive) return;
    componentAPI = api; render();
  }).catch(error => {
    componentError = error;
    if (alive) render();
  });
  return {
    getState, select: choose, ready,
    destroy() { alive = false; events.abort(); componentMount?.destroy(); root.remove(); },
  };
}
