import { applyOperation, canonicalRecord, canonicalContentPaths, safeContentPath, validateCatalog } from './shared/model.mjs';
import { intendedOperation, assertNoExternalConflict, canonicalFiles, operationBase } from './operations.mjs';
import { GitHubLibrary, validateRepository } from './github.mjs';
import { bytesFromBase64, mutationBytes } from './shared/uploads.mjs';

const BASE = new URL('./', document.baseURI);
// Keep the original keys so the Charta rebrand preserves drafts and connections.
const KEY = `jelly:draft:v1:${location.pathname}`;
const GITHUB_KEY = `jelly:github:v1:${location.pathname}`;
const jsonText = object => `${JSON.stringify(object, null, 2)}\n`;
const directory = path => path.slice(0, path.lastIndexOf('/'));
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function remoteAssetURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('The published original has an invalid download URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Published original downloads require a safe HTTPS URL.');
  return url.href;
}
const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const equal = (a, b) => stable(a) === stable(b);

const sameBytes = (a, b) => {
  if (a === undefined || b === undefined) return a === b;
  const left = new Uint8Array(a), right = new Uint8Array(b);
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
};
async function optionalFile(root, path) { try { return await readFile(root, path); } catch (error) { if (error.name !== 'NotFoundError') throw error; } }
async function hydrateAssetURLs(root, catalog) {
  const created = [];
  try {
    for (const block of catalog.blocks) {
      block._assetURLs = {};
      for (const asset of block.assets || []) {
        const file = await (await handleAt(root, `${directory(block.path)}/${asset.path}`)).getFile();
        const url = URL.createObjectURL(file);
        block._assetURLs[asset.path] = url;
        created.push(url);
      }
    }
    return catalog;
  } catch (error) { created.forEach(url => URL.revokeObjectURL(url)); throw error; }
}
function releaseAssetURLs(catalog) { for (const block of catalog.blocks) for (const url of Object.values(block._assetURLs || {})) URL.revokeObjectURL(url); }
function rememberUploads(catalog, writes) {
  for (const entry of writes || []) {
    if (entry.encoding !== 'base64') continue;
    const block = catalog.blocks.find(block => entry.path.startsWith(`${directory(block.path)}/assets/`));
    if (block) { block._assetData ||= {}; block._assetData[entry.path.slice(directory(block.path).length + 1)] = entry.content; }
  }
}
function hydrateDraftUploads(catalog) {
  for (const block of catalog.blocks) {
    for (const asset of block.assets || []) if (block._assetData?.[asset.path]) {
      block._assetURLs ||= {};
      block._assetURLs[asset.path] = URL.createObjectURL(new Blob([bytesFromBase64(block._assetData[asset.path])], { type: asset.mimeType }));
    }
  }
  return catalog;
}

async function checkCollectionMove(root, before, after, operation) {
  if (operation.type !== 'update-collection') return;
  const source = before.collections.find(c => c.id === operation.id);
  const destination = after.collections.find(c => c.id === operation.id);
  if (!source || source.path === destination?.path) return;
  const openDirectory = async path => {
    let handle = root;
    for (const part of path.split('/')) handle = await handle.getDirectoryHandle(part);
    return handle;
  };
  for await (const [name] of (await openDirectory(directory(source.path))).entries()) {
    if (name !== 'collection.json') throw new Error('This collection has additional files. Moving currently supports collections containing only collection.json; its other files have been left untouched.');
  }
  try {
    for await (const entry of (await openDirectory(directory(destination.path))).entries()) throw new Error('The destination directory already contains files. Choose another folder.');
  } catch (error) { if (error.name !== 'NotFoundError') throw error; }
}

async function handleAt(root, path, create = false) {
  safeContentPath(path);
  const parts = path.split('/');
  let handle = root;
  for (const part of parts.slice(0, -1)) handle = await handle.getDirectoryHandle(part, { create });
  return handle.getFileHandle(parts.at(-1), { create });
}
async function readFile(root, path) {
  return (await (await handleAt(root, path)).getFile()).arrayBuffer();
}
async function writeFile(root, path, value) {
  const file = await handleAt(root, path, true);
  const writer = await file.createWritable();
  try { await writer.write(value); await writer.close(); }
  catch (error) { await writer.abort().catch(() => {}); throw error; }
}
async function removeFile(root, path) {
  const parts = path.split('/');
  let handle = root;
  for (const part of parts.slice(0, -1)) handle = await handle.getDirectoryHandle(part);
  await handle.removeEntry(parts.at(-1));
}

async function folderCatalog(root) {
  const texts = new Map();
  const files = [];
  async function walk(handle, prefix) {
    for await (const [name, entry] of handle.entries()) {
      if (name.startsWith('.') || name === '_generated') continue;
      const path = `${prefix}/${name}`;
      if (entry.kind === 'directory') await walk(entry, path);
      else {
        files.push(safeContentPath(path));
        if (name.endsWith('.json') || /\.(?:md|txt)$/i.test(name)) texts.set(path, await (await entry.getFile()).text());
      }
    }
  }
  await walk(await root.getDirectoryHandle('content'), 'content');
  const parse = path => {
    if (!texts.has(path)) throw new Error(`Missing ${path}. Choose the Charta project folder containing content/.`);
    try { return JSON.parse(texts.get(path)); } catch { throw new Error(`Invalid JSON in ${path}.`); }
  };
  const library = parse('content/library.json');
  const folders = [], collections = [], blocks = [];
  for (const [path] of texts) {
    if (path.endsWith('/folder.json')) folders.push({ ...parse(path), path });
    if (path.endsWith('/collection.json')) collections.push({ ...parse(path), path });
    if (path.endsWith('/block.json')) {
      const value = parse(path), base = directory(path);
      if (value.bodyPath && !texts.has(`${base}/${value.bodyPath}`)) throw new Error(`Missing saved text: ${base}/${value.bodyPath}.`);
      blocks.push({ ...value, path, body: value.bodyPath ? texts.get(`${base}/${value.bodyPath}`) || '' : '', summary: texts.has(`${base}/summary.json`) ? parse(`${base}/summary.json`) : null });
    }
  }
  for (const item of [...folders, ...collections]) item.parentId = folders.find(f => directory(f.path) === directory(directory(item.path)))?.id || null;
  const catalog = { schemaVersion: 1, library, folders, collections, blocks, sourceCommit: 'local-folder' };
  const canonical = canonicalContentPaths(catalog);
  catalog.extraFiles = files.filter(file => !canonical.has(file));
  return validateCatalog(catalog);
}

// Stored ZIP entries use no compression so a content export needs no runtime dependency.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function createZip(files) {
  const chunks = [], central = [];
  let offset = 0, centralSize = 0;
  for (const { path, bytes } of files) {
    const name = encoder.encode(path), checksum = crc32(bytes);
    const header = new Uint8Array(30 + name.length), view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
    view.setUint32(14, checksum, true); view.setUint32(18, bytes.length, true); view.setUint32(22, bytes.length, true); view.setUint16(26, name.length, true); header.set(name, 30);
    chunks.push(header, bytes);
    const entry = new Uint8Array(46 + name.length), ev = new DataView(entry.buffer);
    ev.setUint32(0, 0x02014b50, true); ev.setUint16(4, 20, true); ev.setUint16(6, 20, true); ev.setUint16(8, 0x800, true);
    ev.setUint32(16, checksum, true); ev.setUint32(20, bytes.length, true); ev.setUint32(24, bytes.length, true); ev.setUint16(28, name.length, true); ev.setUint32(42, offset, true); entry.set(name, 46);
    central.push(entry); centralSize += entry.length; offset += header.length + bytes.length;
  }
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end], { type: 'application/zip' });
}

export class LibraryStore {
  constructor(catalog, mode) {
    this.catalog = catalog; this.mode = mode; this.directoryHandle = null; this.upstreamChanged = false;
    this.queue = Promise.resolve(); this.github = null; this.githubConfig = null; this.saveState = 'idle'; this.onStatus = null;
    try { const saved = localStorage.getItem(GITHUB_KEY); if (saved) this.githubConfig = validateRepository(JSON.parse(saved)); } catch { /* Invalid preferences do not prevent browsing. */ }
  }

  static async open() {
    let response;
    try {
      response = await fetch(new URL('api/library', BASE), { cache: 'no-store' });
    } catch { /* A static GitHub Pages deployment has no local write API. */ }
    if (response?.ok && response.headers.get('content-type')?.includes('application/json')) {
      const catalog = await response.json();
      validateCatalog(catalog);
      return new LibraryStore(catalog, 'repository');
    }
    if (response && response.status >= 500) throw new Error('The local library could not be read. Check the development server for a content validation error.');
    response = await fetch(new URL('content/_generated/catalog.json', BASE), { cache: 'no-store' });
    if (!response.ok) throw new Error('The library catalog could not be loaded. Run npm run build first.');
    const catalog = await response.json();
    validateCatalog(catalog);
    let saved;
    try { saved = localStorage.getItem(KEY); } catch { /* Read-only browsing is still available. */ }
    if (saved) {
      try {
        const draft = validateCatalog(JSON.parse(saved));
        const store = new LibraryStore(hydrateDraftUploads(draft), 'browser');
        store.upstreamChanged = draft.sourceCommit !== catalog.sourceCommit;
        return store;
      }
      catch { throw new Error('Your saved browser draft could not be read. Export or clear this site’s storage before continuing.'); }
    }
    return new LibraryStore(catalog, 'browser');
  }

  status(state, error = '') { this.saveState = state; this.saveError = error; this.onStatus?.(state); }

  apply(operation) {
    const input = structuredClone(operation);
    const queued = this.queue.then(async () => {
      this.status('saving');
      try { const result = await this.applyNow(input); this.lastCommit = result.commitURL || ''; this.status('saved'); return result; }
      catch (error) { this.status('error', error.message); throw error; }
    });
    this.queue = queued.catch(() => {});
    return queued;
  }

  async applyNow(operation) {
    if (this.githubConfig && this.mode !== 'github') throw new Error('Reconnect GitHub in Settings before saving changes to your repository.');
    const op = intendedOperation(this.catalog, operation);
    let preview = applyOperation(this.catalog, op);
    if (op.type === 'add-block') op.block = { ...op.block, id: preview.entityId };
    if (op.type === 'create-folder' || op.type === 'create-collection' || op.type === 'create-canvas') op.id = preview.entityId;
    if (this.mode === 'github') {
      const result = await this.github.apply(this.catalog, op);
      rememberUploads(result.catalog, result.writes);
      hydrateDraftUploads(result.catalog);
      releaseAssetURLs(this.catalog);
      this.catalog = result.catalog;
      return result;
    }
    if (this.mode === 'repository') {
      // Keep generated IDs stable between preview and the server mutation.
      const response = await fetch(new URL('api/mutate', BASE), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...op, baseCatalog: operationBase(this.catalog, op) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The content files could not be saved.');
      this.catalog = validateCatalog(result.catalog);
      return result;
    }
    if (this.mode === 'folder') {
      const current = await folderCatalog(this.directoryHandle);
      assertNoExternalConflict(this.catalog, current, op);
      preview = applyOperation(current, op);
      await checkCollectionMove(this.directoryHandle, current, preview.catalog, op);
      const expected = canonicalFiles(current);
      const attachments = new Set([...canonicalContentPaths(current), ...(current.extraFiles || [])]);
      const before = [];
      try {
        for (const entry of preview.writes) {
          const previous = await optionalFile(this.directoryHandle, entry.path);
          const snapshot = expected.get(entry.path);
          const attachmentDeletion = entry.content === null && snapshot === undefined && attachments.has(entry.path);
          if (entry.encoding === 'base64' && previous !== undefined) throw new Error('An uploaded file already exists at this path. Retry with a new resource.');
          if (!attachmentDeletion && (previous === undefined ? snapshot !== undefined : snapshot === undefined || (entry.path.endsWith('.json') ? !equal(JSON.parse(decoder.decode(previous)), JSON.parse(snapshot)) : decoder.decode(previous) !== snapshot))) throw new Error('The local content changed while Charta was preparing this save. Please try again.');
          if (attachmentDeletion && previous === undefined) continue;
          before.push({ path: entry.path, previous, content: entry.content, encoding: entry.encoding, written: false });
        }
        for (const entry of before) {
          if (!sameBytes(await optionalFile(this.directoryHandle, entry.path), entry.previous)) throw new Error('The local content changed during this save. Please try again.');
          entry.written = true;
          if (entry.content === null) await removeFile(this.directoryHandle, entry.path);
          else await writeFile(this.directoryHandle, entry.path, entry.encoding === 'base64' ? mutationBytes(entry) : entry.content);
        }
        preview.catalog = await hydrateAssetURLs(this.directoryHandle, preview.catalog);
      } catch (error) {
        releaseAssetURLs(preview.catalog);
        const restored = await Promise.allSettled(before.reverse().filter(entry => entry.written).map(async entry => {
          const expected = entry.content === null ? undefined : mutationBytes(entry).buffer;
          const current = await optionalFile(this.directoryHandle, entry.path);
          if (sameBytes(current, entry.previous)) return;
          const emptyNewFile = entry.previous === undefined && current?.byteLength === 0;
          if (!emptyNewFile && !sameBytes(current, expected)) throw new Error('The saved file was changed externally.');
          return entry.previous ? writeFile(this.directoryHandle, entry.path, entry.previous) : removeFile(this.directoryHandle, entry.path);
        }));
        if (restored.some(r => r.status === 'rejected')) throw new Error('Saving failed and some files could not be restored. Check your content folder before saving again.');
        throw error;
      }
      releaseAssetURLs(this.catalog);
    } else {
      rememberUploads(preview.catalog, preview.writes);
      try { localStorage.setItem(KEY, JSON.stringify(preview.catalog)); }
      catch { throw new Error('This browser could not save the draft. Connect a local folder or free some site storage, then try again.'); }
      hydrateDraftUploads(preview.catalog);
      releaseAssetURLs(this.catalog);
    }
    this.catalog = preview.catalog;
    return preview;
  }

  async connectFolder() {
    if (!window.showDirectoryPicker) throw new Error('Connecting a folder requires Chrome on desktop. You can export the content ZIP in this browser.');
    const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'jelly-project' });
    const catalog = await hydrateAssetURLs(handle, await folderCatalog(handle));
    releaseAssetURLs(this.catalog);
    this.directoryHandle = handle;
    this.catalog = catalog;
    this.mode = 'folder';
    this.upstreamChanged = false;
    this.github = null; this.githubConfig = null; localStorage.removeItem(GITHUB_KEY);
    return catalog;
  }

  async connectGitHub(config, token) {
    await this.queue;
    const client = new GitHubLibrary(config, token);
    const catalog = await client.open(this.catalog);
    // Save only destination preferences. The token lives in the client instance.
    localStorage.setItem(GITHUB_KEY, JSON.stringify(client.config));
    releaseAssetURLs(this.catalog);
    this.github = client; this.githubConfig = client.config;
    this.catalog = catalog; this.directoryHandle = null; this.mode = 'github'; this.upstreamChanged = false;
    this.status('idle');
    return catalog;
  }

  async disconnectGitHub() {
    await this.queue;
    // Keep the last confirmed snapshot available when the connection is removed.
    localStorage.setItem(KEY, JSON.stringify(this.catalog));
    localStorage.removeItem(GITHUB_KEY);
    this.github = null; this.githubConfig = null; this.mode = 'browser'; this.lastCommit = '';
    this.status('idle');
  }

  async exportContent({ download = true } = {}) {
    const entries = new Map();
    const addText = (path, text) => entries.set(safeContentPath(path), encoder.encode(text));
    addText('content/library.json', jsonText(this.catalog.library));
    for (const item of [...this.catalog.folders, ...this.catalog.collections, ...this.catalog.blocks]) addText(item.path, jsonText(canonicalRecord(item)));
    for (const block of this.catalog.blocks) {
      const base = directory(block.path);
      if (block.bodyPath) addText(`${base}/${block.bodyPath}`, block.body || '');
      if (block.summary) addText(`${base}/summary.json`, jsonText(block.summary));
      for (const asset of block.assets || []) {
        const path = safeContentPath(`${base}/${asset.path}`);
        let data;
        if (block._assetData?.[asset.path]) data = bytesFromBase64(block._assetData[asset.path]);
        else if (this.mode === 'folder') data = await readFile(this.directoryHandle, path);
        else {
          const response = await fetch(asset.remoteUrl ? remoteAssetURL(asset.remoteUrl) : new URL(path, BASE), asset.remoteUrl ? { credentials: 'omit' } : undefined);
          if (!response.ok) throw new Error(`Could not include ${asset.path} in the export. Nothing was downloaded.`);
          data = await response.arrayBuffer();
        }
        entries.set(path, new Uint8Array(data));
      }
    }
    for (const file of this.catalog.extraFiles || []) {
      const path = safeContentPath(file);
      if (entries.has(path)) throw new Error('An extra archive path duplicates a canonical file.');
      let data;
      if (this.mode === 'folder') data = await readFile(this.directoryHandle, path);
      else {
        const response = await fetch(new URL(path, BASE));
        if (!response.ok) throw new Error(`Could not include ${path} in the export. Nothing was downloaded.`);
        data = await response.arrayBuffer();
      }
      entries.set(path, new Uint8Array(data));
    }
    const zip = createZip([...entries].map(([path, bytes]) => ({ path, bytes })));
    if (download) {
      const url = URL.createObjectURL(zip), anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'charta-content.zip'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    return zip;
  }

  async resetDraft() {
    if (this.mode !== 'browser') throw new Error('Only browser drafts can be reset here. Repository files are not changed.');
    const response = await fetch(new URL('content/_generated/catalog.json', BASE), { cache: 'no-store' });
    if (!response.ok) throw new Error('The original library could not be loaded.');
    const original = validateCatalog(await response.json());
    localStorage.removeItem(KEY);
    this.catalog = original;
    this.upstreamChanged = false;
    return this.catalog;
  }
}
