import { renderCanvas } from './canvas.mjs';
import { LibraryStore } from './store.mjs';
import { createContextMenu } from './context-menu.mjs';
import { setupMotion } from './motion.mjs';
import { setupMicroInteractions } from './micro.mjs';
import { normalizeCategory, normalizeTags, taxonomyKey } from './shared/taxonomy.mjs';
import { renderNetwork } from './network.mjs';
import { previewAsset, pdfAsset, assetURL, mediaPlayer, assetDownloads, safeRemoteAssetURL } from './media.mjs';
import { mountPDFReader } from './pdf.mjs';
import { pdfStoreOptions } from './pdf-store.mjs';
import { stripFrontmatter } from './shared/clip-markdown.mjs';
import { isTweet, tweetText, TWEET_TEXT_UNAVAILABLE } from './shared/tweets.mjs';
import { renderSavedArticle } from './article.mjs';
import { isNetworkMaterial, relatedReadingSuggestions } from './shared/network.mjs';
import { renderDashboard } from './dashboard.mjs';
import { setupSearchUI } from './search-ui.mjs';
import { setupArchiveSearch } from './archive-search.mjs';
import { setupResearch } from './research.mjs';
import { setupSidebar } from './sidebar.mjs';
import { renderDiscover } from './discover.mjs';
import { createFolderIndex } from './folders.mjs';
import { openResourceComposer } from './resources.mjs';
import { renderExplorer, parseExploreRoute, exploreHash } from './explore.mjs';
import { setupWarmTooltips } from './tooltips.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const paths = {
  canvas: '<rect x="3" y="4" width="7" height="9" rx="1.5"/><rect x="14" y="11" width="7" height="9" rx="1.5"/><path d="M10 8h4a3 3 0 0 1 3 3"/>',
  home: '<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3V10Z"/>',
  all: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  split: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M11 3v18M3 10h8M3 16h8"/>',
  collection: '<rect x="5" y="6" width="15" height="15" rx="2"/><path d="M3 16V5a2 2 0 0 1 2-2h11"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  link: '<path d="m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M14 8l2-2a4 4 0 1 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0) scale(.92)"/>',
  text: '<path d="M5 5h14M12 5v15M8 20h8"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 4-5 4 6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  video: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 8 6 4-6 4V8Z"/>',
  audio: '<path d="M9 18V5l11-2v13M9 8l11-2"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  research: '<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4V4Z"/><path d="M13 7a3 3 0 0 1 3-3h5v15h-4a4 4 0 0 0-4 2M7 8h3M7 12h3M16 8h2M16 12h2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1"/>',
  extension: '<path d="M9 3H4v6a3 3 0 1 1 0 6v6h6a3 3 0 1 1 6 0h5v-6a3 3 0 1 1 0-6V3h-6a3 3 0 1 1-6 0Z"/>',
  settings: '<path d="M4 7h16M4 17h16M8 4v6M16 14v6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15l-1 5Z"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
  graph: '<circle cx="5" cy="12" r="3"/><circle cx="18" cy="5" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8 11 7-5m-7 7 7 5M18 8v8"/>',
  tag: '<path d="M3 3h8l10 10-8 8L3 11V3Z"/><circle cx="7.5" cy="7.5" r="1"/>',
};
const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
const typeName = type => ({ link: 'Link', text: 'Note', image: 'Image', file: 'File', video: 'Video', audio: 'Audio' }[type] || 'Material');
const safeURL = value => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
const host = block => { try { return new URL(block.source?.url).hostname.replace(/^www\./, ''); } catch { return block.type === 'text' ? 'A thought, kept here' : 'From your library'; } };
const date = value => { const d = new Date(value); return Number.isNaN(+d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const modal = $('#modal');
const detail = $('#detail');
const motion = setupMotion(document);
setupMicroInteractions(document);
setupWarmTooltips(document);
const searchUI = setupSearchUI(document);
const searchDropdown = $('#search-dropdown');
let searchInput = null;
const sidebarController = setupSidebar({ body: document.body, sidebar: $('#sidebar'), toggle: $('#menu-button'), scrim: $('#nav-scrim'), animateLayout: motion.layout });
let renderedPage = '';
let store;
const research = setupResearch({ document, getCatalog: () => store?.catalog, navigate });
const archiveSearchUI = setupArchiveSearch({
  document, getCatalog: () => store?.catalog, research,
  open(input) {
    if (searchInput !== input) closeSearch();
    searchInput = input;
    input.closest('.library-search-surface').append(searchDropdown);
    searchDropdown.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  },
  renderItems: renderSearchItems,
});
let lastRoute = '#/all';
let activeFilter = 'all';
let order = 'newest';
let layout = 'grid';
let collectionTab = 'materials';
let showEmptyFolders = false;
let indexedCatalog, folderIndex;
let toastTimer;
let categoryFilter = '';
let tagFilter = '';
let canvasView = null;
let networkView = null;
let networkState = {};
let discoverView = null;
let explorerView = null, explorerCatalog = null, explorerState = null;
let pdfReader = null;
let detailOpener = null;
const itemMenu = createContextMenu({ document, itemsFor: contextItems, titleFor: target => byId(({ block: 'blocks', collection: 'collections', folder: 'folders' })[target.dataset.contextKind], target.dataset.contextId)?.title });
const collapsed = new Set();
const knownFolders = new Set();
let sidebarCollection = '';

function toast(message) {
  clearTimeout(toastTimer);
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('visible');
  toastTimer = setTimeout(() => element.classList.remove('visible'), 3600);
}

function currentRoute() {
  const [pathname, query = ''] = (location.hash || '#/all').slice(2).split('?');
  const parts = pathname.split('/'), params = new URLSearchParams(query);
  return { type: parts[0] || 'all', id: parts[1] || '', collectionId: params.get('collection') || '', folderId: params.get('folder') || '' };
}
function byId(kind, id) { return store.catalog[kind].find(item => item.id === id); }
function folderTree() {
  if (indexedCatalog !== store.catalog) {
    indexedCatalog = store.catalog;
    folderIndex = createFolderIndex(indexedCatalog);
  }
  return folderIndex;
}
function folderBreadcrumb(record, { current = false } = {}) {
  const parts = [`<a href="#/collections">Collections</a>`, ...folderTree().ancestors(record).map(folder => `<a href="#/folder/${escape(folder.id)}">${escape(folder.title)}</a>`)];
  if (record) parts.push(current ? `<strong aria-current="page">${escape(record.title)}</strong>` : `<a href="#/folder/${escape(record.id)}">${escape(record.title)}</a>`);
  return parts.join('<span aria-hidden="true">/</span>');
}
function memberships(blockId) { return store.catalog.collections.filter(c => c.items.some(i => i.kind === 'block' && i.id === blockId)); }
function renderSaveStatus() {
  if (!store) return;
  const button = $('#save-status');
  const reconnect = store.githubConfig && store.mode !== 'github';
  button.hidden = store.saveState === 'idle' && !store.githubConfig;
  button.dataset.state = reconnect ? 'error' : store.saveState;
  $('span', button).textContent = reconnect ? 'Reconnect GitHub' : store.saveState === 'saving' ? (store.mode === 'github' ? 'Saving to GitHub…' : 'Saving…') : store.saveState === 'error' ? 'Save failed' : store.mode === 'github' ? (store.saveState === 'saved' ? 'Saved to GitHub' : 'GitHub connected') : store.mode === 'browser' ? 'Draft saved in browser' : 'Saved to local files';
  button.title = store.saveError || (store.githubConfig ? `${store.githubConfig.owner}/${store.githubConfig.repo} · ${store.githubConfig.branch}` : storageName());
}
function contextItems(target) {
  if (!store) return [];
  const kind = target.dataset.contextKind, id = target.dataset.contextId;
  const record = byId(({ block: 'blocks', collection: 'collections', folder: 'folders' })[kind] || 'blocks', id);
  if (!record) return [];
  const item = (label, action, extra = {}) => ({ label, data: { action, kind, id }, ...extra });
  const items = [item('Rename…', 'rename-item')];
  if (kind === 'block') {
    items.push(item('Edit material…', 'edit-block'), item('Edit connections…', 'connect-block'));
    const url = safeURL(record.source?.url);
    if (url) items.push({ label: 'Open original ↗', href: url });
  }
  if (kind === 'collection') items.push(item(externalCollectionURL(record) ? 'Edit saved link…' : 'Edit folder…', 'edit-collection'));
  const route = currentRoute();
  const parentId = route.type === 'collection' ? route.id : route.type === 'explore' ? route.collectionId : route.type === 'block' && lastRoute.startsWith('#/collection/') ? lastRoute.slice('#/collection/'.length) : '';
  const parent = byId('collections', parentId);
  if (kind !== 'folder' && parent?.items.some(ref => ref.kind === kind && ref.id === id)) items.push(item('Remove from this collection', 'remove-item', { separator: true, data: { action: 'remove-item', kind, id, collectionId: parent.id } }));
  const nonempty = kind === 'folder' && ([...store.catalog.folders, ...store.catalog.collections].some(record => record.parentId === id) || store.catalog.extraFiles?.some(path => path.startsWith(record.path.slice(0, record.path.lastIndexOf('/') + 1))));
  items.push(item(nonempty ? 'Folder must be empty to delete' : kind === 'block' ? 'Delete from library…' : kind === 'collection' && externalCollectionURL(record) ? 'Remove saved link…' : 'Delete folder…', 'delete-item', { danger: true, separator: true, disabled: nonempty }));
  return items;
}
function closeDetailForEdit() { if (detail.open) detail.close(); }
function dismissDetail() {
  const opener = detailOpener;
  const action = opener?.dataset.action, id = opener?.dataset.id;
  detail.close();
  if (currentRoute().type === 'block') navigate(lastRoute.startsWith('#/block/') ? '#/all' : lastRoute);
  requestAnimationFrame(() => {
    if (detail.open || modal.open) return;
    const replacement = action && id ? [...document.querySelectorAll('[data-action][data-id]')].find(node => node.dataset.action === action && node.dataset.id === id) : null;
    (opener?.isConnected ? opener : replacement || $('#header-library-search'))?.focus({ preventScroll: true });
  });
}
function renameItem(kind, id) {
  const record = byId(({ block: 'blocks', collection: 'collections', folder: 'folders' })[kind], id);
  if (!record) return;
  closeDetailForEdit();
  showModal(`${dialogHeader(`Rename ${kind === 'block' ? 'material' : kind}`)}<form class="dialog-body" id="rename-form" data-kind="${escape(kind)}" data-id="${escape(id)}">${field('title', 'Name', record.title)}${formEnd('Rename')}</form>`);
  requestAnimationFrame(() => $('#field-title', modal)?.select());
}
function deleteItem(kind, id) {
  const record = byId(({ block: 'blocks', collection: 'collections', folder: 'folders' })[kind], id);
  if (!record) return;
  closeDetailForEdit();
  const description = kind === 'block' ? 'This deletes the material and its saved files from your library and every collection.' : kind === 'collection' ? 'This removes the folder and its connections. Its materials stay in your library.' : 'This removes this empty folder.';
  showModal(`${dialogHeader(`Delete “${record.title}”?`)}<form class="dialog-body" id="delete-form" data-kind="${escape(kind)}" data-id="${escape(id)}"><p class="form-hint">${description}</p>${formEnd('Delete')}</form>`, '[data-action=close-modal]');
  $('button[type=submit]', modal).className = 'button danger';
}
function githubSettings() {
  const config = store.githubConfig;
  const connected = store.mode === 'github';
  return `<section class="settings-section"><h3>Save to GitHub</h3><p>${connected ? 'Each edit is committed automatically. Your Pages workflow publishes it afterward.' : 'Connect your repository to save renames, removals, and other edits directly to GitHub.'}</p>${config ? `<p class="github-destination">${escape(config.owner)}/${escape(config.repo)} · ${escape(config.branch)}</p>` : ''}${store.lastCommit ? `<p><a href="${escape(store.lastCommit)}" target="_blank" rel="noopener noreferrer">View last saved commit ↗</a></p>` : ''}<div class="settings-row"><button class="button" data-action="connect-github">${connected ? 'Reload from GitHub' : config ? 'Reconnect GitHub' : 'Connect GitHub'}</button>${config ? '<button class="button quiet" data-action="disconnect-github">Disconnect</button>' : ''}</div></section>`;
}
function githubDialog() {
  const config = store.githubConfig || {};
  showModal(`${dialogHeader('Connect GitHub', 'Changes will save automatically to this branch.')}<form class="dialog-body" id="github-form">${field('owner', 'Repository owner', config.owner)}${field('repo', 'Repository name', config.repo)}${field('branch', 'Branch', config.branch || 'main')}<div class="form-field"><label for="field-token">GitHub token</label><input id="field-token" name="token" type="password" autocomplete="off" spellcheck="false" required><small>Use a fine-grained token limited to this repository with Contents: read and write. The token stays in memory until this page closes or reloads.</small></div><p class="form-hint">Connecting loads the repository’s current library. Export any browser drafts or local edits you want to keep first.</p>${formEnd('Connect and load repository')}</form>`);
  for (const input of modal.querySelectorAll('input')) input.required = true;
}
function folderName(parentId) { return byId('folders', parentId)?.title || 'My library'; }
function materialCount(collection) { return collection.items.filter(i => i.kind === 'block').length; }
function externalCollectionURL(collection) { return collection && (collection.source?.arena?.importScope === 'reference' || collection.source?.external) ? safeURL(collection.source?.url) : ''; }
function storageName() { if (store.githubConfig && store.mode !== 'github') return 'Reconnect GitHub'; return ({ github: 'GitHub connected', repository: 'Local files', folder: 'Connected folder', browser: 'Browser draft' })[store.mode] || 'Browser draft'; }
function taxonomyValues(key) {
  const values = new Map();
  for (const block of store.catalog.blocks) for (const value of key === 'tags' ? block.tags || [] : [block.category || 'Uncategorized']) {
    if (!values.has(taxonomyKey(value))) values.set(taxonomyKey(value), value);
  }
  return [...values.values()].sort((a, b) => a.localeCompare(b));
}
function taxonomyFields(block = {}) {
  return `<div class="form-field"><label for="field-category">Category</label><input id="field-category" name="category" list="category-suggestions" value="${escape(block.category || '')}" placeholder="e.g. Design" maxlength="80" required><datalist id="category-suggestions">${taxonomyValues('category').map(c => `<option value="${escape(c)}"></option>`).join('')}</datalist></div><div class="form-field"><label for="field-tags">Tags</label><input id="field-tags" name="tags" value="${escape(Array.isArray(block.tags) ? block.tags.join(', ') : block.tags || '')}" placeholder="e.g. interfaces, typography, inspiration" required><small>Separate tags with commas. </small></div>`;
}
function relatedFields(block) {
  const selected = new Set((block.related || []).map(ref => typeof ref === 'string' ? ref : ref.id));
  return `<details class="relationship-picker"><summary>Direct links to other materials${selected.size ? ` (${selected.size})` : ''}</summary><input id="related-search" class="related-search" type="search" aria-label="Find materials to link" placeholder="Find a material…"><div class="checkbox-list">${store.catalog.blocks.filter(b => b.id !== block.id).map(b => `<label class="checkbox-row" data-related-title="${escape(b.title.toLowerCase())}"><input type="checkbox" name="related" value="${escape(b.id)}"${selected.has(b.id) ? ' checked' : ''}><span>${escape(b.title)}</span></label>`).join('') || '<p class="form-hint">Add another material to make a direct link.</p>'}</div></details>`;
}
function readTaxonomy(data) {
  const category = String(data.get('category') || '').trim();
  if (!category) throw new Error('Choose a category for this material.');
  const tags = normalizeTags(String(data.get('tags') || '').split(',').filter(t => t.trim()));
  if (!tags.length) throw new Error('Add at least one tag to connect this material to your library.');
  return { category: normalizeCategory(category), tags };
}
function openNetwork(filters = {}) {
  if (detail.open) { detail.close(); }
  if (modal.open) modal.close();
  networkView?.destroy();
  networkView = null;
  networkState = filters;
  navigate(networkHash(filters));
}
function networkHash(state = {}) {
  const params = new URLSearchParams();
  for (const name of ['category', 'tag', 'collection']) if (state[name]) params.set(name, state[name]);
  if (state.query) params.set('q', state.query);
  if (state.view === 'map') params.set('view', 'map');
  const query = params.toString();
  return `#/graph${state.focus ? `/${encodeURIComponent(state.focus)}` : ''}${query ? `?${query}` : ''}`;
}
function taxonomyChips(block, network = false) {
  const category = block.category || 'Uncategorized';
  return `<div class="taxonomy-chips"><button class="category-chip" data-action="${network ? 'graph-category' : 'filter-category'}" data-value="${escape(category)}">${escape(category)}</button>${(block.tags || []).slice(0, network ? 20 : 2).map(tag => `<button class="tag-chip" data-action="${network ? 'graph-tag' : 'filter-tag'}" data-value="${escape(tag)}">#${escape(tag)}</button>`).join('')}${!network && block.tags?.length > 2 ? `<button class="tag-chip tag-more" data-action="open-block" data-id="${escape(block.id)}" aria-label="Show all tags for ${escape(block.title)}">+${block.tags.length - 2}</button>` : ''}</div>`;
}
function renderGraph() {
  const route = currentRoute();
  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  let focus = route.id;
  try { focus = decodeURIComponent(focus); } catch { /* Invalid route escapes stay inert record IDs. */ }
  if (networkState.focus !== focus) networkState = { ...networkState, focus, selectedId: '', history: [], limit: 8 };
  networkState = { ...networkState, focus, category: params.get('category') || '', tag: params.get('tag') || '', collection: params.get('collection') || '', query: params.get('q') || '', view: params.get('view') === 'map' ? 'map' : 'list' };
  $('#page-header').classList.remove('dashboard-header');
  renderSidebar();
  document.title = 'Connections — Charta';
  $('#breadcrumb').innerHTML = '<a href="#/all">My library</a><span>/</span><strong>Connections</strong>';
  $('#page-header').innerHTML = '<div class="page-title-row"><h1>Connections</h1></div>';
  $('#toolbar').hidden = true;
  $('#content').className = 'network-content';
  $('#content').setAttribute('aria-label', 'Reading connections');
  $('#content').removeAttribute('aria-live');
  $('#content').replaceChildren();
  networkView = renderNetwork($('#content'), store.catalog, {
    filters: networkState,
    onStateChange: state => {
      networkState = state;
      if (currentRoute().type === 'graph') {
        const hash = networkHash(state);
        if (location.hash !== hash) document.defaultView.history.replaceState(document.defaultView.history.state, '', hash);
        lastRoute = hash;
      }
    },
    onOpen: id => { detailOpener = document.activeElement; lastRoute = location.hash; navigate(`#/block/${id}`); },
  });
}

function renderDiscoverPage(route) {
  $('#page-header').classList.remove('dashboard-header');
  renderSidebar();
  document.title = 'Discover — Charta';
  $('#breadcrumb').innerHTML = '<a href="#/all">My library</a><span>/</span><strong>Discover</strong>';
  $('#page-header').innerHTML = '<div class="page-title-row"><h1>Discover</h1><span class="title-count"></span></div>';
  $('#toolbar').hidden = true;
  $('#content').className = 'discover-content';
  discoverView = renderDiscover($('#content'), store.catalog, {
    selectedId: route.id,
    directoryHandle: store.mode === 'folder' ? store.directoryHandle : null,
    renderCard: blockCard,
    onSelect: id => navigate(`#/discover/${id}`),
    onStatus: status => { $('#page-header .title-count').textContent = status.valid || ''; },
  });
}

function renderSidebar() {
  const route = currentRoute();
  for (const folder of store.catalog.folders) {
    if (!knownFolders.has(folder.id)) {
      knownFolders.add(folder.id);
      collapsed.add(folder.id);
    }
  }
  const activeLocation = route.type === 'explore' ? `explore:${route.folderId || route.collectionId}` : ['folder', 'collection'].includes(route.type) ? `${route.type}:${route.id}` : '';
  if (activeLocation !== sidebarCollection) {
    sidebarCollection = activeLocation;
    let parentId = route.type === 'folder' ? route.id : route.type === 'explore' ? route.folderId || byId('collections', route.collectionId)?.parentId : byId('collections', route.id)?.parentId;
    const visited = new Set();
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      collapsed.delete(parentId);
      parentId = byId('folders', parentId)?.parentId;
    }
  }
  const branch = '<span class="folder-branch gradient-line-base gradient-line-branch" aria-hidden="true"></span>';
  const nav = (label, glyph, href, active, nested = false) => `<a${href.startsWith('#/collection/') || href.startsWith('#/explore?collection=') ? ` data-context-kind="collection" data-context-id="${escape(href.startsWith('#/collection/') ? href.slice('#/collection/'.length) : new URLSearchParams(href.split('?')[1]).get('collection'))}"` : ''} ${href === '#/research' ? 'data-research-link ' : ''}class="nav-item${active ? ' active' : ''}" href="${href}" aria-label="${escape(label)}" title="${escape(label)}"${active ? ' aria-current="page"' : ''}>${glyph ? icon(glyph) : nested ? branch : ''}<span class="gradient-underline gradient-underline-hover">${escape(label)}</span></a>`;
  function tree(parentId = null) {
    const entries = folderTree().contents(parentId, { showEmpty: showEmptyFolders }).folders;
    const folders = entries.filter(item => item.kind === 'folder').map(item => item.record);
    const collections = entries.filter(item => item.kind === 'collection').map(item => item.record);
    return folders.map(folder => `<div class="folder-group"><button class="folder-toggle${(route.type === 'folder' && route.id === folder.id) || (route.type === 'explore' && route.folderId === folder.id) ? ' active' : ''}" data-context-kind="folder" data-context-id="${escape(folder.id)}" data-action="toggle-folder" data-id="${escape(folder.id)}" aria-expanded="${!collapsed.has(folder.id)}" aria-label="${collapsed.has(folder.id) ? 'Expand' : 'Collapse'} ${escape(folder.title)}">${parentId ? branch : ''}${icon(collapsed.has(folder.id) ? 'chevron' : 'down', 'chevron')}</button><a class="folder-browse" href="${route.type === 'explore' ? exploreHash({ folderId: folder.id }) : `#/folder/${escape(folder.id)}`}" data-context-kind="folder" data-context-id="${escape(folder.id)}" aria-label="Open ${escape(folder.title)}">${escape(folder.title)}</a><div class="folder-children"${collapsed.has(folder.id) ? ' hidden' : ''}><span class="folder-trunk gradient-line-base gradient-line-vertical gradient-line-taper-end" aria-hidden="true"></span>${tree(folder.id)}</div></div>`).join('') + collections.map(c => nav(c.title, null, route.type === 'explore' ? exploreHash({ collectionId: c.id }) : `#/collection/${c.id}`, (route.type === 'collection' && route.id === c.id) || (route.type === 'explore' && route.collectionId === c.id), parentId !== null)).join('');
  }
  $('#sidebar').innerHTML = `<a class="brand" href="#/all" aria-label="Charta home"><img src="./assets/charta.svg" alt=""></a><button class="sidebar-save" data-action="add-material" aria-label="Save material" title="Save material">${icon('plus')}<span>Save material</span></button><nav aria-label="Main">${nav('Home', 'home', '#/all', route.type === 'all')}${nav('All materials', 'all', route.type === 'explore' ? '#/explore' : '#/materials', route.type === 'materials' || (route.type === 'explore' && !route.collectionId && !route.folderId))}${nav('Collections', 'folder', '#/collections', route.type === 'collections' || route.type === 'folder')}${nav('Research', 'research', '#/research', route.type === 'research' || (route.type === 'block' && lastRoute.startsWith('#/research')))}${nav('Canvas', 'canvas', '#/canvas', route.type === 'canvas' || (route.type === 'block' && lastRoute.startsWith('#/canvas')))}${nav('Connections', 'graph', '#/graph', route.type === 'graph' || (route.type === 'block' && lastRoute.startsWith('#/graph')))}${nav('Discover', 'spark', '#/discover', route.type === 'discover' || (route.type === 'block' && lastRoute.startsWith('#/discover')))}</nav><div class="sidebar-rule gradient-divider" aria-hidden="true"><span class="gradient-line-base gradient-line-horizontal gradient-line-taper"></span></div><div class="section-label"><span>Folders</span><button data-action="new-folder" aria-label="Create folder">${icon('plus')}</button></div><nav class="tree" aria-label="Folders and collections">${tree()}</nav><div class="sidebar-bottom"><div class="extension-frame gradient-border-outer"><button class="extension-card gradient-border-inner" data-action="extension"><span class="extension-title">${icon('extension')}Chrome extension</span></button></div><button class="storage-button" data-action="settings" aria-label="Library settings" title="Library settings"><span class="status-dot ${store.mode === 'browser' ? 'browser' : ''}"></span>${escape(storageName())}${icon('settings')}</button></div>`;
  research.refresh();
}

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function preview(block, large = false) {
  if (isTweet(block)) {
    const text = tweetText(block) || TWEET_TEXT_UNAVAILABLE;
    return `<div class="card-preview note tweet"><div class="note-preview">${escape(large ? text : text.slice(0, 400))}</div><span class="preview-type">${icon('text')}Tweet</span></div>`;
  }
  const asset = previewAsset(block, large);
  if (asset) {
    const src = assetURL(block, asset, document.baseURI);
    const classes = ['card-preview', large && block.type === 'image' ? 'image-original' : '', !large && block.type === 'video' ? 'has-video' : ''].filter(Boolean).join(' ');
    return `<div class="${classes}"><img src="${escape(src)}" alt="${escape(asset.alt || block.title)}" loading="${large ? 'eager' : 'lazy'}"><span class="preview-type">${icon(block.type)}${typeName(block.type)}</span></div>`;
  }
  if (block.type === 'text') {
    const text = (block.contentFormat === 'markdown' ? stripFrontmatter(block.body) : block.body || block.description || block.title).replace(/^#+\s*/gm, '');
    return `<div class="card-preview note"><div class="note-preview">${escape(text.slice(0, 400))}</div><span class="preview-type">${icon('text')}Note</span></div>`;
  }
  if (block.type === 'image') return `<div class="card-preview preview-file image-placeholder">${icon('image')}</div>`;
  if (['file', 'video', 'audio'].includes(block.type)) return `<div class="card-preview preview-file">${icon(block.type)}<strong>${escape(block.title)}</strong><span class="preview-type">${icon(block.type)}${typeName(block.type)}</span></div>`;
  const number = [...block.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 7;
  return `<div class="card-preview"><div class="link-art theme-${number}"><span class="link-art-top">${escape(host(block))}</span><div class="link-art-title">${escape(block.title)}</div><p class="link-art-description">${escape((block.description || '').slice(0, 95))}</p><span class="preview-ornament"></span></div><span class="preview-type">${icon('link')}Link</span></div>`;
}

function blockCard(block) {
  const collections = memberships(block.id);
  const image = block.type === 'image';
  return `<article class="material-card${image ? ' is-image' : ''}" data-type="${escape(block.type)}" data-context-kind="block" data-context-id="${escape(block.id)}"><button class="card-open" data-action="open-block" data-id="${escape(block.id)}" aria-label="Open ${escape(block.title)}">${preview(block)}${image ? '' : `<div class="card-copy"><h2 class="card-title">${escape(block.title)}</h2><div class="card-source">${escape(host(block))}</div><div class="card-bottom"><span class="membership-note">${icon('collection')}${escape(collections[0]?.title || 'Unfiled')}${collections.length > 1 ? ` +${collections.length - 1}` : ''}</span><span class="card-date">${escape(date(block.createdAt))}</span></div></div>`}</button>${image ? '' : taxonomyChips(block)}<button class="card-menu" data-action="item-menu" data-id="${escape(block.id)}" aria-label="Actions for ${escape(block.title)}" aria-haspopup="menu" title="Material actions">${icon('more')}</button></article>`;
}

function collectionCard(collection, overview = false) {
  const referenceURL = externalCollectionURL(collection);
  const blocks = collection.items.filter(i => i.kind === 'block').map(i => byId('blocks', i.id)).filter(Boolean);
  const swatches = blocks.slice(0, 3).map(block => {
    const asset = previewAsset(block);
    const src = asset && assetURL(block, asset, document.baseURI);
    return `<span>${src ? `<img src="${escape(src)}" alt="" loading="lazy">` : ''}</span>`;
  }).join('');
  return `<article class="collection-overview" data-context-kind="collection" data-context-id="${escape(collection.id)}"><button class="collection-card" data-action="open-collection" data-id="${escape(collection.id)}">${icon('collection')}<div><h3>${escape(collection.title)}</h3>${collection.description ? `<p>${escape(collection.description)}</p>` : ''}</div>${overview ? `<div class="collection-swatches">${swatches || '<span></span><span></span><span></span>'}</div>` : ''}<div class="collection-card-foot"><span>${referenceURL ? 'Are.na reference' : `${blocks.length} material${blocks.length === 1 ? '' : 's'}`}</span>${icon('arrow')}</div></button><button class="icon-button collection-menu" data-action="item-menu" aria-label="Actions for ${escape(collection.title)}" aria-haspopup="menu">${icon('more')}</button>${referenceURL ? `<a class="reference-source-link" href="${escape(referenceURL)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escape(collection.title)} in Are.na">Open in Are.na ${icon('arrow')}</a>` : ''}${overview ? `<div class="tag-label">${icon('folder')}${escape(folderName(collection.parentId))}</div>` : ''}</article>`;
}

function render() {
  if (!store) return;
  closeSearch();
  itemMenu.close({ immediate: true });
  renderSaveStatus();
  const route = currentRoute();
  document.body.dataset.view = route.type === 'block' ? lastRoute.slice(2).split('/')[0] : route.type;
  if (route.type === 'block') {
    if (!$('.archive-dashboard', $('#page-header')) && !$('#content').querySelector('.material-card,.empty-state,.research-workspace') && !networkView && !explorerView && !canvasView) renderPage({ type: 'all', id: '' });
    const block = byId('blocks', route.id);
    if (block) openDetail(block);
    else { navigate('#/all'); toast('That material could not be found.'); }
    return;
  }
  canvasView?.destroy(); canvasView = null;
  if (route.type !== 'research') research.unmount();
  if (route.type === 'explore' && explorerView && explorerCatalog === store.catalog) {
    if (detail.open) detail.close();
    explorerView.updateRoute(parseExploreRoute(location.hash));
    updateExploreChrome(explorerView.getState());
    renderSidebar(); lastRoute = location.hash; closeNav(); return;
  }
  if (explorerView) { explorerState = explorerView.getState(); explorerView.destroy(); explorerView = null; explorerCatalog = null; }
  lastRoute = location.hash || '#/all';
  if (detail.open) detail.close();
  if (networkView) { networkState = networkView.getState?.() || networkState; networkView.destroy(); networkView = null; }
  discoverView?.destroy();
  discoverView = null;
  $('#content').hidden = false;
  $('#content').setAttribute('aria-label', ['folder', 'collections'].includes(route.type) ? 'Folders' : 'Library materials');
  if (route.type === 'canvas') renderCanvasPage(route);
  else if (route.type === 'explore') renderExplorePage();
  else if (route.type === 'graph') renderGraph();
  else if (route.type === 'discover') renderDiscoverPage(route);
  else if (route.type === 'research') renderResearchPage(route);
  else renderPage(route);
  const page = `${route.type}:${route.id}`;
  if (page !== renderedPage) motion.enterPage($('#content'));
  renderedPage = page;
  closeNav();
}

function renderResearchPage(route) {
  renderSidebar();
  document.title = 'Research — Charta';
  $('#breadcrumb').innerHTML = '<a href="#/all">My library</a><span>/</span><strong>Research</strong>';
  $('#page-header').classList.remove('dashboard-header');
  $('#page-header').innerHTML = '<div class="compact-heading"><div class="page-title-row"><h1>Research</h1></div><p>Return to your questions, answers, and sources.</p></div>';
  $('#toolbar').hidden = true;
  $('#content').className = 'research-content';
  $('#content').setAttribute('aria-label', 'Archive research');
  $('#content').removeAttribute('aria-live');
  research.render($('#content'), route.id);
}

function renderCanvasPage(route) {
  renderSidebar();
  document.title = 'Canvas — Charta';
  $('#breadcrumb').innerHTML = '<a href="#/all">My library</a><span>/</span><strong>Canvas</strong>';
  $('#page-header').classList.remove('dashboard-header');
  $('#page-header').innerHTML = '';
  $('#toolbar').hidden = true;
  $('#content').className = 'canvas-content';
  $('#content').setAttribute('aria-label', 'Visual canvases');
  $('#content').removeAttribute('aria-live');
  canvasView = renderCanvas($('#content'), store, {
    boardId: route.id,
    onNavigate: id => navigate(id ? `#/canvas/${id}` : '#/canvas'),
    onCatalogChange: renderSidebar,
    onMessage: toast,
    onOpen: id => { detailOpener = document.activeElement; lastRoute = location.hash; navigate(`#/block/${id}`); }
  });
}

function updateExploreChrome(state) {
  const scope = byId('collections', state.collectionId) || byId('folders', state.folderId);
  $('#breadcrumb').innerHTML = `<a href="#/materials">All materials</a><span>/</span>${scope ? `<span>${escape(scope.title)}</span><span>/</span>` : ''}<strong>Explore</strong>`;
  document.title = `${byId('blocks', state.selectedId)?.title || scope?.title || 'All resources'} — Explore — Charta`;
}

function renderExplorePage() {
  renderSidebar();
  $('#page-header').classList.remove('dashboard-header');
  $('#page-header').replaceChildren(); $('#toolbar').replaceChildren(); $('#toolbar').hidden = true;
  $('#content').className = 'explore-content'; $('#content').setAttribute('aria-label', 'Explore resources');
  const initial = parseExploreRoute(location.hash);
  explorerCatalog = store.catalog;
  updateExploreChrome(initial);
  explorerView = renderExplorer($('#content'), store.catalog, {
    pdfOptions: block => pdfStoreOptions(store, block),
    state: initial, restore: explorerState,
    onNavigate: (state, { replace } = {}) => {
      const hash = exploreHash(state);
      if (hash !== location.hash) document.defaultView.history[replace ? 'replaceState' : 'pushState'](null, '', hash);
      lastRoute = hash; updateExploreChrome(state); renderSidebar();
    },
    onExit: state => { activeFilter = state.type; order = state.order; layout = 'grid'; navigate(state.collectionId ? `#/collection/${state.collectionId}` : '#/materials'); }
  });
}

function renderHome() {
  renderSidebar();
  document.title = 'Home — Charta';
  $('#breadcrumb').innerHTML = '<span>Home</span>';
  $('#page-header').classList.add('dashboard-header');
  $('#page-header').innerHTML = renderDashboard(store.catalog);
  $('#toolbar').hidden = true;
  $('#toolbar').replaceChildren();
  $('#content').hidden = true;
  $('#content').className = '';
  $('#content').replaceChildren();
}

function directoryCard(entry) {
  const { kind, record } = entry;
  return `<article class="directory-item" data-context-kind="${kind}" data-context-id="${escape(record.id)}"><a class="directory-open" href="#/${kind}/${escape(record.id)}"><span class="directory-glyph">${icon('folder')}</span><span class="directory-copy"><strong class="directory-title">${escape(record.title)}</strong></span></a><button class="icon-button directory-menu" data-action="item-menu" aria-label="Actions for ${escape(record.title)}" aria-haspopup="menu">${icon('more')}</button></article>`;
}

function renderFolders(route) {
  const folder = route.type === 'folder' ? byId('folders', route.id) : null;
  if (route.type === 'folder' && !folder) { navigate('#/collections'); return; }
  renderSidebar();
  const pageKey = `${route.type}:${route.id}`;
  const optionsOpen = $('#view-options')?.dataset.page === pageKey && $('#view-options').open;
  const { folders, links, hiddenEmpty } = folderTree().contents(folder?.id, { showEmpty: showEmptyFolders });
  const newAction = folder ? 'new-subfolder' : 'new-folder';
  const newLabel = folder ? 'New subfolder' : 'New folder';
  const countLabel = [folders.length ? `${folders.length} folder${folders.length === 1 ? '' : 's'}` : '', links.length ? `${links.length} link${links.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') || '0 folders';
  document.title = `${folder?.title || 'Collections'} — Charta`;
  $('#breadcrumb').innerHTML = folder ? folderBreadcrumb(folder, { current: true }) : '<span>Collections</span>';
  $('#page-header').classList.remove('dashboard-header');
  $('#page-header').innerHTML = `<div class="compact-heading"><div class="page-title-row"><h1>${escape(folder?.title || 'Collections')}</h1><span class="title-count">${countLabel}</span></div></div><div class="header-actions"><button class="folder-create" data-action="${newAction}">${icon('plus')}${newLabel}</button><details id="view-options" class="view-options folder-options" data-page="${escape(pageKey)}"${optionsOpen ? ' open data-continuing' : ''}><summary aria-label="Folder options" title="Folder options">${icon('more')}</summary><div class="view-options-panel"><label class="folder-empty-toggle"><input id="show-empty-folders" type="checkbox"${showEmptyFolders ? ' checked' : ''}>Show empty folders</label>${folder ? `<div class="view-options-actions"><button data-action="rename-item" data-kind="folder" data-id="${escape(folder.id)}">${icon('edit')}Rename folder</button></div>` : ''}</div></details></div>`;
  $('#toolbar').hidden = true;
  $('#toolbar').replaceChildren();
  $('#content').hidden = false;
  $('#content').className = 'folder-browser';
  $('#content').setAttribute('aria-label', 'Folders');
  const directory = folders.length ? `<section aria-label="${folder ? 'Subfolders' : 'Main folders'}"><h2 class="folder-section-heading">${folder ? 'Subfolders' : 'Main folders'}</h2><div class="folder-grid">${folders.map(directoryCard).join('')}</div></section>` : '';
  const sources = links.length ? `<section aria-label="Linked sources"><h2 class="folder-section-heading">Linked sources <span>· ${links.length}</span></h2><div class="folder-links">${links.map(link => `<article class="folder-link" data-context-kind="collection" data-context-id="${escape(link.id)}"><a href="${escape(link.url)}" target="_blank" rel="noopener noreferrer">${icon('link')}<span>${escape(link.title)}</span>${icon('arrow')}</a><button class="icon-button directory-menu" data-action="item-menu" aria-label="Actions for ${escape(link.title)}" aria-haspopup="menu">${icon('more')}</button></article>`).join('')}</div></section>` : '';
  $('#content').innerHTML = directory + sources || `<div class="folder-empty">${icon('folder')}<h2>${hiddenEmpty ? 'No materials in these folders yet' : 'This folder is empty'}</h2><p>${hiddenEmpty ? 'Empty folders are hidden from this view.' : 'Create a subfolder to start organizing your materials.'}</p><div class="folder-empty-actions"><button class="button" data-action="${newAction}">${icon('plus')}${newLabel}</button>${hiddenEmpty ? '<button class="button quiet" data-action="show-empty-folders">Show empty folders</button>' : ''}</div></div>`;
}

function renderPage(route) {
  if (route.type === 'all') { renderHome(); return; }
  if (route.type === 'collections' || route.type === 'folder') { renderFolders(route); return; }
  $('#content').hidden = false;
  $('#content').setAttribute('aria-label', 'Library materials');
  const pageKey = `${route.type}:${route.id || ''}`;
  const previousOptions = $('#view-options');
  const optionsOpen = Boolean(previousOptions?.open && previousOptions.dataset.page === pageKey);
  const focusedControl = previousOptions?.contains(document.activeElement) ? document.activeElement : null;
  const focusedId = focusedControl?.id;
  const focusedAction = focusedControl?.dataset.action;
  renderSidebar();
  const collection = route.type === 'collection' ? byId('collections', route.id) : null;
  if (route.type === 'collection' && !collection) { navigate('#/all'); return; }
  if (!collection && order === 'manual') order = 'newest';
  if (collection && !collection.items.some(item => item.kind === 'collection')) collectionTab = 'materials';
  const referenceURL = externalCollectionURL(collection);
  const showingCollections = route.type === 'collections' || (collection && collectionTab === 'collections');
  $('#page-header').classList.remove('dashboard-header');
  const blockRefs = collection?.items.filter(item => item.kind === 'block') || [];
  let blocks = collection ? blockRefs.map(item => byId('blocks', item.id)).filter(Boolean) : [...store.catalog.blocks];
  let collections = collection ? collection.items.filter(item => item.kind === 'collection').map(item => byId('collections', item.id)).filter(Boolean) : [...store.catalog.collections];
  const count = blocks.length;
  const networkAvailable = blocks.some(isNetworkMaterial);
  if (categoryFilter) blocks = blocks.filter(block => taxonomyKey(block.category || 'Uncategorized') === taxonomyKey(categoryFilter));
  if (tagFilter) blocks = blocks.filter(block => (block.tags || []).some(tag => taxonomyKey(tag) === taxonomyKey(tagFilter)));
  if (activeFilter !== 'all') blocks = blocks.filter(block => block.type === activeFilter);
  const filtersActive = !showingCollections && (activeFilter !== 'all' || categoryFilter || tagFilter);
  const title = collection?.title || (showingCollections ? 'Collections' : 'All materials');
  document.title = `${title} — Charta`;
  $('#breadcrumb').innerHTML = collection ? folderBreadcrumb(collection, { current: true }) : '<a href="#/all">Library</a>';

  const options = `<details id="view-options" class="view-options" data-page="${escape(pageKey)}"${optionsOpen ? ' open data-continuing' : ''}><summary aria-label="${collection ? 'Collection options' : 'View options'}" title="${collection ? 'Collection options' : 'View options'}">${icon('more')}</summary><div class="view-options-panel"><div class="menu-panel-heading"><strong>${collection ? 'Collection view' : 'Library view'}</strong>${icon('settings')}</div>
    <label>Sort<select class="filter-select" id="sort-select" aria-label="Sort materials"><option value="newest">Recently added</option><option value="oldest">Oldest first</option><option value="title">Title A–Z</option>${collection ? '<option value="manual">Collection order</option>' : ''}</select></label>
    <div class="view-options-layout"><span>View</span><div class="view-toggle"><button class="icon-button${layout === 'grid' ? ' selected' : ''}" data-action="view-grid" aria-label="Grid view" aria-pressed="${layout === 'grid'}">${icon('all')}Grid</button><button class="icon-button${layout === 'list' ? ' selected' : ''}" data-action="view-list" aria-label="List view" aria-pressed="${layout === 'list'}">${icon('list')}List</button></div></div>
    ${!showingCollections ? `<div class="view-options-filters"><label>Type<select class="filter-select" id="type-filter" aria-label="Filter material type"><option value="all">All types</option><option value="link">Links</option><option value="text">Notes</option><option value="image">Images</option><option value="file">Files</option><option value="video">Video</option><option value="audio">Audio</option></select></label><label>Category<select id="category-filter" class="filter-select" aria-label="Filter by category"><option value="">All categories</option>${taxonomyValues('category').map(category => `<option value="${escape(category)}"${taxonomyKey(category) === taxonomyKey(categoryFilter) ? ' selected' : ''}>${escape(category)}</option>`).join('')}</select></label><label>Tag<select id="tag-filter" class="filter-select" aria-label="Filter by tag"><option value="">All tags</option>${taxonomyValues('tags').map(tag => `<option value="${escape(tag)}"${taxonomyKey(tag) === taxonomyKey(tagFilter) ? ' selected' : ''}>#${escape(tag)}</option>`).join('')}</select></label>${filtersActive ? '<button class="text-button" data-action="clear-filters">Clear filters</button>' : ''}</div>` : ''}
    ${collection || networkAvailable ? `<div class="view-options-actions">${collection ? `<button data-action="edit-collection" data-id="${escape(collection.id)}">${icon('edit')}Edit collection</button>` : ''}${collection && collections.length ? `<button data-action="${showingCollections ? 'tab-materials' : 'tab-collections'}">${icon('collection')}${showingCollections ? 'Materials' : `Connected collections (${collections.length})`}</button>` : ''}${networkAvailable ? `<button data-action="view-network">${icon('graph')}Explore connections</button>` : ''}</div>` : ''}
  </div></details>`;
  const addAction = referenceURL ? `<a class="header-source" href="${escape(referenceURL)}" target="_blank" rel="noopener noreferrer">Open in Are.na ${icon('arrow')}</a>` : `<button class="icon-button header-add" data-action="${showingCollections ? 'new-container' : 'add-material'}" aria-label="${showingCollections ? 'New collection' : 'Add material'}" title="${showingCollections ? 'New collection' : 'Add material'}">${icon('plus')}</button>`;
  const headingCount = referenceURL ? '' : `<span class="title-count">${showingCollections ? collections.length : count}</span>`;
  $('#page-header').innerHTML = `<div class="compact-heading"><div class="page-title-row"><h1>${escape(title)}</h1>${headingCount}</div>${collection?.description?.trim() ? `<p>${escape(collection.description)}</p>` : ''}</div><div class="header-actions">${!showingCollections ? `<a class="explore-launch" href="${exploreHash({ collectionId: collection?.id, type: activeFilter, order, query: [categoryFilter, tagFilter].filter(Boolean).join(' ') })}" aria-label="Explore ${collection ? 'this folder' : 'all resources'} with large previews">${icon('split')}Explore</a>` : ''}${addAction}${options}</div>`;
  $('#toolbar').className = 'toolbar compact-toolbar';
  $('#toolbar').hidden = !filtersActive;
  $('#toolbar').innerHTML = filtersActive ? `<div class="filter-status"><span>${blocks.length} of ${count}</span><span>${escape([activeFilter === 'all' ? '' : typeName(activeFilter), categoryFilter, tagFilter && '#' + tagFilter].filter(Boolean).join(' · '))}</span><button class="text-button" data-action="clear-filters" aria-label="Clear filters">Clear</button></div>` : '';
  if ($('#type-filter')) $('#type-filter').value = activeFilter;
  $('#sort-select').value = order;
  const sorter = (a, b) => order === 'title' ? a.title.localeCompare(b.title) : order === 'manual' ? 0 : (order === 'oldest' ? 1 : -1) * ((Date.parse(a.createdAt || '') || 0) - (Date.parse(b.createdAt || '') || 0));
  blocks.sort(sorter);
  collections.sort(sorter);
  const items = showingCollections ? collections : blocks;
  $('#content').className = '';
  if (referenceURL && !items.length) {
    $('#content').innerHTML = '<div class="empty-state"><h2>Linked channel</h2></div>';
  } else if (!items.length) {
    const filtered = Boolean(filtersActive);
    $('#content').innerHTML = `<div class="empty-state"><h2>${showingCollections ? 'No collections' : filtered ? 'No matches' : 'No materials'}</h2><button class="button" data-action="${filtered ? 'clear-filters' : showingCollections && collection ? 'edit-collection' : showingCollections ? 'new-container' : 'add-material'}"${collection ? ` data-id="${escape(collection.id)}"` : ''}>${icon(filtered ? 'close' : 'plus')}${filtered ? 'Clear filters' : showingCollections && collection ? 'Connect a collection' : showingCollections ? 'New collection' : 'Add material'}</button></div>`;
  } else $('#content').innerHTML = `<div class="${layout === 'list' ? 'materials-list' : showingCollections ? 'collection-grid' : 'materials-grid'}">${items.map(item => showingCollections ? collectionCard(item, true) : blockCard(item)).join('')}</div>`;
  if (optionsOpen && (focusedId || focusedAction)) requestAnimationFrame(() => {
    const menu = $('#view-options');
    if (!menu?.open || menu.dataset.page !== pageKey) return;
    const target = focusedId ? document.getElementById(focusedId) : [...menu.querySelectorAll('[data-action]')].find(button => button.dataset.action === focusedAction);
    target?.focus({ preventScroll: true });
  });
}

function showModal(content, focus = 'input:not([type=hidden]),textarea,select') {
  closeSearch();
  itemMenu.close({ immediate: true });
  explorerView?.suspendPreview();
  modal.dispatchEvent(new modal.ownerDocument.defaultView.Event('resource-dispose'));
  modal.classList.remove('resource-modal');
  delete modal.dataset.instant;
  modal.innerHTML = content;
  if (!modal.open) modal.showModal();
  requestAnimationFrame(() => ($(focus, modal) || $('button', modal))?.focus());
}
const dialogHeader = (title, description = '') => `<div class="dialog-header"><div><h2>${escape(title)}</h2>${description ? `<p>${escape(description)}</p>` : ''}</div><button type="button" class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></div>`;
const field = (name, label, value = '', type = 'text', placeholder = '') => `<div class="form-field"><label for="field-${name}">${escape(label)}</label><input id="field-${name}" name="${name}" type="${type}" value="${escape(value)}" placeholder="${escape(placeholder)}"${['title', 'url'].includes(name) ? ' required' : ''}${name === 'url' ? ' autocomplete="url"' : ''}></div>`;
const textarea = (name, label, value = '', placeholder = '') => `<div class="form-field"><label for="field-${name}">${escape(label)}</label><textarea id="field-${name}" name="${name}" placeholder="${escape(placeholder)}">${escape(value)}</textarea></div>`;
const formEnd = (label = 'Save') => `<p class="form-error" id="form-error" role="alert" hidden></p><div class="form-actions"><button type="button" class="button quiet" data-action="close-modal">Cancel</button><button class="button primary" type="submit">${label}</button></div>`;
function collectionOptions(selected = []) { return `<option value=""${selected.includes('') ? ' selected' : ''}>All materials</option>` + store.catalog.collections.filter(c => !externalCollectionURL(c)).map(c => `<option value="${escape(c.id)}"${selected.includes(c.id) ? ' selected' : ''}>${escape([...folderTree().ancestors(c).map(folder => folder.title), c.title].join(' / '))}</option>`).join(''); }

function addMaterial(type = 'link', draft = {}) {
  const route = currentRoute();
  const target = route.type === 'collection' ? route.id : '';
  showModal(`${dialogHeader('Add material')}<form class="dialog-body" id="material-form" data-type="${type}"><div class="input-tabs" role="group" aria-label="Material type"><button type="button" data-action="material-link" class="${type === 'link' ? 'active' : ''}">${icon('link')} Link</button><button type="button" data-action="material-note" class="${type === 'text' ? 'active' : ''}">${icon('text')} Note</button></div>${type === 'link' ? field('url', 'Web address', draft.url, 'url', 'https://example.com') : ''}${field('title', 'Title', draft.title, 'text', 'Title')}${type === 'text' ? textarea('body', 'Text', draft.body) : textarea('description', 'Note', draft.description)}${taxonomyFields(draft)}<div class="form-field"><label for="field-collection">Save in</label><select name="collection" id="field-collection">${collectionOptions([draft.collection ?? target])}</select></div>${store.mode === 'browser' ? '<p class="form-hint">Saved in this browser. Export your library or connect a folder in settings to keep the files.</p>' : ''}${formEnd('Save material')}</form>`);
}

function containerDialog(kind = 'collection') {
  const isFolder = kind === 'folder';
  showModal(`${dialogHeader(isFolder ? 'New folder' : 'New collection')}<form class="dialog-body" id="container-form" data-kind="${kind}"><div class="input-tabs"><button type="button" class="${!isFolder ? 'active' : ''}" data-action="container-collection">Collection</button><button type="button" class="${isFolder ? 'active' : ''}" data-action="container-folder">Folder</button></div>${field('title', 'Name', '', 'text', 'Name')}${!isFolder ? textarea('description', 'Description') : ''}<div class="form-field"><label for="field-parent">Folder</label><select id="field-parent" name="parent"><option value="">My library</option>${store.catalog.folders.map(f => `<option value="${escape(f.id)}">${escape(f.title)}</option>`).join('')}</select></div>${formEnd(isFolder ? 'Create folder' : 'Create collection')}</form>`);
}

function newFolderDialog(kind) {
  const route = currentRoute();
  const parentId = route.type === 'folder' ? route.id : route.type === 'collection' ? byId('collections', route.id)?.parentId : null;
  showModal(`${dialogHeader(kind === 'collection' ? 'New subfolder' : 'New folder')}<form class="dialog-body" id="container-form" data-kind="${kind}">${field('title', 'Name', '', 'text', 'Folder name')}<div class="form-field"><label for="field-contents">Contains</label><select id="field-contents" name="contents"><option value="collection"${kind === 'collection' ? ' selected' : ''}>Materials</option><option value="folder"${kind === 'folder' ? ' selected' : ''}>Subfolders</option></select></div><div class="form-field"><label for="field-parent">Location</label><select id="field-parent" name="parent"><option value="">Main folders</option>${store.catalog.folders.map(folder => `<option value="${escape(folder.id)}"${folder.id === parentId ? ' selected' : ''}>${escape([...folderTree().ancestors(folder).map(parent => parent.title), folder.title].join(' / '))}</option>`).join('')}</select></div>${formEnd('Create folder')}</form>`);
}

function openDetail(block) {
  const replacingOpenDetail = detail.open;
  pdfReader?.destroy();
  pdfReader = null;
  for (const player of detail.querySelectorAll('video,audio')) if (!player.paused) player.pause();
  const pdf = pdfAsset(block);
  detail.classList.toggle('has-pdf', Boolean(pdf));
  detail.dataset.contextKind = 'block';
  detail.dataset.contextId = block.id;
  const url = safeURL(block.source?.url);
  const collections = memberships(block.id);
  const summary = block.summary?.text || '';
  const isAI = summary && !block.summary.editedByOwner && block.summary.provider !== 'manual';
  const player = pdf ? '<section class="pdf-reader" aria-label="PDF reader"></section>' : mediaPlayer(block, document.baseURI);
  const image = previewAsset(block, true);
  const tweet = isTweet(block);
  const reading = !player && (tweet || block.body && (block.type === 'text' || block.contentFormat === 'markdown' || !image));
  const artefact = player || (reading
    ? `<article class="artefact-reading"><h1 class="artefact-reading-title">${escape(block.title)}</h1>${block.contentFormat === 'markdown' && (!tweet || tweetText(block)) ? '<section class="saved-article" aria-label="Saved article"></section>' : `<div class="artefact-text">${escape(tweet ? tweetText(block) || TWEET_TEXT_UNAVAILABLE : block.body)}</div>`}</article>`
    : `<div class="detail-preview">${preview(block, true)}</div>`);
  detail.setAttribute('aria-label', block.title);
  detail.classList.toggle('has-image', Boolean(image && !reading && !player));
  detail.innerHTML = `<div class="artefact-controls"><button type="button" class="artefact-button" data-action="close-detail" aria-label="Close material" title="Close preview">${icon('close')}</button><button type="button" class="artefact-button artefact-info-toggle" data-action="toggle-detail-info" aria-label="Show tags and information" aria-expanded="false" aria-controls="detail-info" title="Show tags and information">${icon('plus')}</button></div>
    <div class="artefact-body"><div class="detail-stage" tabindex="-1">${artefact}</div>
    <aside id="detail-info" class="detail-info artefact-info" aria-label="Material information" hidden>
      <div class="detail-info-heading"><span class="detail-kind">${icon(block.type)}${typeName(block.type)}</span><div class="detail-top-actions"><button class="icon-button" data-action="edit-block" data-id="${escape(block.id)}" aria-label="Edit material" title="Edit material">${icon('edit')}</button><button class="icon-button" data-action="item-menu" aria-label="Material actions" aria-haspopup="menu" title="Material actions">${icon('more')}</button></div></div>
      <h2 id="detail-title">${escape(block.title)}</h2>
      ${url ? `<a class="source-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(host(block))}${icon('arrow')}</a>` : '<span class="source-link">From your library</span>'}
      ${block.description ? `<section class="detail-section"><h3>Your note</h3><p>${escape(block.description)}</p></section>` : ''}
      ${block.body && !reading ? `<section class="detail-section"><h3>Saved text</h3><p class="body-text">${escape(block.contentFormat === 'markdown' ? stripFrontmatter(block.body) : block.body)}</p></section>` : ''}
      <section class="detail-section"><h3>Category and tags <button class="inline-action" data-action="edit-block" data-id="${escape(block.id)}">Edit</button></h3>${taxonomyChips(block, true)}${isNetworkMaterial(block) ? `<button class="text-button detail-network-link" data-action="graph-material" data-id="${escape(block.id)}">${icon('graph')}Explore connections</button>` : ''}</section>
      ${summary ? `<section class="detail-section"><h3>Summary ${isAI ? '<span class="summary-label">AI</span>' : ''}</h3><p>${escape(summary)}</p></section>` : ''}
      <section class="detail-section"><h3>Connected to <button class="inline-action" data-action="connect-block" data-id="${escape(block.id)}">Edit connections</button></h3>${collections.length ? collections.map(c => `<a class="connection-pill" href="#/collection/${escape(c.id)}">${icon('collection')}${escape(c.title)}</a>`).join('') : '<p>Unfiled</p>'}</section>
      ${block.related?.length ? `<section class="detail-section"><h3>Related material</h3>${block.related.map(ref => byId('blocks', typeof ref === 'string' ? ref : ref.id)).filter(Boolean).map(b => `<button class="connection-pill" data-action="open-block" data-id="${escape(b.id)}">${icon('link')}${escape(b.title)}</button>`).join('')}</section>` : ''}
      ${assetDownloads(block, document.baseURI)}
      <p class="detail-date">Kept on ${escape(new Date(block.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}${block.sample || block.demo ? ' · Sample material' : ''}</p>
    </aside></div>`;
  if (reading && $('.saved-article', detail)) {
    const article = $('.saved-article', detail);
    renderSavedArticle(block, article);
    for (const tool of article.querySelectorAll('.article-byline,.article-markdown,.article-download')) $('#detail-info', detail).append(tool);
  }
  const origin = $('.media-origin-note', detail);
  if (origin) $('#detail-info', detail).append(origin);
  const similar = document.createElement('button');
  similar.className = 'text-button detail-discover-link';
  similar.dataset.action = 'discover-material';
  similar.dataset.id = block.id;
  similar.innerHTML = `${icon('spark')}Similar`;
  $('.taxonomy-chips', detail).after(similar);
  const readings = relatedReadingSuggestions(block, store.catalog, { includeDocuments: true });
  if (readings.length) {
    const section = document.createElement('section');
    section.className = 'detail-section suggested-readings';
    const heading = document.createElement('h3');
    heading.textContent = 'Related reading';
    section.append(heading);
    for (const suggestion of readings) {
      const link = document.createElement('button');
      link.className = 'connection-pill';
      link.dataset.action = 'open-block';
      link.dataset.id = suggestion.id;
      link.textContent = suggestion.block.title;
      link.title = `Suggested reading: ${suggestion.reason}`;
      link.setAttribute('aria-label', `${suggestion.block.title}. Suggested reading: ${suggestion.reason}`);
      section.append(link);
    }
    $('.detail-date', detail).before(section);
  }
  if (!detail.open) detail.showModal();
  else if (replacingOpenDetail && !detail.contains(document.activeElement)) $('[data-action=close-detail]', detail).focus({ preventScroll: true });
  if (pdf) {
    pdfReader = mountPDFReader($('.pdf-reader', detail), block, document.baseURI, pdfStoreOptions(store, block));
    const sourceActions = $('.pdf-reader-source', detail);
    sourceActions.hidden = false;
    $('#detail-info', detail).append(sourceActions);
  }
}

function editBlock(id) {
  const block = byId('blocks', id);
  if (!block) return;
  if (detail.open) { detail.close(); }
  showModal(`${dialogHeader('Edit material')}<form class="dialog-body" id="edit-form" data-id="${escape(id)}">${field('title', 'Title', block.title)}${textarea('description', 'Your note', block.description || '')}${taxonomyFields(block)}${textarea('body', block.type === 'text' ? 'Note text' : 'Captured text', block.body || '')}${textarea('summary', 'Summary', block.summary?.text || '')}${relatedFields(block)}${formEnd('Save changes')}</form>`);
}

function connectBlock(id) {
  const block = byId('blocks', id);
  if (!block) return;
  const ids = memberships(id).map(c => c.id);
  showModal(`${dialogHeader('Collections', block.title)}<form class="dialog-body" id="connect-form" data-id="${escape(id)}"><div class="checkbox-list">${store.catalog.collections.map(c => `<label class="checkbox-row"><input type="checkbox" name="collection" value="${escape(c.id)}"${ids.includes(c.id) ? ' checked' : ''}>${icon('collection')}<span>${escape(c.title)}</span><small>${materialCount(c)}</small></label>`).join('')}</div>${formEnd('Save connections')}</form>`);
}

function editCollection(id) {
  const c = byId('collections', id);
  if (!c) return;
  const ids = c.items.filter(i => i.kind === 'collection').map(i => i.id);
  const folderPicker = `<div class="form-field"><label for="field-parent">Folder</label><select id="field-parent" name="parent"><option value="">My library</option>${store.catalog.folders.map(f => `<option value="${escape(f.id)}"${f.id === c.parentId ? ' selected' : ''}>${escape(f.title)}</option>`).join('')}</select></div>`;
  showModal(`${dialogHeader('Edit collection')}<form class="dialog-body" id="collection-form" data-id="${escape(id)}">${field('title', 'Name', c.title)}${textarea('description', 'Description', c.description)}${folderPicker}<div class="form-field"><span class="field-label">Connect other collections</span><div class="checkbox-list">${store.catalog.collections.filter(other => other.id !== id).map(other => `<label class="checkbox-row"><input type="checkbox" name="connection" value="${escape(other.id)}"${ids.includes(other.id) ? ' checked' : ''}>${icon('collection')}<span>${escape(other.title)}</span></label>`).join('')}</div></div>${formEnd('Save collection')}</form>`);
}

function arenaImportStatus() {
  const source = store.catalog.library.importedFrom;
  if (!source || source.service !== 'are.na') return '<p>This draft uses sample material. The next step is importing your account’s blocks and channels, keeping source information and shared connections intact.</p>';
  const blocks = store.catalog.blocks.filter(block => block.source?.arena?.id).length;
  const collections = store.catalog.collections.filter(collection => collection.source?.arena?.id);
  const references = collections.filter(collection => collection.source.arena.importScope === 'reference').length;
  const account = collections.length - references;
  const profile = source.username ? `https://www.are.na/${encodeURIComponent(source.username)}` : '';
  const report = store.catalog.extraFiles?.includes('content/imports/arena/report.json');
  return `<p>${blocks.toLocaleString()} materials imported into ${account.toLocaleString()} account collections, with ${references.toLocaleString()} linked channel references. Original source information and shared connections are preserved.</p><div class="settings-row">${profile ? `<a class="button" href="${escape(profile)}" target="_blank" rel="noopener noreferrer">View source account ${icon('arrow')}</a>` : ''}${report ? '<a class="button" href="./content/imports/arena/report.json" target="_blank" rel="noopener noreferrer">Import report ↗</a>' : ''}</div>`;
}

function settings(extensionFocus = false) {
  showModal(`${dialogHeader(extensionFocus ? 'Chrome extension' : 'Settings')}<div class="dialog-body">${store.upstreamChanged ? '<p class="modal-note">The published library has changed. Export your browser edits, then load the latest library below.</p>' : ''}<p class="modal-note"><span class="status-dot ${store.mode === 'browser' ? 'browser' : ''}"></span> ${escape(storageName())}${store.mode === 'github' ? '<br>Every change is committed directly to your GitHub branch.' : store.mode === 'repository' ? '<br>Changes are written directly to this project’s <code>content/</code> folder.' : store.mode === 'folder' ? '<br>Changes are written to the content folder you connected.' : '<br>Edits stay in this browser. Export them before opening a local folder’s library.'}</p>${githubSettings()}<section class="settings-section"><h3>Backup</h3><div class="settings-row"><button class="button" data-action="export">${icon('download')}Export content</button>${'showDirectoryPicker' in window && store.mode !== 'repository' ? `<button class="button" data-action="connect-folder">${icon('folder')}Connect local folder</button>` : ''}</div></section><section class="settings-section"><h3>The Chrome extension</h3><p>Save the page you’re on or a selection of text into a collection. The draft extension commits directly to your GitHub repository.</p><a class="button" href="./extension.zip" download="charta-chrome-extension.zip">${icon('extension')}Download extension</a><details${extensionFocus ? ' open' : ''}><summary>Set it up in Chrome</summary><ol><li>Unzip the download.</li><li>Open <code>chrome://extensions</code> and enable Developer mode.</li><li>Choose Load unpacked and select the unzipped folder.</li><li>In Charta’s extension settings, enter your repository and a fine-grained GitHub token with Contents write access to that repository.</li></ol><p>The token stays in the extension for the browser session. A save is confirmed after GitHub accepts the commit; publication follows your Pages workflow.</p></details></section><section class="settings-section"><h3>Summaries</h3><p>Configure a provider in GitHub Actions for automatic summaries.</p><details><summary>Repository configuration</summary><p>Add the <code>SUMMARY_API_KEY</code> Actions secret and set <code>SUMMARY_ENDPOINT</code> and <code>SUMMARY_MODEL</code> repository variables. The endpoint must support the chat completions format. Captured text is sent to the provider you choose.</p></details></section><section class="settings-section"><h3>Your Are.na library</h3>${arenaImportStatus()}</section>${store.mode === 'browser' ? '<section class="settings-section"><h3>Start over</h3><p>Load the published library in this browser. Export your changes first if you want to keep them.</p><button class="button danger" data-action="reset-draft">Load published library</button></section>' : ''}</div>`, 'button');
}

function closeSearch() {
  archiveSearchUI.cancel();
  searchInput?.setAttribute('aria-expanded', 'false');
  searchInput?.removeAttribute('aria-activedescendant');
  searchInput = null;
  searchDropdown.hidden = true;
  // Keep the shared results available when a page replaces the home search.
  if (searchDropdown.parentElement !== document.body) document.body.append(searchDropdown);
}
function focusSearch() {
  if (modal.open) modal.close();
  const focus = () => {
    const input = $('#library-search') || $('#header-library-search');
    input.focus();
    input.select();
    updateSearch(input);
  };
  if (detail.open) { dismissDetail(); requestAnimationFrame(focus); }
  else focus();
}
function searchResultPreview(item) {
  const kind = item.entity === 'collection' ? 'collection' : item.type;
  const asset = item.entity === 'block' && !isTweet(item) && previewAsset(item);
  const src = asset && assetURL(item, asset, document.baseURI);
  return `<span class="search-result-icon" data-kind="${escape(kind)}" aria-hidden="true">${icon(kind)}${src ? `<img class="search-result-thumbnail" src="${escape(src)}" alt="" width="34" height="34" loading="lazy" decoding="async">` : ''}</span>`;
}
function updateSearch(input) {
  if (!archiveSearchUI.update(input)) closeSearch();
}
function renderSearchItems(rows) {
  const blocks = new Map(store.catalog.blocks.map(item => [item.id, item]));
  const collections = new Map(store.catalog.collections.map(item => [item.id, item]));
  const items = rows.flatMap(row => {
    const entity = row.entity === 'collection' ? 'collection' : 'block';
    const item = (entity === 'collection' ? collections : blocks).get(row.id);
    return item ? [{ ...item, entity }] : [];
  });
  $('#search-results-count').textContent = `${items.length} ${items.length === 1 ? 'result' : 'results'}`;
  $('#search-results').innerHTML = '<span class="search-selection" aria-hidden="true"></span>' + (items.length ? items.map((item, index) => `<button class="search-result" id="search-option-${index}" role="option" aria-selected="false" tabindex="-1" data-action="search-${item.entity}" data-id="${escape(item.id)}">${searchResultPreview(item)}<span class="search-result-copy"><strong>${escape(item.title)}</strong><small>${escape(item.entity === 'collection' ? `${materialCount(item)} materials · Collection` : `${typeName(item.type)} · ${host(item)}`)}</small></span><span class="search-result-enter" aria-hidden="true">↵</span></button>`).join('') : `<div class="search-no-results">${icon('search')}<strong>Nothing here yet</strong><span>Try a different title, topic, or tag.</span></div>`);
  searchUI.refresh();
}

function closeNav() { sidebarController.closeMobile(); }
function formError(error, form) { const field = $('#form-error', form); if (field) { field.textContent = error.message || 'Something went wrong. Please try again.'; field.hidden = false; } else toast(error.message); }

document.addEventListener('submit', async event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const button = $('button[type=submit]', form);
  const data = new FormData(form);
  if (button) button.disabled = true;
  try {
    let operation;
    let message = 'Saved.';
    if (form.id === 'github-form') {
      const token = String(data.get('token') || '');
      await store.connectGitHub({ owner: data.get('owner'), repo: data.get('repo'), branch: data.get('branch') }, token);
      form.reset(); modal.close(); render(); toast('GitHub connected. Changes now commit automatically.'); return;
    }
    if (form.id === 'rename-form') {
      const kind = form.dataset.kind, title = String(data.get('title') || '').trim();
      operation = kind === 'block' ? { type: 'update-block', id: form.dataset.id, patch: { title } } : { type: `update-${kind}`, id: form.dataset.id, title };
      message = 'Renamed.';
    } else if (form.id === 'delete-form') {
      operation = { type: `delete-${form.dataset.kind}`, id: form.dataset.id };
      message = 'Deleted.';
    } else if (form.id === 'material-form') {
      const type = form.dataset.type;
      const url = type === 'link' ? safeURL(data.get('url')) : '';
      if (type === 'link' && !url) throw new Error('Enter a full web address beginning with https:// or http://.');
      const title = String(data.get('title') || '').trim();
      if (!title) throw new Error('Give your material a title.');
      const taxonomy = readTaxonomy(data);
      const now = new Date().toISOString();
      const collectionIds = data.get('collection') ? [String(data.get('collection'))] : [];
      const existing = type === 'link' && store.catalog.blocks.find(b => b.type === 'link' && safeURL(b.source?.url) === url);
      if (existing) {
        operation = { type: 'connect', blockId: existing.id, collectionIds: [...new Set([...memberships(existing.id).map(c => c.id), ...collectionIds])], taxonomy: { category: taxonomy.category, tags: normalizeTags([...(existing.tags || []), ...taxonomy.tags]) } };
        message = 'Existing material connected; category and tags updated.';
      } else {
        form.dataset.recordId ||= `b_${crypto.randomUUID().replaceAll('-', '')}`;
        operation = { type: 'add-block', block: { schemaVersion: 1, id: form.dataset.recordId, type, title, ...taxonomy, description: String(data.get('description') || '').trim(), source: url ? { url, title, capturedAt: now } : {}, assets: [], related: [], createdAt: now, updatedAt: now }, body: String(data.get('body') || '').trim(), collectionIds };
        message = 'Saved.';
      }
    } else if (form.id === 'container-form') {
      const kind = data.get('contents') || form.dataset.kind;
      form.dataset.recordId ||= `${kind === 'folder' ? 'f' : 'c'}_${crypto.randomUUID().replaceAll('-', '')}`;
      operation = { type: kind === 'folder' ? 'create-folder' : 'create-collection', id: form.dataset.recordId, title: String(data.get('title') || '').trim(), description: String(data.get('description') || '').trim(), parentId: data.get('parent') || null };
      message = data.has('contents') || kind === 'folder' ? 'Folder created.' : 'Collection created.';
    } else if (form.id === 'edit-form') {
      const original = byId('blocks', form.dataset.id);
      const summary = String(data.get('summary')).trim();
      const patch = { title: String(data.get('title')).trim(), description: String(data.get('description')).trim(), ...readTaxonomy(data), related: data.getAll('related') };
      if (summary !== (original.summary?.text || '')) patch.summary = summary;
      operation = { type: 'update-block', id: form.dataset.id, patch, body: String(data.get('body')) };
      message = 'Saved.';
    } else if (form.id === 'connect-form') {
      operation = { type: 'connect', blockId: form.dataset.id, collectionIds: data.getAll('collection') };
      message = 'Connections updated.';
    } else if (form.id === 'collection-form') {
      const collection = byId('collections', form.dataset.id);
      operation = { type: 'update-collection', id: collection.id, title: String(data.get('title')).trim(), description: String(data.get('description')).trim() };
      const parentId = data.get('parent') || null;
      if (parentId !== (collection.parentId || null)) operation.parentId = parentId;
      const chosen = new Set(data.getAll('connection'));
      const existing = collection.items.filter(i => i.kind === 'collection').map(i => i.id);
      if (chosen.size !== existing.length || existing.some(id => !chosen.has(id))) {
        operation.items = [...collection.items.filter(i => i.kind === 'block' || chosen.has(i.id)), ...[...chosen].filter(id => !existing.includes(id)).map(id => ({ kind: 'collection', id }))];
      }
      message = 'Collection updated.';
    }
    if (!operation) return;
    const deletedParentId = operation.type.startsWith('delete-') ? [...store.catalog.folders, ...store.catalog.collections].find(record => record.id === operation.id)?.parentId : null;
    const result = await store.apply(operation);
    modal.close();
    if (operation.type === 'delete-block' && currentRoute().type === 'block') navigate(lastRoute.startsWith('#/block/') ? '#/all' : lastRoute);
    else if (['delete-collection', 'delete-folder'].includes(operation.type) && currentRoute().id === operation.id) navigate(deletedParentId ? `#/folder/${deletedParentId}` : '#/collections');
    else if (['create-collection', 'create-folder'].includes(operation.type) && result.entityId) {
      showEmptyFolders = true;
      collectionTab = 'materials';
      navigate(`#/${operation.type === 'create-folder' ? 'folder' : 'collection'}/${result.entityId}`);
    }
    else render();
    toast(store.mode === 'github' ? `${message} Saved to GitHub.` : message);
  } catch (error) { formError(error, form); }
  finally { if (button) button.disabled = false; }
});

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (!['view-grid', 'view-list', 'clear-filters'].includes(action)) {
    const options = $('#view-options');
    if (options) options.open = false;
  }
  try {
    if (action === 'item-menu') { const target = button.closest('[data-context-kind]'); if (target) itemMenu.open(target, { keyboard: true, anchor: button }); }
    else if (action === 'rename-item') renameItem(button.dataset.kind, id);
    else if (action === 'delete-item') deleteItem(button.dataset.kind, id);
    else if (action === 'remove-item') {
      button.disabled = true;
      await store.apply({ type: 'remove-connection', kind: button.dataset.kind, id, collectionId: button.dataset.collectionId });
      render(); toast(store.mode === 'github' ? 'Removed from collection. Saved to GitHub.' : 'Removed from collection.');
    }
    else if (action === 'connect-github') githubDialog();
    else if (action === 'disconnect-github') { await store.disconnectGitHub(); settings(); renderSaveStatus(); renderSidebar(); toast('GitHub disconnected.'); }
    else if (action === 'open-block' || action === 'search-block') { if (!detail.open) detailOpener = action === 'search-block' ? searchInput : button; if (modal.open) modal.close(); if (currentRoute().type !== 'block') lastRoute = location.hash || '#/all'; navigate(`#/block/${id}`); }
    else if (action === 'open-collection' || action === 'search-collection') { if (modal.open) modal.close(); collectionTab = 'materials'; navigate(`#/collection/${id}`); }
    else if (action === 'toggle-folder') { collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); renderSidebar(); }
    else if (action === 'close-modal') modal.close();
    else if (action === 'close-detail') dismissDetail();
    else if (action === 'toggle-detail-info') {
      const info = $('#detail-info', detail);
      info.hidden = !info.hidden;
      button.setAttribute('aria-expanded', String(!info.hidden));
      button.setAttribute('aria-label', info.hidden ? 'Show tags and information' : 'Hide tags and information');
      button.title = info.hidden ? 'Show tags and information' : 'Hide tags and information';
    }
    else if (action === 'add-material') addMaterial();
    else if (action === 'add-resource') openResourceComposer({ document, dialog: modal, showModal, store, icon, onSaved: () => { render(); renderSaveStatus(); } });
    else if (action === 'new-folder' || action === 'new-subfolder') newFolderDialog(action === 'new-subfolder' ? 'collection' : 'folder');
    else if (action === 'show-empty-folders') { showEmptyFolders = true; render(); }
    else if (action === 'new-container' || action === 'container-collection') containerDialog();
    else if (action === 'container-folder') containerDialog('folder');
    else if (action === 'material-link' || action === 'material-note') { const form = $('#material-form'); const data = Object.fromEntries(new FormData(form)); addMaterial(action === 'material-link' ? 'link' : 'text', data); }
    else if (action === 'connect-block') connectBlock(id);
    else if (action === 'edit-block') editBlock(id);
    else if (action === 'edit-collection') editCollection(id);
    else if (action === 'filter-category' || action === 'filter-tag') {
      categoryFilter = action === 'filter-category' ? button.dataset.value : '';
      tagFilter = action === 'filter-tag' ? button.dataset.value : '';
      if (currentRoute().type === 'materials') render();
      else navigate('#/materials');
    }
    else if (action === 'clear-filters') { categoryFilter = ''; tagFilter = ''; activeFilter = 'all'; render(); }
    else if (action === 'graph-category') openNetwork({ category: button.dataset.value });
    else if (action === 'graph-tag') openNetwork({ tag: button.dataset.value });
    else if (action === 'graph-material' && isNetworkMaterial(byId('blocks', id))) openNetwork({ focus: id });
    else if (action === 'discover-material') {
      if (detail.open) { detail.close(); }
      if (modal.open) modal.close();
      navigate(`#/discover/${id}`);
    }
    else if (action === 'view-network') openNetwork({ category: categoryFilter, tag: tagFilter, collection: currentRoute().type === 'collection' ? currentRoute().id : '' });
    else if (action === 'tab-materials') { collectionTab = 'materials'; if (currentRoute().type === 'collections') navigate('#/materials'); else render(); }
    else if (action === 'tab-collections') { collectionTab = 'collections'; if (currentRoute().type === 'materials') navigate('#/collections'); else render(); }
    else if (action === 'view-grid' || action === 'view-list') { layout = action === 'view-grid' ? 'grid' : 'list'; render(); }
    else if (action === 'settings') settings();
    else if (action === 'extension') settings(true);
    else if (action === 'open-pdf') {
      event.preventDefault();
      const block = byId('blocks', id);
      const asset = block?.assets.find(asset => asset.path === button.dataset.asset && asset.mimeType === 'application/pdf');
      if (asset && pdfReader) {
        void pdfReader.open(asset);
        $('.pdf-reader', detail)?.scrollIntoView?.({ block: 'start' });
      }
    }
    else if (action === 'download-asset') {
      event.preventDefault();
      const value = button.getAttribute('href');
      const url = new URL(value, document.baseURI);
      const loadedPDF = pdfReader?.downloadURL(url.href);
      if (loadedPDF || url.origin === location.origin || url.protocol === 'blob:') {
        const anchor = document.createElement('a'); anchor.href = loadedPDF || url.href; anchor.download = button.getAttribute('download') || 'original'; anchor.click();
      } else {
        const remote = safeRemoteAssetURL(url.href);
        if (!remote) throw new Error('This original has an invalid download address.');
        button.setAttribute('aria-busy', 'true');
        try {
          const response = await fetch(remote, { credentials: 'omit', cache: 'no-store' });
          if (!response.ok) throw new Error('The archived original is unavailable. Check that its GitHub repository is public.');
          const objectURL = URL.createObjectURL(await response.blob());
          const anchor = document.createElement('a'); anchor.href = objectURL; anchor.download = button.getAttribute('download') || 'original'; anchor.click();
          setTimeout(() => URL.revokeObjectURL(objectURL), 30000);
        } finally { button.removeAttribute('aria-busy'); }
      }
    }
    else if (action === 'export') { button.disabled = true; await store.exportContent(); toast('Your content folder is ready to keep.'); }
    else if (action === 'connect-folder') { await store.connectFolder(); modal.close(); render(); toast('Connected. Changes now save to your local content folder.'); }
    else if (action === 'reset-draft') {
      showModal(`${dialogHeader('Reset this browser draft?')}<div class="dialog-body"><p class="form-hint">Your browser edits will be replaced with the published library. Your exported files and repository are unaffected.</p><div class="form-actions"><button class="button quiet" data-action="close-modal">Keep editing</button><button class="button danger" data-action="confirm-reset">Load published library</button></div></div>`, '[data-action=close-modal]');
    } else if (action === 'confirm-reset') { await store.resetDraft(); modal.close(); navigate('#/all'); render(); toast('Published library loaded.'); }
  } catch (error) { if (error.name !== 'AbortError') toast(error.message || 'Please try again.'); }
  finally { if (button.isConnected) button.disabled = false; }
});

document.addEventListener('change', event => {
  if (event.target.id === 'show-empty-folders') { showEmptyFolders = event.target.checked; render(); $('#show-empty-folders')?.focus({ preventScroll: true }); }
  if (event.target.id === 'type-filter') { activeFilter = event.target.value; render(); }
  if (event.target.id === 'sort-select') { order = event.target.value; render(); }
  if (event.target.id === 'category-filter') { categoryFilter = event.target.value; render(); }
  if (event.target.id === 'tag-filter') { tagFilter = event.target.value; render(); }
});
document.addEventListener('input', event => {
  if (event.target.matches('[data-library-search]')) updateSearch(event.target);
  if (event.target.id === 'related-search') for (const label of modal.querySelectorAll('[data-related-title]')) label.hidden = !label.dataset.relatedTitle.includes(event.target.value.trim().toLowerCase());
});
document.addEventListener('focusin', event => {
  if (event.target.matches('[data-library-search]')) updateSearch(event.target);
});
document.addEventListener('focusout', event => {
  const surface = event.target.closest?.('.library-search-surface');
  if (surface && !surface.contains(event.relatedTarget)) closeSearch();
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest?.('.library-search-surface')) closeSearch();
});
$('#settings-button').addEventListener('click', () => { if (store) settings(); });
$('.skip-link').addEventListener('click', event => { event.preventDefault(); $('#main').focus(); });
$('#menu-button').innerHTML = icon('menu');
$('#search-icon').innerHTML = icon('search');
detail.addEventListener('close', () => {
  if (detail.open) return;
  pdfReader?.destroy();
  pdfReader = null;
  detail.classList.remove('has-pdf', 'has-image');
  for (const player of detail.querySelectorAll('video,audio')) player.pause();
  for (const frame of detail.querySelectorAll('iframe')) frame.remove();
});
detail.addEventListener('cancel', event => { event.preventDefault(); dismissDetail(); });
modal.addEventListener('close', () => {
  if (!store || modal.open) return;
  if (currentRoute().type === 'block' && !detail.open) {
    const block = byId('blocks', currentRoute().id);
    if (block) openDetail(block);
  } else if (currentRoute().type === 'explore') explorerView?.resumePreview();
});
for (const dialog of [modal, detail]) dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) { if (dialog === detail) dismissDetail(); else dialog.close(); } } });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !searchDropdown.hidden) {
    event.preventDefault();
    const input = searchInput;
    input?.focus();
    closeSearch();
    return;
  }
  if (event.key === 'Escape' && !modal.open && !detail.open) {
    const options = $('#view-options');
    if (options?.open) {
      try { if (event.target.closest('select')?.matches(':open')) return; } catch { /* Older select implementations handle their picker natively. */ }
      event.preventDefault();
      options.open = false;
      options.querySelector('summary').focus();
      return;
    }
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (store) focusSearch(); }
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !modal.open) { event.preventDefault(); if (store) focusSearch(); }
  if (store && event.key.toLowerCase() === 'n' && !event.metaKey && !event.ctrlKey && !event.altKey && !modal.open && !detail.open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) addMaterial();
});
window.addEventListener('hashchange', async () => { if (canvasView) await canvasView.flush(); activeFilter = 'all'; collectionTab = 'materials'; render(); });

function positionViewOptions(options) {
  if (!options?.open) return;
  const summary = $('summary', options), panel = $('.view-options-panel', options);
  if (!summary || !panel) return;
  const rect = summary.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom - 16, above = rect.top - 16;
  const flip = below < Math.min(panel.scrollHeight || 320, 600) && above > below;
  panel.dataset.side = flip ? 'above' : 'below';
  panel.style.top = flip ? 'auto' : 'calc(100% + 8px)';
  panel.style.bottom = flip ? 'calc(100% + 8px)' : 'auto';
  panel.style.maxHeight = `${Math.max(40, Math.min(600, flip ? above : below))}px`;
}
window.addEventListener('resize', () => positionViewOptions($('#view-options')));

document.addEventListener('toggle', event => {
  if (!event.target.matches('.view-options')) return;
  positionViewOptions(event.target);
  const panel = $('.view-options-panel', event.target);
  panel?.toggleAttribute('inert', !event.target.open);
  panel?.setAttribute('aria-hidden', String(!event.target.open));
  $('summary', event.target)?.setAttribute('aria-expanded', String(event.target.open));
}, true);

document.addEventListener('pointerdown', event => {
  const options = $('#view-options');
  if (options?.open && !options.contains(event.target)) options.open = false;
});

try {
  store = await LibraryStore.open();
  store.onStatus = renderSaveStatus;
  render();
} catch (error) {
  $('#content').innerHTML = `<div class="error-panel"><h1>Your library couldn’t open</h1><p>${escape(error.message)}</p><p>Run <code>npm run build</code> to generate the catalog, or <code>npm run dev</code> to open your local library.</p><button class="button" data-action="retry-load">Try again</button></div>`;
  document.addEventListener('click', event => { if (event.target.closest('[data-action=retry-load]')) location.reload(); });
}
