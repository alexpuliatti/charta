import { normalizeCaptureTaxonomy } from './github.js';

const $ = id => document.getElementById(id);
let capture = null;
let allCollections = [];
let selectedCollection = '';
let connected = false;
let busy = false;
let savedOperationId = '';

async function send(type, fields = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...fields });
  if (!response?.ok) throw new Error(response?.error || 'The extension disconnected. Reopen it to retry your capture.');
  return response.data;
}

function status(message, tone = '') {
  $('status').textContent = message;
  $('status').dataset.tone = tone;
}

function canSave() {
  $('save').disabled = busy || !connected || !capture || capture.operationId === savedOperationId;
}

function setBusy(value) {
  busy = value;
  const saved = Boolean(capture && capture.operationId === savedOperationId);
  for (const id of ['title', 'category', 'tags', 'note', 'body', 'search', 'collections']) $(id).disabled = busy || saved;
  for (const id of ['new-capture', 'refresh', 'settings-toggle', 'reader-mode']) $(id).disabled = busy;
  for (const button of $('pending-list').querySelectorAll('button')) button.disabled = busy;
  canSave();
}

function showSettings(show) {
  $('settings').hidden = !show;
  $('capture-section').hidden = show;
  $('settings-toggle').setAttribute('aria-expanded', String(show));
  $('settings-toggle').textContent = show ? 'Back' : 'Settings';
  if (show) $('owner').focus();
}

function renderCollections(preferredId) {
  const needle = $('search').value.toLocaleLowerCase();
  const previous = typeof preferredId === 'string' ? preferredId : selectedCollection;
  const options = [{ id: '', title: 'All materials', folder: '' }, ...allCollections.filter(item => `${item.title} ${item.folder}`.toLocaleLowerCase().includes(needle))];
  $('collections').replaceChildren(...options.map(item => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.folder ? `${item.title} · ${item.folder}` : item.title;
    return option;
  }));
  if (options.some(item => item.id === previous)) $('collections').value = previous;
  else if (options.length) $('collections').value = options[0].id;
  selectedCollection = $('collections').value;
  canSave();
}

function applyCollections(result) {
  allCollections = result.collections;
  selectedCollection = allCollections.some(item => item.id === selectedCollection) ? selectedCollection : '';
  connected = true;
  $('disconnect').hidden = false;
  renderCollections(selectedCollection);
}

function showCapture(value) {
  capture = value;
  savedOperationId = '';
  $('save').textContent = 'Save material ↗';
  $('title').value = value.title;
  $('category').value = value.category === undefined ? 'Uncategorized' : value.category;
  $('tags').value = Array.isArray(value.tags) ? value.tags.join(', ') : '';
  $('note').value = value.description;
  $('body').value = value.body;
  $('source').textContent = new URL(value.url).hostname + (value.type === 'text' ? ' · selected text' : ' · webpage');
  $('source').title = value.url;
  $('text-label').textContent = value.format === 'markdown' ? 'Markdown clip' : value.type === 'text' ? 'Selected text' : 'Captured text';
  $('commit-link').hidden = true;
  setBusy(busy);
}

async function renderPending() {
  const { pendingCaptures = [] } = await chrome.storage.local.get('pendingCaptures');
  $('pending').hidden = !pendingCaptures.length;
  $('pending-list').replaceChildren(...pendingCaptures.map(item => {
    const button = document.createElement('button');
    button.className = 'pending-item';
    button.type = 'button';
    button.textContent = `${item.status === 'error' ? 'Retry' : 'Resume'}: ${item.capture.title}`;
    button.addEventListener('click', async () => {
      selectedCollection = item.destinationId;
      $('search').value = '';
      showCapture(item.capture);
      const { repositoryConfig } = await chrome.storage.local.get('repositoryConfig');
      if (item.repository && JSON.stringify(repositoryConfig) !== JSON.stringify(item.repository)) {
        for (const key of ['owner', 'repo', 'branch']) $(key).value = item.repository[key];
        showSettings(true);
        status(`Reconnect ${item.repository.owner}/${item.repository.repo} to retry this capture.`);
        return;
      }
      renderCollections(item.destinationId);
      status(item.error || 'Capture saved locally.');
    });
    return button;
  }));
}

async function refresh() {
  status('Loading collections…');
  applyCollections(await send('collections'));
  status('');
}

$('settings-toggle').addEventListener('click', () => showSettings($('settings').hidden));
$('settings').addEventListener('submit', async event => {
  event.preventDefault();
  $('connect').disabled = true;
  status('Connecting…');
  try {
    let token = $('token').value.trim();
    if (!token) token = (await chrome.storage.session.get('githubToken')).githubToken || '';
    applyCollections(await send('connect', { config: { owner: $('owner').value.trim(), repo: $('repo').value.trim(), branch: $('branch').value.trim() }, token }));
    $('token').value = '';
    showSettings(false);
    status('Connected.', 'success');
  } catch (error) { status(error.message, 'error'); }
  finally { $('connect').disabled = false; }
});

$('disconnect').addEventListener('click', async () => {
  await send('disconnect');
  connected = false;
  $('disconnect').hidden = true;
  allCollections = [];
  renderCollections();
  status('Disconnected. Your pending captures are kept.');
});

$('search').addEventListener('input', renderCollections);
$('collections').addEventListener('change', () => { selectedCollection = $('collections').value; canSave(); });
$('refresh').addEventListener('click', () => refresh().catch(error => status(error.message, 'error')));
$('new-capture').addEventListener('click', async () => {
  try { showCapture(await send('capture')); status('Page captured.'); }
  catch (error) { status(error.message, 'error'); }
});

$('reader-mode').addEventListener('click', async () => {
  setBusy(true);
  status('Extracting…');
  try {
    const current = capture ? readCaptureFields() : undefined;
    if (current) await chrome.storage.local.set({ captureDraft: current });
    await send('reader-open', { capture: current });
    window.close();
  } catch (error) { status(error.message, 'error'); }
  finally { setBusy(false); }
});

function readCaptureFields() {
  return {
    ...capture,
    title: $('title').value,
    category: $('category').value,
    tags: $('tags').value.split(',').map(tag => tag.trim()).filter(Boolean),
    description: $('note').value,
    body: $('body').value
  };
}

for (const id of ['title', 'category', 'tags', 'note', 'body']) $(id).addEventListener('input', async () => {
  if (!capture) return;
  capture = readCaptureFields();
  await chrome.storage.local.set({ captureDraft: capture });
});

$('save-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!capture || busy) return;
  try {
    if (!$('category').value.trim()) throw new Error('Choose a category.');
    capture = normalizeCaptureTaxonomy(readCaptureFields());
    if (!capture.tags.length) throw new Error('Add at least one tag.');
  } catch (error) {
    status(error.message, 'error');
    return;
  }
  setBusy(true);
  $('save').textContent = 'Saving to GitHub…';
  status('Capture queued locally.');
  try {
    const result = await send('save', { capture, destinationId: $('collections').value });
    $('commit-link').href = `https://github.com/${encodeURIComponent(result.repository.owner)}/${encodeURIComponent(result.repository.repo)}/commit/${result.commit}`;
    $('commit-link').hidden = false;
    savedOperationId = capture.operationId;
    status(result.alreadySaved ? 'Already saved to GitHub. Pages updates after deployment.' : 'Saved to GitHub. Pages updates after deployment.', 'success');
    $('save').textContent = 'Saved to GitHub ✓';
    await renderPending();
  } catch (error) {
    status(error.message, 'error');
    $('save').textContent = 'Retry save ↗';
    await renderPending();
  } finally {
    setBusy(false);
  }
});

document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !$('save').disabled && !$('capture-section').hidden) $('save-form').requestSubmit();
});

async function init() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const [{ repositoryConfig, captureDraft, readerError }, { githubToken }] = await Promise.all([
    chrome.storage.local.get(['repositoryConfig', 'captureDraft', 'readerError']),
    chrome.storage.session.get('githubToken')
  ]);
  if (repositoryConfig) for (const key of ['owner', 'repo', 'branch']) $(key).value = repositoryConfig[key];
  try { showCapture(captureDraft || await send('capture')); }
  catch (error) { $('source').textContent = 'No page captured'; status(error.message, 'error'); }
  await renderPending();
  if (repositoryConfig && githubToken) {
    try { await refresh(); }
    catch (error) { status(error.message, 'error'); showSettings(true); }
  } else {
    status(repositoryConfig ? 'Reconnect in Settings to save to GitHub.' : 'Connect GitHub in Settings to save.');
  }
  if (location.hash === '#settings') showSettings(true);
  if (readerError) {
    status(readerError, 'error');
    await chrome.storage.local.remove('readerError');
    await chrome.action.setBadgeText({ text: '' });
  }
}

init().catch(error => status(error.message, 'error'));
