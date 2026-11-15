import { previewAsset, pdfAsset, assetURL, mediaPlayer, assetDownloads } from './media.mjs';
import { mountPDFReader } from './pdf.mjs';
import { renderSavedArticle } from './article.mjs';
import { stripFrontmatter } from './shared/clip-markdown.mjs';
import { isTweet, tweetText, TWEET_TEXT_UNAVAILABLE } from './shared/tweets.mjs';
import { resourceFolderPath } from './shared/resource-routing.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const textKey = value => String(value || '').normalize('NFKC').toLocaleLowerCase();
const typeName = type => ({ image: 'Image', link: 'Link', text: 'Note', file: 'Document', video: 'Video', audio: 'Audio' }[type] || 'Resource');
const safeURL = value => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; } };
const host = block => { try { return new URL(block.source.url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const paths = {
  close: '<path d="m6 6 12 12M6 18 18 6"/>', left: '<path d="m15 5-7 7 7 7"/>', right: '<path d="m9 5 7 7-7 7"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15l-1 5Z"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L20 5"/>', file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  video: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 8 6 4-6 4V8Z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 4-5 4 6"/>',
  text: '<path d="M5 5h14M12 5v15M8 20h8"/>', link: '<path d="m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M14 8l2-2a4 4 0 1 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  audio: '<path d="M9 18V5l11-2v13M9 8l11-2"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;

export function parseExploreRoute(hash) {
  const [pathname, query = ''] = String(hash || '#/explore').split('?');
  const params = new URLSearchParams(query);
  return { selectedId: pathname.split('/')[2] || '', query: params.get('q') || '', type: params.get('type') || 'all', order: params.get('sort') || 'newest', collectionId: params.get('collection') || '', folderId: params.get('folder') || '' };
}

export function exploreHash(state = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of [['collection', state.collectionId], ['folder', state.folderId], ['q', state.query], ['type', state.type !== 'all' ? state.type : ''], ['sort', state.order !== 'newest' ? state.order : '']]) if (value) params.set(key, value);
  return `#/explore${state.selectedId ? `/${state.selectedId}` : ''}${params.size ? `?${params}` : ''}`;
}

export function createExploreCatalog(catalog) {
  const byId = new Map(catalog.blocks.map(block => [block.id, block]));
  const memberships = new Map(catalog.blocks.map(block => [block.id, []]));
  for (const collection of catalog.collections) for (const item of collection.items) if (item.kind === 'block' && memberships.has(item.id)) memberships.get(item.id).push(collection.id);
  const texts = new Map(catalog.blocks.map(block => [block.id, textKey([block.title, block.description, block.body, block.category, ...(block.tags || []), block.source?.url, block.artifact?.text].filter(Boolean).join(' '))]));
  function filter(state) {
    const scoped = new Set();
    if (state.collectionId) scoped.add(state.collectionId);
    if (state.folderId) {
      const folders = new Set([state.folderId]);
      for (let changed = true; changed;) { changed = false; for (const folder of catalog.folders) if (folders.has(folder.parentId) && !folders.has(folder.id)) { folders.add(folder.id); changed = true; } }
      for (const collection of catalog.collections) if (folders.has(collection.parentId)) scoped.add(collection.id);
    }
    const query = textKey(state.query).replace(/#/g, '').trim().split(/\s+/).filter(Boolean);
    let blocks = catalog.blocks.filter(block => (state.type === 'all' || block.type === state.type) && (!state.collectionId && !state.folderId || (memberships.get(block.id) || []).some(id => scoped.has(id))) && query.every(term => texts.get(block.id).includes(term)));
    const manual = state.order === 'manual' && state.collectionId ? new Map(catalog.collections.find(collection => collection.id === state.collectionId)?.items.map((item, index) => [item.id, index]) || []) : null;
    blocks = blocks.slice().sort((a, b) => manual ? (manual.get(a.id) ?? Infinity) - (manual.get(b.id) ?? Infinity) : state.order === 'title' ? a.title.localeCompare(b.title) || a.id.localeCompare(b.id) : (state.order === 'oldest' ? 1 : -1) * ((Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    return blocks;
  }
  return { byId, memberships, filter };
}

export function renderExplorer(container, catalog, { state: initial = {}, restore, onNavigate, onExit, pdfOptions } = {}) {
  const doc = container.ownerDocument, view = doc.defaultView, baseURI = doc.baseURI;
  const events = new view.AbortController();
  const index = createExploreCatalog(catalog);
  let state = { selectedId: '', query: '', type: 'all', order: 'newest', collectionId: '', folderId: '', ...initial };
  let items = [], rendered = 0, selectedId = '', pdfReader = null, alive = true, resizeFrame = 0, suspended = false;
  let returnFocus = null;
  const root = doc.createElement('div'); root.className = 'explore-workspace';
  const scopeOptions = catalog.folders.map(folder => {
    const parts = [folder.title]; let parent = folder.parentId; const seen = new Set();
    while (parent && !seen.has(parent)) { seen.add(parent); const f = catalog.folders.find(item => item.id === parent); if (!f) break; parts.unshift(f.title); parent = f.parentId; }
    return { value: `folder:${folder.id}`, title: parts.join(' / ') };
  }).concat(catalog.collections.filter(collection => !collection.source?.external && collection.source?.arena?.importScope !== 'reference').map(collection => ({ value: `collection:${collection.id}`, title: resourceFolderPath(catalog, collection.id).join(' / ') }))).sort((a, b) => a.title.localeCompare(b.title));
  root.innerHTML = `<section class="explore-gallery-pane" aria-label="Resource gallery"><div class="explore-gallery-heading"><div><h1>All resources</h1><span class="explore-count"></span></div><a class="explore-icon" href="#/materials" data-explore="exit" aria-label="Return to grid view" title="Grid view">${icon('grid')}</a></div><div class="explore-controls"><label class="explore-search">${icon('search')}<input type="search" placeholder="Find a resource…" aria-label="Search resources" autocomplete="off"></label><div class="explore-filters"><select class="explore-type" aria-label="Filter resource type">${[['all', 'All types'], ['image', 'Images'], ['link', 'Links'], ['text', 'Notes'], ['file', 'Documents'], ['video', 'Video'], ['audio', 'Audio']].map(([value, title]) => `<option value="${value}">${title}</option>`).join('')}</select><select class="explore-scope" aria-label="Filter by folder"><option value="">All folders</option>${scopeOptions.map(option => `<option value="${escape(option.value)}">${escape(option.title)}</option>`).join('')}</select><select class="explore-sort" aria-label="Sort resources"><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="title">A–Z</option><option value="manual">Folder order</option></select></div></div><div class="explore-gallery-scroll" tabindex="-1"><div class="explore-grid" role="list" aria-label="Resources"></div><button class="explore-load-more" type="button">Load more resources</button><div class="explore-empty" hidden><h2>No matching resources</h2><button type="button" data-explore="clear">Clear filters</button></div></div></section><dialog class="explore-preview-pane artefact-dialog" aria-label="Resource preview"><div class="artefact-controls"><button class="artefact-button" type="button" data-explore="close" aria-label="Close preview" title="Close preview">${icon('close')}</button><button class="artefact-button artefact-info-toggle" type="button" data-explore="info" aria-label="Show resource information" aria-expanded="false" aria-controls="explore-resource-info" title="Resource information">${icon('plus')}</button></div><div class="explore-preview-content artefact-body"><div class="explore-stage" tabindex="-1"></div><aside id="explore-resource-info" class="explore-info artefact-info" aria-label="Resource information" hidden></aside></div><footer class="explore-preview-footer"></footer></dialog>`;
  container.replaceChildren(root);
  const $ = selector => root.querySelector(selector);
  const gallery = $('.explore-gallery-scroll'), grid = $('.explore-grid'), preview = $('.explore-preview-pane'), stage = $('.explore-stage'), info = $('.explore-info'), loadMore = $('.explore-load-more');
  const listen = (target, event, callback, options = {}) => target.addEventListener(event, callback, { ...options, signal: events.signal });
  const observer = view.ResizeObserver ? new view.ResizeObserver(() => scheduleMeasure()) : null;

  function measure() {
    resizeFrame = 0;
    for (const card of grid.children) {
      const main = card.querySelector('.explore-card-main');
      const height = main?.getBoundingClientRect().height || 180;
      card.style.gridRowEnd = `span ${Math.ceil((height + 12) / 16)}`;
    }
  }
  function scheduleMeasure() { if (!resizeFrame && alive) resizeFrame = view.requestAnimationFrame(measure); }

  function tile(block) {
    const card = doc.createElement('article'); card.className = `explore-tile is-${block.type}`; card.setAttribute('role', 'listitem');
    card.dataset.contextKind = 'block'; card.dataset.contextId = block.id;
    const tweet = isTweet(block);
    const asset = !tweet && previewAsset(block), src = asset && assetURL(block, asset, baseURI);
    const body = (tweet ? tweetText(block) || TWEET_TEXT_UNAVAILABLE : stripFrontmatter(block.body || block.description || '').replace(/^#+\s*/gm, '')).slice(0, 380);
    card.innerHTML = `<button class="explore-card-main" type="button" data-explore-select="${escape(block.id)}" aria-label="Preview ${escape(block.title)}" aria-pressed="${block.id === selectedId}">${src ? `<img class="explore-thumbnail" src="${escape(src)}" alt="" loading="lazy" decoding="async">` : `<span class="explore-text-card">${icon(block.type)}<strong>${escape(block.title)}</strong>${body ? `<span>${escape(body)}</span>` : ''}${host(block) ? `<small>${escape(host(block))}</small>` : ''}</span>`}${block.type === 'video' || block.type === 'audio' || block.type === 'file' ? `<span class="explore-type-badge">${icon(block.type)}${typeName(block.type)}</span>` : ''}<span class="explore-selected-check">${icon('check')}</span></button><button class="explore-icon explore-card-menu" data-action="item-menu" aria-label="Actions for ${escape(block.title)}" aria-haspopup="menu">${icon('more')}</button>`;
    card.classList.toggle('selected', block.id === selectedId);
    const thumbnail = card.querySelector('img');
    if (thumbnail) {
      listen(thumbnail, 'load', () => { thumbnail.style.aspectRatio = 'auto'; scheduleMeasure(); });
      listen(thumbnail, 'error', () => { thumbnail.hidden = true; const fallback = doc.createElement('span'); fallback.className = 'explore-text-card'; fallback.textContent = block.title; card.querySelector('.explore-card-main').prepend(fallback); scheduleMeasure(); });
    }
    observer?.observe(card.querySelector('.explore-card-main'));
    return card;
  }

  function append(until = rendered + 60) {
    const end = Math.min(items.length, until), fragment = doc.createDocumentFragment();
    for (; rendered < end; rendered++) fragment.append(tile(items[rendered]));
    grid.append(fragment); loadMore.hidden = rendered >= items.length; scheduleMeasure();
  }

  function publish(replace = false) { state.selectedId = selectedId; onNavigate?.({ ...state }, { replace }); }
  function stopPreview() {
    pdfReader?.destroy(); pdfReader = null;
    for (const player of stage.querySelectorAll('video,audio')) if (!player.paused) player.pause();
    stage.querySelectorAll('iframe').forEach(frame => frame.remove());
    stage.replaceChildren(); stage.className = 'explore-stage';
  }

  function showImage(block, asset) {
    stage.classList.add('has-image');
    stage.innerHTML = `<div class="explore-image-canvas"><img class="explore-large-image" alt="${escape(asset.alt || block.title)}"></div>`;
    const image = stage.querySelector('img');
    listen(image, 'error', () => { const message = doc.createElement('p'); message.className = 'explore-preview-error'; message.textContent = 'This image could not be loaded. Open its details to download the original or try again.'; stage.replaceChildren(message); });
    image.src = assetURL(block, asset, baseURI);
  }

  function paintPreview(block) {
    stopPreview(); info.hidden = true;
    const infoToggle = $('[data-explore=info]');
    infoToggle.setAttribute('aria-expanded', 'false');
    infoToggle.setAttribute('aria-label', 'Show resource information');
    preview.dataset.contextKind = 'block'; preview.dataset.contextId = block.id;
    preview.setAttribute('aria-label', `Preview ${block.title}`);
    const source = safeURL(block.source?.url), pdf = pdfAsset(block);
    preview.classList.toggle('has-pdf', Boolean(pdf));
    const asset = previewAsset(block, true);
    const player = ['video', 'audio'].includes(block.type) ? mediaPlayer(block, baseURI) : '';
    if (pdf) { stage.classList.add('has-pdf'); const reader = doc.createElement('section'); reader.className = 'pdf-reader explore-pdf'; reader.setAttribute('aria-label', 'PDF reader'); stage.append(reader); pdfReader = mountPDFReader(reader, block, baseURI, pdfOptions?.(block)); }
    else if (player) { stage.classList.add('has-media'); stage.innerHTML = `<div class="explore-media-wrap">${player}</div>`; }
    else if (!isTweet(block) && asset && (block.type === 'image' || !block.body || block.body.length < 240)) showImage(block, asset);
    else {
      stage.classList.add('has-reading');
      const body = isTweet(block) ? tweetText(block) || TWEET_TEXT_UNAVAILABLE : block.body;
      stage.innerHTML = `<article class="explore-reading"><h2>${escape(block.title)}</h2>${body ? block.contentFormat === 'markdown' && block.body?.trim() ? '<div class="saved-article"></div>' : `<div class="explore-plain-text">${escape(body)}</div>` : '<p class="explore-no-text">Open the original source or download the saved file to explore this resource.</p>'}</article>`;
      if (stage.querySelector('.saved-article')) renderSavedArticle(block, stage.querySelector('.saved-article'));
    }
    const connections = index.memberships.get(block.id) || [];
    info.innerHTML = `<h2 class="explore-preview-title">${escape(block.title)}</h2><p>${escape(typeName(block.type))} · ${escape(block.category || 'Uncategorized')}</p>${block.description ? `<p>${escape(block.description)}</p>` : ''}<div class="explore-info-tags">${(block.tags || []).map(tag => `<span>#${escape(tag)}</span>`).join('')}</div>${connections.length ? `<h4>Folders</h4>${connections.map(id => `<a href="${exploreHash({ collectionId: id })}">${icon('folder')}${escape(resourceFolderPath(catalog, id).join(' / '))}</a>`).join('')}` : '<p>In All materials</p>'}${block.summary?.text ? `<h4>Summary</h4><p>${escape(block.summary.text)}</p>` : ''}<div class="explore-resource-actions"><button class="explore-icon" data-action="item-menu" aria-haspopup="menu" aria-label="Resource actions" title="Resource actions">${icon('more')}</button><button class="explore-icon" data-action="connect-block" data-id="${escape(block.id)}" aria-label="Edit resource folders" title="Folders">${icon('folder')}</button><button class="explore-icon" data-action="open-block" data-id="${escape(block.id)}" aria-label="Open full resource details" title="Full details">${icon('expand')}</button><button class="explore-icon" data-action="discover-material" data-id="${escape(block.id)}" aria-label="Find similar resources" title="Similar resources">${icon('spark')}</button>${source ? `<a class="explore-icon" href="${escape(source)}" target="_blank" rel="noopener noreferrer" aria-label="Open original source" title="Original source">${icon('arrow')}</a>` : ''}</div>${assetDownloads(block, baseURI)}<p class="explore-kept-date">Kept on ${escape(new Date(block.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}</p><button class="button quiet" data-action="edit-block" data-id="${escape(block.id)}">Edit resource</button>`;
    for (const extra of stage.querySelectorAll('.article-markdown,.article-download,.article-byline,.article-warning,.media-origin-note,.pdf-reader-source')) { if (extra.classList.contains('pdf-reader-source')) extra.hidden = false; info.append(extra); }
    $('.explore-preview-footer').innerHTML = `<div class="explore-pagination"><button class="explore-icon" data-explore="previous" aria-label="Previous resource" title="Previous · ←"${items[0]?.id === block.id ? ' disabled' : ''}>${icon('left')}</button><span>${items.findIndex(item => item.id === block.id) + 1} / ${items.length.toLocaleString()}</span><button class="explore-icon" data-explore="next" aria-label="Next resource" title="Next · →"${items.at(-1)?.id === block.id ? ' disabled' : ''}>${icon('right')}</button></div>`;
  }

  function select(id, { publishChange = true, replace = false, reveal = false, focus = false } = {}) {
    const block = items.find(block => block.id === id);
    selectedId = block?.id || '';
    root.classList.toggle('preview-open', Boolean(block));
    preview.hidden = !block;
    if (block) {
      const position = items.indexOf(block);
      if (position >= rendered) append(Math.ceil((position + 1) / 60) * 60);
      suspended = false;
      paintPreview(block);
      if (!preview.open) preview.showModal();
    } else {
      suspended = false;
      if (preview.open) preview.close();
      stopPreview();
      info.hidden = true;
      $('[data-explore=info]').setAttribute('aria-expanded', 'false');
    }
    for (const card of grid.children) { const active = card.dataset.contextId === selectedId; card.classList.toggle('selected', active); card.querySelector('.explore-card-main').setAttribute('aria-pressed', String(active)); }
    const activeCard = [...grid.children].find(card => card.dataset.contextId === selectedId)?.querySelector('.explore-card-main');
    if (reveal) activeCard?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
    if (block) returnFocus = activeCard || returnFocus;
    if (focus) (preview.open ? $('[data-explore=close]') : activeCard)?.focus({ preventScroll: true });
    if (publishChange) publish(replace);
  }

  function renderList({ requestedId = state.selectedId, initialRender = false, normalize = false } = {}) {
    items = index.filter(state); rendered = 0;
    for (const child of grid.children) observer?.unobserve(child.querySelector('.explore-card-main'));
    grid.replaceChildren();
    const requested = items.find(item => item.id === requestedId);
    selectedId = requested?.id || '';
    $('.explore-gallery-heading h1').textContent = catalog.collections.find(item => item.id === state.collectionId)?.title || catalog.folders.find(item => item.id === state.folderId)?.title || 'All resources';
    $('.explore-count').textContent = items.length.toLocaleString();
    $('.explore-empty').hidden = items.length > 0;
    append(Math.max(60, restore?.rendered || 0));
    select(selectedId, { publishChange: false });
    if ((initialRender || normalize) && selectedId !== state.selectedId) publish(true);
  }

  function applyControls() {
    $('.explore-search input').value = state.query;
    $('.explore-type').value = state.type;
    $('.explore-sort').value = state.order;
    $('.explore-scope').value = state.collectionId ? `collection:${state.collectionId}` : state.folderId ? `folder:${state.folderId}` : '';
  }
  function updateRoute(next) {
    const changed = ['query', 'type', 'order', 'collectionId', 'folderId'].some(key => (state[key] || '') !== (next[key] || ''));
    state = { ...state, ...next }; applyControls();
    if (changed) { gallery.scrollTop = 0; renderList({ normalize: true }); }
    else if (next.selectedId !== selectedId || next.selectedId && !preview.open) select(next.selectedId, { publishChange: false, reveal: true });
  }
  function move(direction, keyboard = false) {
    const current = selectedId || doc.activeElement?.closest('[data-explore-select]')?.dataset.exploreSelect;
    const position = items.findIndex(item => item.id === current), next = items[position + direction];
    if (next) select(next.id, { replace: keyboard, reveal: true, focus: keyboard });
  }

  function dismissPreview() {
    const target = returnFocus;
    select('');
    (target?.isConnected ? target : $('.explore-search input')).focus({ preventScroll: true });
  }
  function suspendPreview() {
    if (!preview.open) return;
    suspended = true;
    preview.close();
    stopPreview();
  }
  function resumePreview() {
    if (suspended && selectedId && !doc.querySelector('dialog[open]')) select(selectedId, { publishChange: false });
  }

  listen(preview, 'cancel', event => { event.preventDefault(); dismissPreview(); });
  listen(preview, 'close', () => { if (alive && !preview.open && !suspended && selectedId) dismissPreview(); });
  listen(preview, 'click', event => {
    if (event.target !== preview) return;
    const rect = preview.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismissPreview();
  });
  listen(root, 'click', event => {
    const selected = event.target.closest('[data-explore-select]');
    if (selected) { returnFocus = selected; select(selected.dataset.exploreSelect); return; }
    const appButton = event.target.closest('[data-action]');
    const appAction = appButton?.dataset.action;
    if (appAction === 'open-pdf' && pdfReader) {
      const block = index.byId.get(selectedId);
      const asset = block?.assets?.find(asset => asset.path === appButton.dataset.asset && asset.mimeType === 'application/pdf');
      if (asset) { event.preventDefault(); event.stopPropagation(); void pdfReader.open(asset); }
      return;
    }
    if (['open-block', 'edit-block', 'connect-block'].includes(appAction)) suspendPreview();
    const action = event.target.closest('[data-explore]')?.dataset.explore;
    if (!action) return;
    if (action === 'exit') { if (onExit) { event.preventDefault(); onExit({ ...state }); } return; }
    if (action === 'previous' || action === 'next') move(action === 'next' ? 1 : -1);
    else if (action === 'close') dismissPreview();
    else if (action === 'info') {
      info.hidden = !info.hidden;
      event.target.closest('button').setAttribute('aria-expanded', String(!info.hidden));
      event.target.closest('button').setAttribute('aria-label', `${info.hidden ? 'Show' : 'Hide'} resource information`);
    }
    else if (action === 'clear') { state = { ...state, query: '', type: 'all', collectionId: '', folderId: '' }; applyControls(); gallery.scrollTop = 0; renderList({ requestedId: '' }); publish(true); }
  });
  listen(root, 'keydown', event => {
    if ([...doc.querySelectorAll('dialog[open]')].some(dialog => dialog !== preview) || event.target.closest('input,select,textarea,video,audio,iframe,[contenteditable=true]')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || (event.target.closest('.explore-card-main') && ['ArrowDown', 'ArrowUp'].includes(event.key))) { event.preventDefault(); move(event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1, true); }
    else if (event.key === 'Escape' && preview.open) { event.preventDefault(); dismissPreview(); }
  });
  listen($('.explore-search input'), 'input', event => { state.query = event.target.value; gallery.scrollTop = 0; renderList({ requestedId: '' }); publish(true); });
  listen($('.explore-type'), 'change', event => { state.type = event.target.value; gallery.scrollTop = 0; renderList({ requestedId: '' }); publish(); });
  listen($('.explore-sort'), 'change', event => { state.order = event.target.value; gallery.scrollTop = 0; renderList({ requestedId: '' }); publish(); });
  listen($('.explore-scope'), 'change', event => { const [kind, id] = event.target.value.split(':'); state.collectionId = kind === 'collection' ? id : ''; state.folderId = kind === 'folder' ? id : ''; gallery.scrollTop = 0; renderList({ requestedId: '' }); publish(); });
  listen(gallery, 'scroll', () => { if (gallery.scrollHeight - gallery.scrollTop - gallery.clientHeight < 600 && rendered < items.length) append(); }, { passive: true });
  listen(loadMore, 'click', () => append());
  listen(view, 'resize', scheduleMeasure);
  observer?.observe(stage);
  applyControls(); renderList({ initialRender: true });
  if (restore?.scrollTop) view.requestAnimationFrame(() => { if (alive) gallery.scrollTop = restore.scrollTop; });
  return {
    updateRoute, suspendPreview, resumePreview,
    getState: () => ({ ...state, selectedId, selectedIndex: Math.max(0, items.findIndex(item => item.id === selectedId)), rendered, scrollTop: gallery.scrollTop }),
    destroy() { alive = false; if (preview.open) preview.close(); events.abort(); observer?.disconnect(); if (resizeFrame) view.cancelAnimationFrame(resizeFrame); stopPreview(); container.replaceChildren(); }
  };
}
