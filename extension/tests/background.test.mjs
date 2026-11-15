import test from 'node:test';
import assert from 'node:assert/strict';
import { JellyRepository } from '../github.js';

const extensionId = 'jelly-test-extension';
const extensionUrl = `chrome-extension://${extensionId}/`;
const sourceTab = { id: 17, url: 'https://example.com/article', title: 'An article' };
let workerSequence = 0;

function storageArea(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) {
      if (keys == null) return structuredClone(data);
      if (typeof keys === 'string') return { [keys]: structuredClone(data[keys]) };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map(key => [key, structuredClone(data[key])]));
      return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, structuredClone(data[key] ?? fallback)]));
    },
    async set(items) { Object.assign(data, structuredClone(items)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
    async setAccessLevel() {}
  };
}

async function loadWorker(t, { local = {}, session = {}, tab = sourceTab, extraction } = {}) {
  const messages = [];
  const calls = { scripts: [], queriedTabs: [], createdTabs: [], requestedTabs: [], badges: [] };
  const localStorage = storageArea(local);
  const sessionStorage = storageArea(session);
  let activeTab = structuredClone(tab);
  const chromeMock = {
    runtime: {
      id: extensionId,
      getURL: path => extensionUrl + path,
      onInstalled: { addListener() {} },
      onMessage: { addListener(listener) { messages.push(listener); } }
    },
    storage: { local: localStorage, session: sessionStorage },
    contextMenus: { onClicked: { addListener() {} }, removeAll(callback) { callback(); }, create() {} },
    tabs: {
      async query(options) { calls.queriedTabs.push(options); return [structuredClone(activeTab)]; },
      async get(id) { calls.requestedTabs.push(id); return structuredClone(activeTab); },
      async create(options) { calls.createdTabs.push(options); return { id: 25, ...options }; },
      async update(id, options) { return { id, ...options }; }
    },
    scripting: {
      async executeScript(options) {
        calls.scripts.push(options);
        if (options.files) return [{ result: undefined }];
        return [{ result: structuredClone(extraction || {
          title: 'An article', url: sourceTab.url, documentUrl: sourceTab.url, body: '## Extracted article\n\nText with a [link](https://example.com).',
          markdown: '## Extracted article\n\nText with a [link](https://example.com).',
          selected: false, author: 'Writer', site: 'Example', published: '2026-11-14',
          description: 'Article description', wordCount: 12,
          extraction: { method: 'defuddle', kind: 'article', truncated: false }
        }) }];
      }
    },
    action: {
      async setBadgeText(value) { calls.badges.push(value); },
      async setBadgeBackgroundColor() {}, async openPopup() {}
    }
  };
  const previousChrome = globalThis.chrome;
  globalThis.chrome = chromeMock;
  t.after(() => { globalThis.chrome = previousChrome; });
  await import(`../background.js?worker-test=${++workerSequence}`);
  assert.equal(messages.length, 1, 'the worker registers one message boundary');
  const send = (message, sender = { id: extensionId, url: extensionUrl + 'popup.html' }) => new Promise((resolve, reject) => {
    let timeout;
    const respond = response => { clearTimeout(timeout); resolve(response); };
    const handled = messages[0](message, sender, respond);
    if (handled !== true) resolve({ handled: false });
    else {
      // A handler which claims the channel must eventually respond.
      timeout = setTimeout(() => reject(new Error('Worker did not respond.')), 2000);
      timeout.unref();
    }
  });
  return { send, calls, local: localStorage.data, session: sessionStorage.data, setTab(next) { activeTab = structuredClone(next); } };
}

test('only Jelly extension pages can invoke privileged worker requests', async t => {
  const worker = await loadWorker(t, { session: { githubToken: 'test-session-token' } });
  const blocked = [
    { id: extensionId, url: sourceTab.url, tab: sourceTab },
    { id: extensionId, url: extensionUrl + 'popup.html', tab: sourceTab },
    { id: 'another-extension', url: extensionUrl + 'popup.html' },
    { id: extensionId, url: 'https://example.com/popup.html' },
    { id: extensionId, url: extensionUrl + 'untrusted.html' },
    { id: extensionId, url: extensionUrl + 'popup.html.evil' }
  ];
  for (const sender of blocked) {
    assert.deepEqual(await worker.send({ type: 'disconnect' }, sender), { handled: false });
    assert.equal(worker.session.githubToken, 'test-session-token');
  }
  const result = await worker.send({ type: 'disconnect' }, { id: extensionId, url: extensionUrl + 'popup.html#settings' });
  assert.equal(result.ok, true);
  assert.equal(worker.session.githubToken, undefined);
});

test('content script sender cannot capture even when it has Jelly extension ID', async t => {
  const worker = await loadWorker(t);
  const result = await worker.send({ type: 'capture' }, { id: extensionId, url: sourceTab.url, tab: sourceTab });
  assert.deepEqual(result, { handled: false });
  assert.equal(worker.calls.scripts.length, 0);
  assert.equal(worker.calls.queriedTabs.length, 0);
  assert.equal(worker.local.captureDraft, undefined);
});

test('worker rejects Chrome internal pages before attempting extraction', async t => {
  const worker = await loadWorker(t, { tab: { id: 3, url: 'chrome://extensions', title: 'Extensions' } });
  const result = await worker.send({ type: 'capture' });
  assert.equal(result.ok, false);
  assert.match(result.error, /normal webpage|ordinary|Chrome internal/i);
  assert.equal(worker.calls.scripts.length, 0);
});

test('reader captures the active tab with local scripts and initializes without GitHub setup', async t => {
  const worker = await loadWorker(t);
  const opened = await worker.send({ type: 'reader-open' });
  assert.equal(opened.ok, true);
  const { captureId } = opened.data;
  assert.match(captureId, /^[A-Za-z0-9_-]{8,80}$/);
  assert.deepEqual(worker.calls.queriedTabs, [{ active: true, currentWindow: true }]);
  assert.equal(worker.calls.scripts.length, 2);
  assert.deepEqual(worker.calls.scripts[0], { target: { tabId: sourceTab.id }, files: ['vendor/defuddle.js', 'capture.js'] });
  assert.deepEqual(worker.calls.scripts[1].target, { tabId: sourceTab.id });
  assert.equal(typeof worker.calls.scripts[1].func, 'function');
  assert.deepEqual(worker.calls.scripts[1].args, [{ mode: 'auto', loadMore: false }]);
  assert.equal(worker.calls.createdTabs.length, 1);
  const readerUrl = extensionUrl + `reader.html?capture=${captureId}`;
  assert.equal(worker.calls.createdTabs[0].url, readerUrl);
  const initial = await worker.send({ type: 'reader-init', captureId }, {
    id: extensionId, url: readerUrl, tab: { id: 25, url: readerUrl }
  });
  assert.equal(initial.ok, true, 'a reader extension page is trusted even though it runs in a browser tab');
  assert.equal(initial.data.capture.operationId, captureId);
  assert.equal(initial.data.capture.format, 'markdown');
  assert.match(initial.data.capture.body, /## Extracted article/);
  assert.deepEqual(initial.data.collections, []);
  assert.equal(initial.data.connected, false);
  assert.equal(initial.data.repository, null);
  assert.equal(initial.data.saved, false);
  assert.equal(initial.data.receipt, null);
  assert.equal(worker.local.readerDrafts[captureId].capture.operationId, captureId);
});

test('reader edits persist while source provenance remains fixed', async t => {
  const worker = await loadWorker(t);
  const opened = await worker.send({ type: 'reader-open' });
  const captureId = opened.data.captureId;
  const original = structuredClone(worker.local.readerDrafts[captureId].capture);
  const edited = {
    ...original, title: 'My edited title', body: '# My Markdown\n\nAn edited paragraph.', description: 'Why I saved this.',
    category: '  Reading  ', tags: ['  Design ', 'design'],
    url: 'https://unrelated.example/new-source', sourceTitle: 'Replaced source', capturedAt: '2000-01-01',
    extraction: { method: 'forged' }, sourceTabId: 900, type: 'link', format: 'html'
  };
  const updated = await worker.send({ type: 'reader-update', capture: edited });
  assert.equal(updated.ok, true);
  assert.equal(updated.data.title, edited.title);
  assert.equal(updated.data.body, edited.body);
  assert.equal(updated.data.description, edited.description);
  assert.equal(updated.data.category, 'Reading');
  assert.deepEqual(updated.data.tags, ['design']);
  for (const key of ['url', 'sourceTitle', 'capturedAt', 'extraction', 'sourceTabId', 'type', 'format']) {
    assert.deepEqual(updated.data[key], original[key], `editing must preserve ${key}`);
  }
  const reopened = await worker.send({ type: 'reader-init', captureId });
  assert.deepEqual(reopened.data.capture, updated.data);
  assert.equal(reopened.data.bodyEdited, true, 'reopening keeps the replacement warning for edited Markdown');
  assert.deepEqual(worker.local.readerDrafts[captureId].capture, updated.data);
});

test('reader drafts remain available after a worker restart with no repository configured', async t => {
  const firstWorker = await loadWorker(t);
  const opened = await firstWorker.send({ type: 'reader-open' });
  const captureId = opened.data.captureId;
  const capture = { ...firstWorker.local.readerDrafts[captureId].capture, body: '# Kept after restart\n\nMy edit.' };
  await firstWorker.send({ type: 'reader-update', capture });
  const restarted = await loadWorker(t, { local: firstWorker.local });
  const initial = await restarted.send({ type: 'reader-init', captureId });
  assert.equal(initial.ok, true);
  assert.equal(initial.data.capture.body, capture.body);
  assert.equal(initial.data.connected, false);
  assert.equal(initial.data.repository, null);
  assert.equal(restarted.calls.scripts.length, 0, 'restoring a reader must use its persisted draft');
  assert.equal(restarted.calls.queriedTabs.length, 0);
});

test('a page which changes during extraction cannot create a reader for the wrong source', async t => {
  const worker = await loadWorker(t, { extraction: {
    title: 'Unexpected page', url: 'https://other.example/page', documentUrl: 'https://other.example/page', markdown: '# Different source',
    extraction: { method: 'defuddle', kind: 'article' }
  } });
  const opened = await worker.send({ type: 'reader-open' });
  assert.equal(opened.ok, false);
  assert.match(opened.error, /changed during capture/i);
  assert.equal(worker.calls.createdTabs.length, 0);
  assert.equal(worker.local.readerDrafts, undefined);
});

test('canonical source URLs can differ while refresh still uses the original source tab', async t => {
  const canonical = 'https://example.com/canonical-article';
  const worker = await loadWorker(t, { extraction: {
    title: 'Canonical article', url: canonical, documentUrl: sourceTab.url,
    markdown: '# Canonical article\n\nArticle text.', extraction: { method: 'defuddle', kind: 'article' }
  } });
  const opened = await worker.send({ type: 'reader-open' });
  assert.equal(opened.ok, true);
  const captureId = opened.data.captureId;
  assert.equal(worker.local.readerDrafts[captureId].capture.url, canonical);
  assert.equal(worker.local.readerDrafts[captureId].sourceUrl, sourceTab.url);
  const refreshed = await worker.send({ type: 'reader-refresh', captureId });
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.data.capture.url, canonical);
  assert.equal(worker.local.readerDrafts[captureId].sourceUrl, sourceTab.url);
  assert.equal(worker.calls.queriedTabs.length, 1);
  assert.deepEqual(worker.calls.scripts.at(-1).target, { tabId: sourceTab.id });
});

test('refresh refuses a source tab which navigated without replacing the draft', async t => {
  const worker = await loadWorker(t);
  const opened = await worker.send({ type: 'reader-open' });
  const captureId = opened.data.captureId;
  const original = structuredClone(worker.local.readerDrafts[captureId]);
  worker.setTab({ ...sourceTab, url: 'https://example.com/a-different-article' });
  const scriptCount = worker.calls.scripts.length;
  const refreshed = await worker.send({ type: 'reader-refresh', captureId, loadMore: true });
  assert.equal(refreshed.ok, false);
  assert.match(refreshed.error, /navigated|original source/i);
  assert.equal(worker.calls.scripts.length, scriptCount, 'a different page must not receive extraction scripts');
  assert.deepEqual(worker.local.readerDrafts[captureId], original);
});

test('reader refresh targets its original tab and preserves annotation edits', async t => {
  const worker = await loadWorker(t);
  const opened = await worker.send({ type: 'reader-open' });
  const captureId = opened.data.captureId;
  const capture = worker.local.readerDrafts[captureId].capture;
  await worker.send({ type: 'reader-update', capture: { ...capture, title: 'My retained title', description: 'Keep my note', category: 'Reading', tags: ['systems'] } });
  worker.setTab({ ...sourceTab, url: sourceTab.url + '#later-section' });
  const refreshed = await worker.send({ type: 'reader-refresh', captureId, loadMore: true });
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.data.capture.operationId, captureId);
  assert.equal(refreshed.data.capture.title, 'My retained title');
  assert.equal(refreshed.data.capture.description, 'Keep my note');
  assert.equal(refreshed.data.capture.category, 'Reading');
  assert.deepEqual(refreshed.data.capture.tags, ['systems']);
  assert.deepEqual(worker.calls.scripts.at(-1).target, { tabId: sourceTab.id });
  assert.deepEqual(worker.calls.scripts.at(-1).args, [{ mode: 'auto', loadMore: true }]);
  assert.equal(worker.calls.queriedTabs.length, 1, 'refresh uses the original tab rather than the active reader tab');
});

test('simultaneous reader captures and edits retain both unsaved drafts', async t => {
  const worker = await loadWorker(t);
  const opened = await Promise.all([worker.send({ type: 'reader-open' }), worker.send({ type: 'reader-open' })]);
  assert.ok(opened.every(result => result.ok));
  const ids = opened.map(result => result.data.captureId);
  assert.notEqual(ids[0], ids[1]);
  assert.deepEqual(Object.keys(worker.local.readerDrafts).sort(), [...ids].sort());
  const updates = await Promise.all(ids.map((id, index) => worker.send({
    type: 'reader-update', capture: { ...worker.local.readerDrafts[id].capture, title: `Edited draft ${index}` }
  })));
  assert.ok(updates.every(result => result.ok));
  for (let index = 0; index < ids.length; index++) {
    assert.equal(worker.local.readerDrafts[ids[index]].capture.title, `Edited draft ${index}`);
  }
});

test('reader save commits the edited draft and retains a receipt across reopening', async t => {
  const worker = await loadWorker(t);
  const opened = await worker.send({ type: 'reader-open' });
  const captureId = opened.data.captureId;
  worker.local.repositoryConfig = { owner: 'example', repo: 'Jelly', branch: 'main' };
  worker.session.githubToken = 'test-session-token';
  const originalSave = JellyRepository.prototype.save;
  const originalCollections = JellyRepository.prototype.collections;
  let received;
  JellyRepository.prototype.save = async function(capture, destinationId) {
    received = { capture, destinationId };
    return { commit: 'commit-reader', blockId: `b_${capture.operationId}`, collectionId: destinationId, alreadySaved: false };
  };
  JellyRepository.prototype.collections = async () => ({ collections: [{ id: 'c_reading', title: 'Reading' }], inboxId: 'c_reading' });
  t.after(() => {
    JellyRepository.prototype.save = originalSave;
    JellyRepository.prototype.collections = originalCollections;
  });
  const capture = { ...worker.local.readerDrafts[captureId].capture, title: 'Edited before save', body: '# Edited article\n\nArchive this text.' };
  const saved = await worker.send({ type: 'reader-save', capture, destinationId: 'c_reading' });
  assert.equal(saved.ok, true);
  assert.equal(received.capture.body, capture.body);
  assert.equal(received.capture.title, capture.title);
  assert.equal(received.destinationId, 'c_reading');
  assert.equal(worker.local.pendingCaptures.length, 0);
  assert.equal(worker.local.readerDrafts[captureId].saved, true);
  const reopened = await worker.send({ type: 'reader-init', captureId });
  assert.equal(reopened.data.saved, true);
  assert.equal(reopened.data.receipt.blockId, `b_${captureId}`);
  assert.equal(reopened.data.capture.body, capture.body);
  const changed = await worker.send({ type: 'reader-update', capture: { ...capture, title: 'Attempted overwrite' } });
  assert.equal(changed.ok, false);
  assert.match(changed.error, /already saved/i);
});

test('a failed save retains its draft and does not block the next queued save', async t => {
  const config = { owner: 'example', repo: 'Jelly', branch: 'main' };
  const worker = await loadWorker(t, { local: { repositoryConfig: config }, session: { githubToken: 'test-session-token' } });
  const originalSave = JellyRepository.prototype.save;
  const committed = [];
  let releaseFirst;
  let firstStarted;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const started = new Promise(resolve => { firstStarted = resolve; });
  JellyRepository.prototype.save = async function(capture) {
    committed.push(capture.operationId);
    if (committed.length === 1) {
      firstStarted();
      await firstGate;
      throw new Error('Simulated offline save');
    }
    return { commit: 'commit-second', blockId: `b_${capture.operationId}`, collectionId: 'c_inbox', alreadySaved: false };
  };
  t.after(() => { JellyRepository.prototype.save = originalSave; });
  const makeCapture = operationId => ({
    operationId, url: sourceTab.url, title: 'Saved article', sourceTitle: 'Original article',
    body: '## Article\n\nSaved Markdown.', type: 'link', description: '', category: 'Reading', tags: ['reference'],
    capturedAt: '2026-11-15T10:00:00.000Z'
  });
  const first = worker.send({ type: 'save', capture: makeCapture('first-operation'), destinationId: 'c_inbox' });
  await started;
  const second = worker.send({ type: 'save', capture: makeCapture('second-operation'), destinationId: 'c_inbox' });
  assert.deepEqual(committed, ['first-operation'], 'concurrent requests must serialize GitHub saves');
  releaseFirst();
  const [failure, success] = await Promise.all([first, second]);
  assert.equal(failure.ok, false);
  assert.match(failure.error, /offline/);
  assert.equal(success.ok, true);
  assert.deepEqual(committed, ['first-operation', 'second-operation']);
  assert.equal(worker.local.pendingCaptures.length, 1);
  assert.equal(worker.local.pendingCaptures[0].capture.operationId, 'first-operation');
  assert.equal(worker.local.pendingCaptures[0].status, 'error');
  assert.equal(worker.local.lastReceipt.blockId, 'b_second-operation');
});
