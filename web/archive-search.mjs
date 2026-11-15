import { createKeywordIndex, searchTerms } from './shared/archive-search.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function setupArchiveSearch({ document, getCatalog, open, renderItems, research, fetch: request = globalThis.fetch }) {
  const view = document.defaultView, dropdown = document.getElementById('search-dropdown'), results = document.getElementById('search-results');
  const count = document.getElementById('search-results-count'), heading = document.getElementById('search-results-label');
  let mode = 'search', current = null, timer, controller, version = 0, catalog, keywords;
  try { mode = view.localStorage.getItem('charta.search-mode') === 'ask' ? 'ask' : 'search'; } catch {}
  function cancel() { clearTimeout(timer); controller?.abort(); controller = null; version++; results.removeAttribute('aria-busy'); }
  function refresh() {
    for (const input of document.querySelectorAll('[data-library-search]')) {
      const surface = input.closest('.library-search-surface');
      if (!surface.querySelector('.search-mode-controls')) {
        const controls = document.createElement('div'); controls.className = 'search-mode-controls';
        controls.innerHTML = '<div class="search-mode-switch" role="group" aria-label="Search mode"><button type="button" data-search-mode="search" aria-pressed="true">Search</button><button type="button" data-search-mode="ask" aria-pressed="false">Ask archive</button></div><div class="search-research-actions"><a href="#/research" data-research-link>Research</a><button type="button" class="search-ask-submit" data-search-submit hidden>Ask <span aria-hidden="true">↵</span></button></div>';
        surface.insertBefore(controls, surface.firstChild);
      }
      input.dataset.searchMode = mode;
      input.maxLength = 3000;
      input.placeholder = mode === 'ask' ? 'Ask a question about your archive…' : 'Search your archive…';
      input.setAttribute('aria-label', mode === 'ask' ? 'Ask a question about your saved resources' : 'Search materials and collections');
      input.setAttribute('role', mode === 'ask' ? 'searchbox' : 'combobox');
      input.setAttribute('aria-autocomplete', mode === 'ask' ? 'none' : 'list');
      for (const button of surface.querySelectorAll('[data-search-mode]')) {
        const selected = button.dataset.searchMode === mode;
        if (button.getAttribute('aria-pressed') !== String(selected)) button.setAttribute('aria-pressed', String(selected));
      }
      surface.querySelector('[data-search-submit]').hidden = mode !== 'ask';
    }
    research.refresh();
  }
  function message(text, { error = false } = {}) {
    results.innerHTML = `<div class="archive-search-message${error ? ' is-error' : ''}" role="status">${escape(text)}</div>`;
    current?.removeAttribute('aria-activedescendant'); count.textContent = '';
  }
  function decorate() {
    results.setAttribute('role', mode === 'ask' ? 'region' : 'listbox');
    heading.textContent = mode === 'ask' ? 'Ask your archive' : 'Search results';
    dropdown.dataset.mode = mode;
    const footer = dropdown.querySelector('.search-footer');
    footer.innerHTML = mode === 'ask' ? '<span>ChatGPT subscription · selected excerpts are sent to OpenAI</span>' : '<span>Keywords + meaning</span><span><kbd>↑</kbd><kbd>↓</kbd> navigate · <kbd>↵</kbd> open</span>';
  }
  function keywordResults(query) {
    if (catalog !== getCatalog()) { catalog = getCatalog(); keywords = createKeywordIndex(catalog); }
    const terms = searchTerms(query);
    return keywords.search(query, { limit: 100 }).filter(row => row.matches === terms.length).slice(0, 30);
  }
  async function post(endpoint, query, signal) {
    const response = await request(`./api/search/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal });
    let value;
    try { value = await response.json(); } catch { throw new Error('Start Charta locally with npm run dev to use this search mode.'); }
    if (!response.ok) throw new Error(value.error || 'This search could not complete. Try again.');
    return value;
  }
  function update(input) {
    if (!getCatalog()) return;
    cancel(); current = input;
    const query = input.value.trim();
    if (!query) { results.replaceChildren(); count.textContent = ''; return false; }
    open(input); decorate();
    if (mode === 'ask') {
      message('Press Enter to research your archive. Your question and answer will be kept in Research.');
      return true;
    }
    renderItems(keywordResults(query));
    if (query.length < 2) return true;
    const captured = version, sourceCatalog = getCatalog();
    timer = view.setTimeout(async () => {
      controller = new AbortController();
      const signal = controller.signal;
      count.textContent = 'Searching by meaning…';
      try {
        const value = await post('hybrid', query, signal);
        if (captured !== version || sourceCatalog !== getCatalog() || signal.aborted) return;
        renderItems(value.results);
        if (value.warning) count.textContent = 'Keyword matches · meaning unavailable';
      } catch (error) {
        if (captured === version && !signal.aborted) count.textContent = 'Keyword matches · local meaning search unavailable';
      }
    }, 220);
    return true;
  }
  function submit(input) {
    if (!input?.value.trim()) { input?.focus(); return; }
    cancel(); research.start(input.value);
  }
  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-search-mode],[data-search-submit]'); if (!button) return;
    const input = button.closest('.library-search-surface').querySelector('[data-library-search]');
    if (button.hasAttribute('data-search-submit')) { submit(input); return; }
    mode = button.dataset.searchMode;
    try { view.localStorage.setItem('charta.search-mode', mode); } catch {}
    cancel(); refresh(); input.focus(); update(input);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing && event.target.matches?.('[data-library-search]') && mode === 'ask') {
      event.preventDefault(); event.stopImmediatePropagation(); submit(event.target);
    }
  }, true);
  const observer = new view.MutationObserver(() => { if ([...document.querySelectorAll('[data-library-search]')].some(input => !input.closest('.library-search-surface').querySelector('.search-mode-controls'))) refresh(); });
  observer.observe(document.body, { childList: true, subtree: true }); refresh();
  return { update, cancel, refresh };
}
