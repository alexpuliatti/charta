import { assetURL, pdfAsset } from './media.mjs';
import { emptyPDFReading, validatePDFReading } from './shared/pdf-reading.mjs';
import { esc, icon, readerMarkup } from './pdf-ui.mjs';
import { setupPDFMargins } from './pdf-margins.mjs';
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

/** Normalized geometry keeps highlights aligned through zoom and resizing. */
export function pdfSelection(selection, pages) {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0), element = node => node?.nodeType === 1 ? node : node?.parentElement;
  const page = element(range.startContainer)?.closest('.page[data-page-number]');
  if (!page || !pages.contains(page) || element(range.endContainer)?.closest('.page') !== page || !element(range.startContainer)?.closest('.textLayer')) return null;
  const quote = selection.toString().trim(), bounds = page.getBoundingClientRect();
  if (!quote || quote.length > 20000 || !bounds.width || !bounds.height) return null;
  const rects = [...range.getClientRects()].filter(r => r.width > 1 && r.height > 1).map(r => {
    const x = clamp((r.left - bounds.left) / bounds.width, 0, 1), y = clamp((r.top - bounds.top) / bounds.height, 0, 1);
    return [x, y, clamp(r.width / bounds.width, 0, 1 - x), clamp(r.height / bounds.height, 0, 1 - y)];
  }).filter(r => r[2] > 0 && r[3] > 0);
  return rects.length && rects.length <= 300 ? { page: Number(page.dataset.pageNumber), quote, rects } : null;
}

export function mountPDFReader(container, block, baseURI, options = {}) {
  const doc = container.ownerDocument, view = doc.defaultView, abort = new view.AbortController(), states = new Map();
  let engine = null, currentAsset = null, currentState = null, currentURL = '', generation = 0, destroyed = false, loading = false;
  let page = 1, total = 0, scale = 1, panel = 'highlights', color = 'yellow', selection = null, outline = [], timeout, selectionTimer;
  const key = asset => `charta:pdf:${new URL(baseURI).pathname}:${block.id}:${asset.path}`;
  const read = (storage, name) => { try { return JSON.parse(storage.getItem(name)); } catch { return null; } };
  const write = (storage, name, value) => { try { if (value === null) storage.removeItem(name); else storage.setItem(name, JSON.stringify(value)); } catch {} };
  container.classList.add('custom-pdf-reader'); container.dataset.paper = 'night'; container.innerHTML = readerMarkup(block);
  const $ = selector => container.querySelector(selector);
  const scroll = $('.reader-scroll'), pages = $('.reader-pages'), feedback = $('.pdf-reader-feedback'), status = $('.pdf-reader-status'), progress = $('.pdf-reader-progress');
  const margins = setupPDFMargins({ container, scroll, pages, onWidthChange(expanded) {
    if (expanded && engine && [...pages.querySelectorAll('.page')].some(node => node.clientWidth > scroll.clientWidth - 40)) {
      engine.setScale('page-width'); remember({ zoom: 'page-width' });
    }
    engine?.refresh(); margins.schedule();
  } });
  const listen = (target, event, handler) => target.addEventListener(event, handler, { signal: abort.signal });
  const notice = text => { if (!destroyed) $('.reader-save-status').textContent = text; };
  function settings() {
    const value = read(view.localStorage, key(currentAsset)) || {};
    // Earlier readers saved warm paper automatically, without a user choice.
    // Migrate those preferences to dark once, then remember explicit choices.
    return { page: Number.isSafeInteger(value.page) ? value.page : 1, zoom: value.zoom || (view.innerWidth < 900 || currentState?.reading.annotations.some(note => note.comment.trim()) ? 'page-width' : '1'), theme: value.themeVersion === 2 && ['white', 'cream', 'sage', 'night'].includes(value.theme) ? value.theme : 'night', themeVersion: 2 };
  }
  function remember(patch = {}) { if (currentAsset) write(view.localStorage, key(currentAsset), { ...settings(), page, ...patch }); }
  function theme(value) {
    container.dataset.paper = value;
    for (const choice of container.querySelectorAll('[data-reader-theme]')) choice.setAttribute('aria-pressed', String(choice.dataset.readerTheme === value));
    remember({ theme: value });
  }
  function getState(asset) {
    if (states.has(asset.path)) return states.get(asset.path);
    const canonical = options.getReading?.(asset) || block.pdfReading?.[asset.path] || emptyPDFReading(), recoveryKey = `${key(asset)}:recovery`, recovery = read(view.sessionStorage, recoveryKey);
    let reading = structuredClone(canonical);
    if (recovery?.reading) { try { validatePDFReading(recovery.reading); reading = recovery.reading; } catch {} }
    const state = { asset, reading, revision: reading.revision, recoveryKey, dirty: Boolean(recovery), version: 0, pending: Promise.resolve(), error: '', timer: null, queued: -1 };
    states.set(asset.path, state); return state;
  }
  function recover(s) { write(view.sessionStorage, s.recoveryKey, { reading: { ...s.reading, revision: s.revision } }); }
  function updateSave() {
    if (destroyed || !currentState) return;
    const s = currentState;
    $('.reader-save').textContent = s.error ? 'Retry save' : s.dirty ? 'Save notes' : 'Saved';
    $('.reader-save').dataset.error = String(Boolean(s.error));
    if (s.error) notice(s.error);
    $('.reader-highlight-count').textContent = s.reading.annotations.length;
  }
  function changed(s = currentState, immediate = false) {
    s.dirty = true; s.version++; s.error = ''; recover(s); updateSave(); view.clearTimeout(s.timer);
    s.timer = view.setTimeout(() => void persist(s), immediate ? 0 : 700);
  }
  function persist(s = currentState) {
    if (!s || !s.dirty || s.queued === s.version) return s?.pending;
    view.clearTimeout(s.timer);
    const version = s.version, value = structuredClone(s.reading); s.queued = version;
    s.pending = s.pending.then(async () => {
      if (!options.saveReading) { s.queued = -1; s.error = 'Notes are kept on this device. Export a copy to keep them.'; updateSave(); return; }
      if (!destroyed && s === currentState) notice('Saving notes…');
      try {
        const saved = await options.saveReading(s.asset, value, s.revision);
        s.revision = saved.revision; s.reading.revision = saved.revision; s.error = '';
        if (version === s.version) { s.dirty = false; write(view.sessionStorage, s.recoveryKey, null); } else recover(s);
        if (!destroyed && s === currentState) { updateSave(); notice('All notes saved'); }
      } catch (error) { s.error = error.message; s.queued = -1; recover(s); if (s === currentState) updateSave(); }
    });
    return s.pending;
  }
  function showPanel(next = panel, open = true) {
    if (!open && $('.reader-panel').contains(doc.activeElement)) $('[data-reader=panel]').focus();
    panel = next; $('.reader-panel').hidden = !open; container.classList.toggle('reader-notebook-open', open);
    $('[data-reader=panel]').setAttribute('aria-expanded', String(open));
    for (const tab of container.querySelectorAll('[data-reader-tab]')) { const selected = tab.dataset.readerTab === panel; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; }
    $('.reader-panel-body').setAttribute('aria-labelledby', `reader-tab-${block.id}-${panel}`);
    paintPanel(); engine?.refresh(); margins.schedule();
  }
  function paintPanel() {
    if (!currentState) return;
    const body = $('.reader-panel-body'), reading = currentState.reading;
    if (panel === 'notes') {
      body.innerHTML = '<div class="reader-notes-heading"><span>A place for your thoughts</span><p>Keep ideas, questions, and connections as you read.</p></div><label class="sr-only" for="reader-document-notes">Document notes</label><textarea class="reader-document-notes" id="reader-document-notes" maxlength="100000" placeholder="What’s staying with you?"></textarea>';
      $('.reader-document-notes').value = reading.notes;
    } else if (panel === 'contents') {
      body.replaceChildren();
      if (!outline.length) body.innerHTML = `<div class="reader-empty">${icon('contents')}<h3>No table of contents</h3><p>Use the page control or search to find your way through this document.</p></div>`;
      const add = (items, depth = 0) => items.forEach(item => {
        const node = doc.createElement('button'); node.type = 'button'; node.className = 'reader-outline-item'; node.style.paddingLeft = `${18 + Math.min(depth, 6) * 12}px`; node.textContent = item.title || 'Untitled section';
        node.onclick = () => { if (item.dest) void engine?.destination(item.dest); }; body.append(node); if (item.items?.length) add(item.items, depth + 1);
      }); add(outline);
    } else {
      body.innerHTML = reading.annotations.length ? `<div class="reader-notebook-heading">${reading.annotations.length} passage${reading.annotations.length === 1 ? '' : 's'} worth keeping</div>${reading.annotations.map(note => `<article class="reader-annotation" data-note-id="${esc(note.id)}" data-color="${note.color}"><div class="reader-annotation-meta"><button type="button" data-reader-page="${note.page}">Page ${note.page} ${icon('right')}</button><button type="button" class="reader-icon" data-reader-delete="${esc(note.id)}" aria-label="Remove highlight on page ${note.page}" title="Remove highlight">${icon('trash')}</button></div><button type="button" class="reader-quote" data-reader-page="${note.page}">${esc(note.quote)}</button><textarea maxlength="20000" aria-label="Note on page ${note.page}" data-reader-comment="${esc(note.id)}" placeholder="Add a thought…">${esc(note.comment)}</textarea></article>`).join('')}` : `<div class="reader-empty">${icon('highlight')}<h3>Make it your own</h3><p>Select a passage to highlight it.<br>Add a note to keep a thought beside the page.</p><span>Your notes stay with this document.</span></div>`;
    }
    updateSave();
  }
  function paintHighlights() {
    if (!currentState) return;
    for (const pageNode of pages.querySelectorAll('.page[data-page-number]')) {
      pageNode.querySelector('.reader-page-highlights')?.remove();
      const layer = doc.createElement('div'); layer.className = 'reader-page-highlights';
      const annotations = currentState.reading.annotations.filter(note => note.page === Number(pageNode.dataset.pageNumber));
      for (const note of annotations.slice().sort((a, b) => a.rects[0][1] - b.rects[0][1])) {
        for (const rect of note.rects) {
          const mark = doc.createElement('button'); mark.type = 'button'; mark.className = 'reader-page-highlight'; mark.dataset.color = note.color; mark.dataset.readerNote = note.id; mark.setAttribute('aria-label', `Highlight: ${note.quote.slice(0, 120)}`);
          Object.assign(mark.style, { left: `${rect[0] * 100}%`, top: `${rect[1] * 100}%`, width: `${rect[2] * 100}%`, height: `${rect[3] * 100}%` }); layer.append(mark);
        }
      }
      pageNode.append(layer);
    }
    margins.render(currentState.reading.annotations);
  }
  function updatePosition(number = page) {
    page = number; $('.reader-page-input').value = page;
    $('.reader-position').textContent = total ? `Page ${page} of ${total.toLocaleString()}` : 'Opening document';
    $('.reader-reading-progress span').style.width = `${total ? page / total * 100 : 0}%`;
    $('[data-reader=previous]').disabled = page <= 1 || !total; $('[data-reader=next]').disabled = page >= total || !total; remember();
  }
  function hideSelection() { selection = null; $('.reader-selection-tools').hidden = true; }
  function captureSelection() {
    if (destroyed) return;
    const selected = view.getSelection(); selection = pdfSelection(selected, pages);
    const tools = $('.reader-selection-tools'); tools.hidden = !selection;
    if (!selection) return;
    const rect = selected.getRangeAt(0).getBoundingClientRect(), bounds = container.getBoundingClientRect();
    tools.style.left = `${clamp(rect.left + rect.width / 2 - bounds.left - 170, 8, Math.max(8, bounds.width - 348))}px`;
    tools.style.top = `${clamp(rect.top - bounds.top - 52, 112, bounds.height - 54)}px`;
  }
  function addHighlight(withNote) {
    if (!selection || !currentState) return;
    const note = { ...selection, id: `h_${view.crypto.randomUUID().replaceAll('-', '')}`, color, comment: '' };
    currentState.reading.annotations.push(note); changed(currentState, true); view.getSelection()?.removeAllRanges(); hideSelection(); paintHighlights(); showPanel('highlights');
    notice(withNote ? 'Highlight added. Write your note in the notebook.' : 'Highlight added');
    if (withNote) container.querySelector(`[data-reader-comment="${note.id}"]`)?.focus();
  }
  function fail(error, token) {
    if (destroyed || token !== generation) return;
    view.clearTimeout(timeout); engine?.destroy(); engine = null;
    loading = false;
    feedback.hidden = false; progress.hidden = true; container.removeAttribute('aria-busy');
    status.textContent = error?.message || 'This PDF could not be opened. Try again or open the original file.';
    $('.pdf-reader-retry').hidden = false;
  }
  async function open(asset) {
    if (destroyed) return;
    const url = asset?.mimeType === 'application/pdf' ? assetURL(block, asset, baseURI) : '';
    if (url && url === currentURL && (engine || loading)) { scroll.focus(); return; }
    const token = ++generation;
    if (currentState?.dirty) void persist(currentState);
    engine?.destroy(); engine = null; view.clearTimeout(timeout); hideSelection();
    currentURL = url; currentAsset = asset; outline = []; total = 0; pages.replaceChildren();
    feedback.hidden = false; progress.hidden = false; progress.removeAttribute('value'); $('.pdf-reader-retry').hidden = true; $('.reader-password').hidden = true;
    for (const link of container.querySelectorAll('.reader-original,.pdf-reader-fallback,.pdf-reader-source a')) { if (url) link.href = url; else link.removeAttribute('href'); }
    if (!url) { fail(new Error('This PDF has an invalid file address.'), token); return; }
    currentState = getState(asset); const prefs = settings(); page = prefs.page; theme(prefs.theme); paintPanel(); updatePosition();
    container.setAttribute('aria-busy', 'true'); status.textContent = 'Retrieving PDF…';
    loading = true;
    const active = () => !destroyed && token === generation;
    timeout = view.setTimeout(() => fail(new Error('The PDF is taking too long to open. Try again or open the original file.'), token), 45000);
    try {
      const { createPDFEngine } = await (options.loadEngine || (() => import('./pdf-engine.mjs')))();
      if (!active()) return;
      const created = await createPDFEngine({ scroll, pages, url, page, scale: prefs.zoom,
        onProgress(loaded, length) { if (!active()) return; if (length > 0) { const percent = clamp(Math.floor(loaded / length * 100), 0, 100); progress.value = percent; status.textContent = percent < 100 ? `Retrieving PDF… ${percent}%` : 'Preparing the first page…'; } },
        onReady(count) { if (!active()) return; total = count; $('.reader-page-total').textContent = `/ ${count.toLocaleString()}`; $('.reader-page-input').max = count; updatePosition(clamp(page, 1, count)); },
        onPage(number) { if (active()) { updatePosition(number); hideSelection(); } },
        onScale(value) { if (!active()) return; scale = value; const select = $('.reader-zoom'); let custom = select.querySelector('[data-current-scale]'); if (!custom) { custom = doc.createElement('option'); custom.dataset.currentScale = ''; select.append(custom); } custom.value = String(value); custom.textContent = `${Math.round(value * 100)}%`; select.value = String(value); paintHighlights(); },
        onRendered() { if (!active()) return; loading = false; view.clearTimeout(timeout); feedback.hidden = true; container.removeAttribute('aria-busy'); paintHighlights(); },
        onText() { if (active()) paintHighlights(); },
        onMatches(matches) { if (active() && matches) $('.reader-search-count').textContent = matches.total ? `${matches.current} / ${matches.total}` : 'No matches'; },
        onPassword(submit, incorrect) { if (!active()) return; view.clearTimeout(timeout); progress.hidden = true; status.textContent = incorrect ? 'That password did not work. Try again.' : 'This document is password protected.'; const form = $('.reader-password'); form.hidden = false; form.onsubmit = event => { event.preventDefault(); submit(form.querySelector('input').value); form.querySelector('input').value = ''; form.hidden = true; progress.hidden = false; status.textContent = 'Unlocking PDF…'; timeout = view.setTimeout(() => fail(new Error('The PDF is taking too long to open. Try again or open the original file.'), token), 45000); }; form.querySelector('input').focus(); },
        onError(error) { fail(error, token); },
      });
      if (!active()) { created.destroy(); return; }
      engine = created; await engine.ready;
      if (active()) { outline = await engine.outline() || []; if (panel === 'contents') paintPanel(); }
    } catch (error) { fail(error, token); }
  }
  listen(container, 'click', event => {
    const themeChoice = event.target.closest('[data-reader-theme]'); if (themeChoice) { theme(themeChoice.dataset.readerTheme); return; }
    const colorChoice = event.target.closest('[data-highlight-color]'); if (colorChoice) { color = colorChoice.dataset.highlightColor; for (const c of container.querySelectorAll('[data-highlight-color]')) c.setAttribute('aria-pressed', String(c === colorChoice)); return; }
    const tab = event.target.closest('[data-reader-tab]'); if (tab) { showPanel(tab.dataset.readerTab); return; }
    const jump = event.target.closest('[data-reader-page]'); if (jump) { engine?.goToPage(Number(jump.dataset.readerPage)); return; }
    const remove = event.target.closest('[data-reader-delete]'); if (remove) { currentState.reading.annotations = currentState.reading.annotations.filter(n => n.id !== remove.dataset.readerDelete); changed(currentState, true); paintPanel(); paintHighlights(); return; }
    const note = event.target.closest('[data-reader-note]'); if (note) { margins.select(note.dataset.readerNote); showPanel('highlights'); const field = container.querySelector(`[data-reader-comment="${note.dataset.readerNote}"]`); field?.scrollIntoView?.({ block: 'nearest' }); field?.focus(); return; }
    const action = event.target.closest('[data-reader]')?.dataset.reader; if (!action) return;
    if (action === 'previous' || action === 'next') engine?.goToPage(page + (action === 'next' ? 1 : -1));
    else if (action === 'zoom-in' || action === 'zoom-out') { engine?.zoom(action === 'zoom-in' ? 1 : -1); remember({ zoom: String(scale) }); }
    else if (action === 'contents') showPanel('contents', $('.reader-panel').hidden || panel !== 'contents');
    else if (action === 'panel') showPanel(panel, $('.reader-panel').hidden);
    else if (action === 'close-panel') showPanel(panel, false);
    else if (action === 'appearance') { const box = $('.reader-appearance'); box.hidden = !box.hidden; $('[data-reader=appearance]').setAttribute('aria-expanded', String(!box.hidden)); }
    else if (action === 'search') { $('.reader-search').hidden = false; $('.reader-search input').focus(); }
    else if (action === 'close-search') { $('.reader-search').hidden = true; engine?.find(''); $('[data-reader=search]').focus(); }
    else if (action.startsWith('find-')) engine?.find($('.reader-search input').value, { again: true, previous: action === 'find-previous' });
    else if (action === 'highlight' || action === 'annotate') addHighlight(action === 'annotate');
    else if (action === 'save') void persist();
    else if (action === 'retry') { currentURL = ''; void open(currentAsset); }
    else if (action === 'export' && currentState) {
      const file = new Blob([JSON.stringify({ title: block.title, assetPath: currentAsset.path, ...currentState.reading }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(file), anchor = doc.createElement('a'); anchor.href = url; anchor.download = `${block.title.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80)}-notes.json`; anchor.click(); view.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  });
  listen(container, 'input', event => {
    if (event.target.matches('.reader-search input')) { engine?.find(event.target.value); $('.reader-search-count').textContent = event.target.value ? 'Searching…' : ''; }
    else if (event.target.matches('.reader-document-notes')) { currentState.reading.notes = event.target.value; changed(); }
    else if (event.target.dataset.readerComment) { const note = currentState.reading.annotations.find(n => n.id === event.target.dataset.readerComment); if (note) { note.comment = event.target.value; changed(); paintHighlights(); } }
  });
  listen($('.reader-page-input'), 'change', event => { const n = Number(event.target.value); if (Number.isFinite(n)) engine?.goToPage(clamp(Math.round(n), 1, total || 1)); updatePosition(); });
  listen($('.reader-zoom'), 'change', event => { const value = event.target.value; engine?.setScale(value); remember({ zoom: value }); });
  listen($('.reader-search'), 'submit', event => { event.preventDefault(); engine?.find($('.reader-search input').value, { again: true }); });
  listen(container, 'keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); $('.reader-search').hidden = false; $('.reader-search input').focus(); }
    if (event.key === 'Escape' && (!$('.reader-selection-tools').hidden || !$('.reader-search').hidden || !$('.reader-appearance').hidden)) { event.preventDefault(); event.stopPropagation(); hideSelection(); $('.reader-search').hidden = true; $('.reader-appearance').hidden = true; $('[data-reader=appearance]').setAttribute('aria-expanded', 'false'); engine?.find(''); scroll.focus(); }
    if (event.target.matches('[role=tab]') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); const tabs = [...container.querySelectorAll('[role=tab]')], index = tabs.indexOf(event.target), next = tabs[(index + (event.key === 'ArrowRight' ? 1 : 2)) % 3]; showPanel(next.dataset.readerTab); next.focus(); return; }
    if (!event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && !/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) && ['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); engine?.goToPage(page + (['ArrowRight', 'PageDown'].includes(event.key) ? 1 : -1)); }
  });
  listen($('.reader-selection-tools'), 'pointerdown', event => event.preventDefault());
  listen(scroll, 'pointerup', () => { view.clearTimeout(selectionTimer); selectionTimer = view.setTimeout(captureSelection, 0); });
  listen(scroll, 'keyup', event => { if (event.shiftKey) captureSelection(); });
  listen(scroll, 'scroll', hideSelection);
  const initial = pdfAsset(block); if (initial) { currentAsset = initial; currentState = getState(initial); }
  showPanel('highlights', view.innerWidth >= 1200); void open(initial);
  return {
    open, downloadURL() { return ''; },
    flush() { return Promise.all([...states.values()].map(s => s.dirty ? persist(s) : s.pending)); },
    destroy() {
      if (destroyed) return;
      for (const s of states.values()) { view.clearTimeout(s.timer); if (s.dirty) void persist(s); }
      destroyed = true; generation++; abort.abort(); margins.destroy(); engine?.destroy(); engine = null;
      view.clearTimeout(timeout); view.clearTimeout(selectionTimer); container.replaceChildren(); container.removeAttribute('aria-busy');
    },
  };
}
