import { normalizeCaptureTaxonomy } from './github.js';
import { serializeMarkdown } from './markdown.js';
import { renderMarkdown, safeReaderUrl } from './reader-render.js';

const $ = id => document.getElementById(id);
const captureId = new URL(location.href).searchParams.get('capture');
let capture = null;
let collections = [];
let connected = false;
let busy = false;
let saved = false;
let bodyEdited = false;
let selectedCollection = '';
let draftVersion = 0;
let persistedVersion = 0;
let persistTimer;
let persistQueue = Promise.resolve();

async function send(type, fields = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...fields });
  if (!response?.ok) throw new Error(response?.error || 'The extension disconnected. Reopen Charta to try again.');
  return response.data;
}

function showDetails(show) {
  $('metadata').hidden = !show;
  $('workspace').classList.toggle('details-hidden', !show);
  $('details-toggle').setAttribute('aria-expanded', String(show));
}

function status(message, tone = '') {
  $('status').textContent = message;
  $('status').dataset.tone = tone;
  if (tone === 'error') showDetails(true);
}

function draftStatus(message, tone = '') {
  $('draft-status').textContent = message;
  $('draft-status').dataset.tone = tone;
}

function setBusy(value) {
  busy = value;
  for (const id of ['title', 'category', 'tags', 'note', 'body', 'collection-search', 'collections']) $(id).disabled = value || saved;
  $('refresh').disabled = value || saved;
  $('load-more').disabled = value || saved;
  $('download').disabled = value || !capture;
  $('save').disabled = value || saved || !capture || !connected;
  $('reader').setAttribute('aria-busy', String(value));
}

function readFields() {
  return {
    ...capture,
    title: $('title').value,
    category: $('category').value,
    tags: $('tags').value.split(',').map(tag => tag.trim()).filter(Boolean),
    description: $('note').value,
    body: $('body').value,
    format: 'markdown',
    type: 'text'
  };
}

// Serialize draft writes so a slower earlier request cannot overwrite a later edit.
function persistDraft() {
  clearTimeout(persistTimer);
  if (!capture || saved || persistedVersion === draftVersion) return persistQueue;
  const snapshot = structuredClone(readFields());
  const version = draftVersion;
  draftStatus('Saving draft…');
  const task = persistQueue.catch(() => {}).then(() => send('reader-update', { capture: snapshot }));
  persistQueue = task.then(() => {
    persistedVersion = Math.max(persistedVersion, version);
    if (draftVersion === version) draftStatus('Draft saved locally.');
  }).catch(error => {
    draftStatus(`Draft could not be saved: ${error.message}`, 'error');
    throw error;
  });
  // Input handlers intentionally don't await; retain a handler for their failures.
  persistQueue.catch(() => {});
  return persistQueue;
}

function switchView(view, focus = false) {
  const read = view === 'read';
  $('read-panel').hidden = !read;
  $('markdown-panel').hidden = read;
  for (const name of ['read', 'markdown']) {
    const active = name === view;
    $(`${name}-tab`).setAttribute('aria-selected', String(active));
    $(`${name}-tab`).tabIndex = active ? 0 : -1;
  }
  if (read && capture) {
    try { renderMarkdown($('body').value, $('article-body'), { baseUrl: capture.url }); }
    catch (error) { status(error.message, 'error'); switchView('markdown', focus); return; }
  }
  if (focus) $(`${view}-tab`).focus();
}

function articleMetadata(value) {
  const metadata = value.article || {};
  const extraction = value.extraction || {};
  const words = Number(metadata.wordCount);
  const count = Number(extraction.loadedPostCount);
  $('capture-kind').textContent = extraction.kind === 'thread'
    ? `Thread${Number.isInteger(count) && count > 0 ? ` · ${count} captured ${count === 1 ? 'post' : 'posts'}` : ' · loaded posts'}`
    : extraction.kind === 'selection' ? 'Selected text' : 'Article';
  const author = Array.isArray(metadata.author) ? metadata.author.filter(item => typeof item === 'string').join(', ') : metadata.author;
  const parts = typeof author === 'string' && author.trim() ? [author.trim()] : [];
  if (metadata.published) {
    const date = new Date(metadata.published);
    if (!Number.isNaN(date.valueOf())) parts.push(date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }));
  }
  if (Number.isFinite(words) && words > 0) parts.push(`${Math.ceil(words / 220)} min read`);
  $('byline').textContent = parts.join(' · ');
  $('byline').hidden = !parts.length;
  const warnings = [];
  const providedWarnings = [extraction.warning, ...(Array.isArray(extraction.warnings) ? extraction.warnings : [])];
  for (const warning of providedWarnings) if (typeof warning === 'string' && warning.trim() && !warnings.includes(warning.trim())) warnings.push(warning.trim());
  if (extraction.kind === 'thread' && !warnings.length) warnings.push('This capture contains the posts loaded on the page. A longer thread may have more posts to load.');
  if (extraction.truncated && !warnings.some(warning => /limit|truncat|partial/i.test(warning))) warnings.push('The extractor reported a partial capture. Review the Markdown before saving.');
  $('capture-warning').textContent = warnings.join('\n');
  $('capture-warning').hidden = !warnings.length;
  $('thread-actions').hidden = extraction.kind !== 'thread' || extraction.canLoadMore === false;
}

function updateHeading() {
  $('article-title').textContent = $('title').value.trim() || 'Untitled article';
  document.title = `${$('title').value.trim() || 'Reader'} · Charta`;
}

function renderCollections(preferredId) {
  const previous = typeof preferredId === 'string' ? preferredId : selectedCollection;
  const needle = $('collection-search').value.trim().toLocaleLowerCase();
  const matches = collections.filter(item => `${item.title || ''} ${item.folder || ''}`.toLocaleLowerCase().includes(needle));
  const available = [{ id: '', title: 'All materials', folder: '' }, ...matches];
  $('collections').replaceChildren(...available.map(item => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.folder ? `${item.title} · ${item.folder}` : item.title;
    return option;
  }));
  if (available.some(item => item.id === previous)) $('collections').value = previous;
  else if (available.length) $('collections').value = available[0].id;
  selectedCollection = $('collections').value;
  $('collections-help').textContent = !connected
    ? 'Reload after connecting in Settings.'
    : needle && !matches.length ? 'No matching collections.' : '';
  $('collections-help').hidden = !$('collections-help').textContent;
  setBusy(busy);
}

function applyConnection(result) {
  const listing = result.collections;
  collections = Array.isArray(listing) ? listing : Array.isArray(listing?.collections) ? listing.collections : [];
  connected = Boolean(result.connected);
  $('connection').hidden = connected;
  $('connection-message').textContent = typeof result.connectionError === 'string' && result.connectionError
    ? `Could not load repository: ${result.connectionError}`
    : 'Connect GitHub to save.';
  const preferred = selectedCollection || result.destinationId || '';
  renderCollections(preferred);
}

function showCapture(value) {
  if (!value || typeof value.body !== 'string' || typeof value.operationId !== 'string') throw new Error('This reader capture is unavailable. Open a webpage and choose Reader mode from Charta again.');
  capture = value;
  $('title').value = typeof value.title === 'string' ? value.title : '';
  $('category').value = value.category === undefined ? 'Uncategorized' : value.category;
  $('tags').value = Array.isArray(value.tags) ? value.tags.join(', ') : '';
  $('note').value = typeof value.description === 'string' ? value.description : '';
  $('body').value = value.body;
  const source = safeReaderUrl(value.url);
  $('source').textContent = source ? new URL(source).hostname.replace(/^www\./, '') + ' ↗' : 'Source unavailable';
  $('source').title = source || '';
  if (source) $('source').href = source;
  else $('source').removeAttribute('href');
  updateHeading();
  articleMetadata(value);
  $('empty').hidden = true;
  $('workspace').hidden = false;
  switchView($('markdown-tab').getAttribute('aria-selected') === 'true' ? 'markdown' : 'read');
  setBusy(busy);
}

function showError(message) {
  $('empty').hidden = false;
  $('workspace').hidden = true;
  $('empty-title').textContent = 'This capture could not open';
  $('empty-message').textContent = message;
  $('empty-message').hidden = false;
  $('empty-settings').hidden = false;
  $('reader').setAttribute('aria-busy', 'false');
}

function showReceipt(result, alreadySaved = false) {
  saved = true;
  $('save').textContent = 'Saved to Charta ✓';
  draftStatus('');
  status(alreadySaved ? 'Already saved to GitHub.' : 'Saved to GitHub. Pages updates after deployment.', 'success');
  const repository = result?.repository;
  if (repository?.owner && repository?.repo && result.commit) {
    $('commit-link').href = `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/commit/${encodeURIComponent(result.commit)}`;
    $('commit-link').hidden = false;
  }
}

for (const id of ['title', 'category', 'tags', 'note', 'body']) $(id).addEventListener('input', () => {
  if (!capture || busy || saved) return;
  capture = readFields();
  if (id === 'title') updateHeading();
  if (id === 'body') bodyEdited = true;
  draftVersion++;
  draftStatus('Unsaved changes…');
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { persistDraft().catch(() => {}); }, 350);
});

$('read-tab').addEventListener('click', () => switchView('read'));
$('markdown-tab').addEventListener('click', () => switchView('markdown'));
for (const id of ['read-tab', 'markdown-tab']) $(id).addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  switchView(event.key === 'Home' ? 'read' : event.key === 'End' ? 'markdown' : id === 'read-tab' ? 'markdown' : 'read', true);
});
$('details-toggle').addEventListener('click', () => showDetails($('metadata').hidden));
$('details-close').addEventListener('click', () => { showDetails(false); $('details-toggle').focus(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('metadata').hidden && globalThis.matchMedia?.('(max-width: 760px)').matches) {
    showDetails(false);
    $('details-toggle').focus();
  }
});
$('collection-search').addEventListener('input', () => renderCollections());
$('collections').addEventListener('change', () => { selectedCollection = $('collections').value; setBusy(busy); });

$('save-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!capture || busy || saved || !connected) return;
  try {
    if (!$('title').value.trim()) throw new Error('Add a title.');
    if (!$('category').value.trim()) throw new Error('Choose a category.');
    capture = normalizeCaptureTaxonomy(readFields());
    if (!capture.tags.length) throw new Error('Add at least one tag.');
    if (!capture.body.trim()) throw new Error('The Markdown is empty. Reload the page content or add text before saving.');
    // Reflect the same normalization that the archive will receive.
    $('category').value = capture.category;
    $('tags').value = capture.tags.join(', ');
    draftVersion++;
    setBusy(true);
    $('save').textContent = 'Saving to GitHub…';
    status('Saving to GitHub…');
    await persistDraft();
    const result = await send('reader-save', { capture, destinationId: $('collections').value });
    showReceipt(result, result.alreadySaved);
  } catch (error) {
    status(error.message, 'error');
    $('save').textContent = 'Retry save ↗';
  } finally { setBusy(false); }
});

$('download').addEventListener('click', () => {
  if (!capture || busy) return;
  try {
    const value = normalizeCaptureTaxonomy(readFields());
    value.title = value.title.trim();
    $('category').value = value.category;
    $('tags').value = value.tags.join(', ');
    const blob = new Blob([serializeMarkdown(value)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(value.title || 'Charta article').normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim().slice(0, 120) || 'Charta article'}.md`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('Markdown downloaded.');
  } catch (error) { status(error.message, 'error'); }
});

async function refreshCapture(loadMore = false) {
  if (!capture || busy || saved) return;
  if (bodyEdited && !confirm('Reloading the original page content will replace your edited Markdown. Your title, tags, category, and note will stay. Continue?')) return;
  const metadata = readFields();
  setBusy(true);
  status(loadMore ? 'Loading more posts…' : 'Reloading page content…');
  try {
    await persistDraft();
    const result = await send('reader-refresh', { captureId, ...(loadMore ? { loadMore: true } : {}) });
    const refreshed = result.capture;
    if (!refreshed?.body?.trim()) throw new Error('No readable text was returned. Your previous draft is still here.');
    const value = { ...refreshed, title: metadata.title, category: metadata.category, tags: metadata.tags, description: metadata.description };
    showCapture(value);
    applyConnection(result);
    bodyEdited = false;
    draftVersion++;
    await persistDraft();
    status('Page content reloaded.');
  } catch (error) { status(error.message, 'error'); }
  finally { setBusy(false); }
}
$('refresh').addEventListener('click', () => refreshCapture());
$('load-more').addEventListener('click', () => refreshCapture(true));

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistDraft().catch(() => {}); });
window.addEventListener('pagehide', () => { persistDraft().catch(() => {}); });

async function init() {
  const settings = chrome.runtime.getURL('popup.html#settings');
  for (const id of ['settings-home', 'settings', 'empty-settings']) $(id).href = settings;
  if (!captureId) {
    showError('No capture was selected. Open an article or thread, then choose Reader mode from the Charta extension.');
    return;
  }
  try {
    const result = await send('reader-init', { captureId });
    bodyEdited = result.bodyEdited === true;
    showCapture(result.capture);
    applyConnection(result);
    if (globalThis.matchMedia?.('(max-width: 760px)').matches) showDetails(false);
    if (result.saved) showReceipt(result.receipt || {}, true);
    else {
      draftStatus('Draft saved locally.');

    }
  } catch (error) { showError(error.message); }
  finally { setBusy(false); }
}

init();
