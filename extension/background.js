import { JellyRepository, safeSource, validateCapture, validateRepository } from './github.js';

const ready = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
let saveChain = Promise.resolve();
let readerChain = Promise.resolve();

function newDraft({ url, title = '', body = '', type = 'link', sourceTabId }) {
  return {
    operationId: crypto.randomUUID(),
    url,
    title: (title || new URL(url).hostname).slice(0, 500),
    sourceTitle: title.slice(0, 1000),
    body: body.slice(0, 30000),
    type,
    ...(Number.isInteger(sourceTabId) ? { sourceTabId } : {}),
    description: '',
    category: '',
    tags: [],
    capturedAt: new Date().toISOString()
  };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'jelly-save-page', title: 'Save page to Charta', contexts: ['page', 'link'] });
    chrome.contextMenus.create({ id: 'jelly-save-selection', title: 'Save selection to Charta', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'jelly-reader', title: 'Read and clip to Charta', contexts: ['page', 'selection'] });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await ready;
  if (info.menuItemId === 'jelly-reader') {
    try { await openReader({ sourceTabId: tab?.id }); }
    catch (error) {
      await chrome.storage.local.set({ readerError: error.message });
      await chrome.action.setBadgeText({ text: '!' });
      try { await chrome.action.openPopup(); } catch { /* The badge keeps the error discoverable. */ }
    }
    return;
  }
  const isSelection = info.menuItemId === 'jelly-save-selection';
  const url = safeSource(isSelection ? info.pageUrl || tab?.url : info.linkUrl || info.pageUrl || tab?.url);
  if (!url) return;
  const selection = isSelection ? info.selectionText || '' : '';
  const captureDraft = newDraft({ url, title: !isSelection && info.linkUrl ? url : tab?.title || url, body: selection, type: selection ? 'text' : 'link', sourceTabId: tab?.id });
  await chrome.storage.local.set({ captureDraft });
  try { await chrome.action.openPopup(); }
  catch {
    await chrome.action.setBadgeText({ text: '1' });
    await chrome.action.setBadgeBackgroundColor({ color: '#b64f36' });
  }
});

async function repository() {
  await ready;
  const [{ repositoryConfig }, { githubToken }] = await Promise.all([
    chrome.storage.local.get('repositoryConfig'),
    chrome.storage.session.get('githubToken')
  ]);
  return new JellyRepository(repositoryConfig, githubToken);
}

async function captureCurrent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!safeSource(tab?.url)) throw new Error('Open a normal webpage to capture it. Chrome internal pages cannot be captured.');
  let page;
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      const selected = window.getSelection()?.toString().trim() || '';
      const main = document.querySelector('article, main, [role="main"]');
      const description = document.querySelector('meta[name="description"]')?.content || '';
      return { title: document.title, url: location.href, body: (selected || main?.innerText || description).slice(0, 30000), selected: Boolean(selected) };
    } });
    page = results[0]?.result;
  } catch {
    // Some ordinary URLs (including Chrome's PDF viewer) prohibit scripting.
    page = { title: tab.title, url: tab.url, body: '', selected: false };
  }
  const captureDraft = newDraft({ url: page.url, title: page.title, body: page.body, type: page.selected ? 'text' : 'link', sourceTabId: tab.id });
  await chrome.storage.local.set({ captureDraft });
  await chrome.action.setBadgeText({ text: '' });
  return captureDraft;
}

function samePage(first, second) {
  if (!safeSource(first) || !safeSource(second)) return false;
  const a = new URL(first), b = new URL(second);
  a.hash = ''; b.hash = '';
  return a.href === b.href;
}

async function extractTab(tabId, { loadMore = false } = {}) {
  const tab = Number.isInteger(tabId) ? await chrome.tabs.get(tabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!safeSource(tab?.url)) throw new Error('Open an article or thread in a normal webpage to use reader mode.');
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['vendor/defuddle.js', 'capture.js'] });
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async options => ({ ...await globalThis.__jellyCapture.capture(options), documentUrl: location.href }),
    args: [{ mode: 'auto', loadMore }]
  });
  const page = results[0]?.result;
  if (!page || typeof page.markdown !== 'string' || !page.markdown.trim()) throw new Error('No readable article was found. Select the text you want and try reader mode again.');
  if (page.documentUrl && !samePage(page.documentUrl, tab.url)) throw new Error('The source page changed during capture. Try reader mode again.');
  return { page, tab };
}

async function getReader(captureId) {
  if (typeof captureId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(captureId)) throw new Error('This reader draft is invalid. Capture the page again.');
  const { readerDrafts = {} } = await chrome.storage.local.get('readerDrafts');
  if (!Object.hasOwn(readerDrafts, captureId)) throw new Error('This reader draft is no longer available. Capture the source page again.');
  return readerDrafts[captureId];
}

async function putReader(entry) {
  const { readerDrafts = {} } = await chrome.storage.local.get('readerDrafts');
  readerDrafts[entry.capture.operationId] = entry;
  // Retain every unsaved draft. Only completed readers are eligible for cleanup.
  const completed = Object.values(readerDrafts).filter(item => item.saved).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  for (const old of completed.slice(0, Math.max(0, Object.keys(readerDrafts).length - 12))) {
    if (old.capture.operationId !== entry.capture.operationId) delete readerDrafts[old.capture.operationId];
  }
  await chrome.storage.local.set({ readerDrafts });
}

function readerCapture(page, tab, previous) {
  const capture = {
    ...newDraft({ url: page.url, title: page.title || tab.title || page.url, sourceTabId: tab.id }),
    ...(previous ? { operationId: previous.operationId, title: previous.title || page.title || tab.title, category: previous.category, tags: previous.tags, description: previous.description } : {}),
    type: 'text', format: 'markdown', body: page.markdown,
    article: { author: page.author, published: page.published, description: page.description, wordCount: page.wordCount },
    extraction: page.extraction || { method: 'defuddle', kind: 'article', truncated: false }
  };
  return validateCapture(capture);
}

async function readerState(entry) {
  const { repositoryConfig } = await chrome.storage.local.get('repositoryConfig');
  const { githubToken } = await chrome.storage.session.get('githubToken');
  const state = { capture: entry.capture, collections: [], connected: false, repository: repositoryConfig || null, saved: entry.saved === true, bodyEdited: entry.bodyEdited === true, receipt: entry.receipt || null };
  if (repositoryConfig && githubToken) {
    try {
      const result = await (await repository()).collections();
      Object.assign(state, result, { connected: true });
    } catch (error) { state.connectionError = error.message; }
  }
  return state;
}

async function openReader({ capture, sourceTabId } = {}) {
  const tabId = sourceTabId ?? capture?.sourceTabId;
  if (capture?.url) {
    const tab = Number.isInteger(tabId) ? await chrome.tabs.get(tabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!samePage(tab?.url, capture.url)) throw new Error('Open the captured source page before switching to reader mode.');
  }
  const { page, tab } = await extractTab(tabId);
  const draft = readerCapture(page, tab);
  if (capture) {
    draft.category = capture.category || 'Uncategorized';
    draft.tags = capture.tags || [];
    draft.description = capture.description || '';
  }
  const entry = { capture: validateCapture(draft), sourceTabId: tab.id, sourceUrl: tab.url, updatedAt: new Date().toISOString(), saved: false };
  await putReader(entry);
  await chrome.tabs.create({ url: chrome.runtime.getURL(`reader.html?capture=${encodeURIComponent(draft.operationId)}`) });
  return { captureId: draft.operationId };
}

async function updateReader(input) {
  const entry = await getReader(input?.operationId);
  if (entry.saved) throw new Error('This clip is already saved. Capture the source again to make a new clip.');
  const capture = { ...entry.capture };
  for (const key of ['title', 'body', 'description', 'category', 'tags']) if (input[key] !== undefined) capture[key] = input[key];
  // An unfinished title or empty editor is still a recoverable draft; save validates it fully.
  const checked = validateCapture({ ...capture, title: capture.title || 'Untitled', type: 'link' });
  if (capture.body !== entry.capture.body) entry.bodyEdited = true;
  entry.capture = { ...checked, title: capture.title, type: 'text' };
  entry.updatedAt = new Date().toISOString();
  await putReader(entry);
  return entry.capture;
}

async function refreshReader(captureId, loadMore) {
  const entry = await getReader(captureId);
  let source;
  try { source = await chrome.tabs.get(entry.sourceTabId); }
  catch { throw new Error('The source tab is closed. Open the source and capture it again.'); }
  if (!samePage(source.url, entry.sourceUrl)) throw new Error('The source tab has navigated to another page. Open the original source and capture it again.');
  const { page, tab } = await extractTab(entry.sourceTabId, { loadMore: loadMore === true });
  const capture = readerCapture(page, tab, entry.saved ? undefined : entry.capture);
  const next = { capture, sourceTabId: tab.id, sourceUrl: tab.url, updatedAt: new Date().toISOString(), saved: false };
  await putReader(next);
  return readerState(next);
}

async function save(capture, destinationId) {
  capture = validateCapture(capture);
  const { pendingCaptures = [], repositoryConfig } = await chrome.storage.local.get(['pendingCaptures', 'repositoryConfig']);
  const config = validateRepository(repositoryConfig);
  const previous = pendingCaptures.find(item => item.capture.operationId === capture.operationId);
  if (previous?.repository && JSON.stringify(previous.repository) !== JSON.stringify(config)) {
    throw new Error(`This capture is queued for ${previous.repository.owner}/${previous.repository.repo} (${previous.repository.branch}). Reconnect that repository before retrying.`);
  }
  const pending = { capture, destinationId, repository: config, status: 'queued' };
  const queue = pendingCaptures.filter(item => item.capture.operationId !== capture.operationId);
  queue.push(pending);
  await chrome.storage.local.set({ pendingCaptures: queue, captureDraft: capture });
  try {
    const { githubToken } = await chrome.storage.session.get('githubToken');
    const client = new JellyRepository(config, githubToken);
    const result = await client.save(capture, destinationId);
    const current = await chrome.storage.local.get(['pendingCaptures', 'captureDraft']);
    await chrome.storage.local.set({
      pendingCaptures: (current.pendingCaptures || []).filter(item => item.capture.operationId !== capture.operationId),
      lastReceipt: { ...result, repository: config, title: capture.title, savedAt: new Date().toISOString() }
    });
    if (current.captureDraft?.operationId === capture.operationId) await chrome.storage.local.remove('captureDraft');
    return { ...result, repository: config };
  } catch (error) {
    const { pendingCaptures: current = [] } = await chrome.storage.local.get('pendingCaptures');
    await chrome.storage.local.set({ pendingCaptures: current.map(item => item.capture.operationId === capture.operationId ? { ...item, status: 'error', error: error.message } : item) });
    throw error;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const allowedPages = ['popup.html', 'reader.html'].map(file => chrome.runtime.getURL(file));
  const senderPage = typeof sender.url === 'string' ? sender.url.split(/[?#]/, 1)[0] : '';
  if (sender.id !== chrome.runtime.id || !allowedPages.includes(senderPage) || (sender.tab?.url && !sender.tab.url.startsWith(chrome.runtime.getURL('')))) return false;
  const run = async () => {
    await ready;
    if (message.type === 'capture') return captureCurrent();
    if (message.type.startsWith('reader-')) {
      const task = async () => {
        if (message.type === 'reader-open') return openReader(message);
        if (message.type === 'reader-init') return readerState(await getReader(message.captureId));
        if (message.type === 'reader-update') return updateReader(message.capture);
        if (message.type === 'reader-refresh') return refreshReader(message.captureId, message.loadMore);
        if (message.type === 'reader-save') {
          const existing = await getReader(message.capture?.operationId);
          if (existing.saved) return existing.receipt;
          const updated = await updateReader(message.capture);
          const next = saveChain.then(() => save(updated, message.destinationId));
          saveChain = next.catch(() => {});
          const result = await next;
          const entry = await getReader(updated.operationId);
          entry.saved = true; entry.receipt = result; entry.updatedAt = new Date().toISOString();
          await putReader(entry);
          return result;
        }
        throw new Error('Unsupported reader request.');
      };
      const next = readerChain.then(task);
      readerChain = next.catch(() => {});
      return next;
    }
    if (message.type === 'collections') return (await repository()).collections();
    if (message.type === 'connect') {
      const client = new JellyRepository(message.config, message.token);
      const result = await client.collections();
      await chrome.storage.local.set({ repositoryConfig: client.config });
      await chrome.storage.session.set({ githubToken: message.token });
      return result;
    }
    if (message.type === 'disconnect') {
      await chrome.storage.session.remove('githubToken');
      return true;
    }
    if (message.type === 'save') {
      const next = saveChain.then(() => save(message.capture, message.destinationId));
      saveChain = next.catch(() => {});
      return next;
    }
    throw new Error('Unsupported extension request.');
  };
  run().then(data => sendResponse({ ok: true, data }), error => sendResponse({ ok: false, error: error.message || 'The request failed. Your pending capture is kept.' }));
  return true;
});
