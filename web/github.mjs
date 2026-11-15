import { applyOperation, canonicalContentPaths, safeContentPath, validateCatalog } from './shared/model.mjs';
import { canonicalFiles, assertNoExternalConflict } from './operations.mjs';

export function validateRepository(config) {
  const owner = String(config?.owner || '').trim(), repo = String(config?.repo || '').trim();
  const branch = String(config?.branch || 'main').trim();
  if (!/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo) || ['.', '..'].includes(repo)) throw new Error('Enter a GitHub owner and repository name.');
  if (!/^[A-Za-z0-9_./-]+$/.test(branch) || branch.includes('..') || branch.includes('//') || branch.startsWith('/') || branch.endsWith('/') || branch.endsWith('.') || branch.split('/').some(part => part.startsWith('.') || part.endsWith('.lock'))) throw new Error('Enter a valid branch name.');
  return { owner, repo, branch };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const directory = path => path.slice(0, path.lastIndexOf('/'));
const json = value => `${JSON.stringify(value, null, 2)}\n`;

async function blobHash(text) {
  const body = encoder.encode(text), header = encoder.encode(`blob ${body.length}\0`);
  const bytes = new Uint8Array(header.length + body.length);
  bytes.set(header); bytes.set(body, header.length);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-1', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}

export class GitHubLibrary {
  #token;
  constructor(config, token, { fetchImpl = globalThis.fetch } = {}) {
    this.config = validateRepository(config);
    if (typeof token !== 'string' || !token.trim()) throw new Error('Enter a GitHub token with Contents read and write access.');
    this.#token = token.trim();
    this.fetch = fetchImpl;
    this.base = `https://api.github.com/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}`;
    this.branchPath = this.config.branch.split('/').map(encodeURIComponent).join('/');
    this.blobs = new Map();
  }

  async request(path, { method = 'GET', body } = {}) {
    const response = await this.fetch(this.base + path, {
      method, credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.#token}`, 'X-GitHub-Api-Version': '2026-03-10', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25000)
    });
    if (!response.ok) {
      const message = ({ 401: 'Your GitHub token expired. Reconnect in Settings.', 403: 'GitHub denied the save. Check token permissions, branch rules, or the request limit.', 404: 'Repository or branch not found. Check the repository and token access.', 409: 'The branch changed during this save.', 422: 'The branch changed or rejected this save.', 429: 'GitHub is limiting requests. Try saving again shortly.' })[response.status] || `GitHub could not save (${response.status}). Try again.`;
      throw Object.assign(new Error(message), { status: response.status });
    }
    return response.json();
  }

  async snapshot() {
    const ref = await this.request(`/git/ref/heads/${this.branchPath}`);
    const commit = await this.request(`/git/commits/${ref.object.sha}`);
    const tree = await this.request(`/git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated) throw new Error('GitHub returned an incomplete file tree. No changes were saved.');
    const entries = new Map();
    for (const entry of tree.tree || []) {
      if (!entry.path.startsWith('content/') || entry.path.startsWith('content/_generated/')) continue;
      if (entry.type === 'tree') continue;
      safeContentPath(entry.path);
      if (entry.type !== 'blob' || entry.mode !== '100644') throw new Error('Repository content must use ordinary files, without symbolic links.');
      entries.set(entry.path, entry);
    }
    return { head: ref.object.sha, treeSha: commit.tree.sha, entries };
  }

  async seed(catalog) {
    // Reuse published bytes only when their Git blob hashes match the branch.
    // Connecting a large library normally needs no per-material API requests.
    await Promise.all([...canonicalFiles(catalog).values()].map(async text => this.blobs.set(await blobHash(text), text)));
  }

  async textAt(snapshot, path, optional = false) {
    safeContentPath(path);
    const entry = snapshot.entries.get(path);
    if (!entry) { if (optional) return null; throw new Error(`Missing repository file: ${path}`); }
    if (this.blobs.has(entry.sha)) return this.blobs.get(entry.sha);
    if (entry.size > 8 * 1024 * 1024) throw new Error(`Repository text is too large: ${path}`);
    const blob = await this.request(`/git/blobs/${entry.sha}`);
    if (blob.encoding !== 'base64' || blob.size > 8 * 1024 * 1024) throw new Error('GitHub returned unsupported file content.');
    const text = decoder.decode(Uint8Array.from(atob(blob.content.replace(/\s/g, '')), char => char.charCodeAt(0)));
    this.blobs.set(entry.sha, text);
    return text;
  }

  async catalog(snapshot) {
    const parse = async path => {
      try { return JSON.parse(await this.textAt(snapshot, path)); }
      catch (error) { throw new Error(`Could not read ${path}: ${error.message}`); }
    };
    const catalog = { schemaVersion: 1, sourceCommit: snapshot.head, library: await parse('content/library.json'), folders: [], collections: [], blocks: [] };
    const paths = [...snapshot.entries.keys()].filter(path => /^content\/collections\/.+\/(folder|collection)\.json$/.test(path) || /^content\/blocks\/[^/]+\/block\.json$/.test(path));
    // Bound reads when another client has added many records since publication.
    for (let offset = 0; offset < paths.length; offset += 6) {
      await Promise.all(paths.slice(offset, offset + 6).map(async path => {
        const value = { ...await parse(path), path };
        if (path.endsWith('/folder.json')) catalog.folders.push(value);
        else if (path.endsWith('/collection.json')) catalog.collections.push(value);
        else {
          const base = directory(path);
          value.body = value.bodyPath ? await this.textAt(snapshot, `${base}/${value.bodyPath}`) : '';
          const summary = await this.textAt(snapshot, `${base}/summary.json`, true);
          value.summary = summary === null ? null : JSON.parse(summary);
          const rawBase = `https://raw.githubusercontent.com/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/${snapshot.head}/`;
          value.assets = (value.assets || []).map(asset => ({ ...asset, remoteUrl: rawBase + `${base}/${asset.path}`.split('/').map(encodeURIComponent).join('/') }));
          catalog.blocks.push(value);
        }
      }));
    }
    for (const item of [...catalog.folders, ...catalog.collections]) item.parentId = catalog.folders.find(f => directory(f.path) === directory(directory(item.path)))?.id || null;
    for (const block of catalog.blocks) block.collectionIds = catalog.collections.filter(c => c.items.some(item => item.kind === 'block' && item.id === block.id)).map(c => c.id);
    for (const c of catalog.collections) c.collectionIds = catalog.collections.filter(parent => parent.items.some(item => item.kind === 'collection' && item.id === c.id)).map(parent => parent.id);
    const canonical = canonicalContentPaths(catalog);
    catalog.extraFiles = [...snapshot.entries.keys()].filter(path => !canonical.has(path));
    return validateCatalog(catalog);
  }

  async open(seed) {
    await this.seed(seed);
    return this.catalog(await this.snapshot());
  }

  async apply(before, operation) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await this.snapshot();
      const current = await this.catalog(snapshot);
      assertNoExternalConflict(before, current, operation);
      const result = applyOperation(current, operation);
      if (operation.type === 'update-collection') {
        const source = current.collections.find(c => c.id === operation.id), destination = result.catalog.collections.find(c => c.id === operation.id);
        if (source.path !== destination.path && [...snapshot.entries.keys()].some(path => (path.startsWith(`${directory(source.path)}/`) && path !== source.path) || path.startsWith(`${directory(destination.path)}/`))) throw new Error('This collection has additional files or the destination is occupied. Choose another folder.');
      }
      const changes = [];
      for (const entry of result.writes.filter(entry => entry.content !== null || snapshot.entries.has(entry.path))) {
        const change = { path: safeContentPath(entry.path), mode: '100644', type: 'blob' };
        if (entry.encoding === 'base64') {
          const blob = await this.request('/git/blobs', { method: 'POST', body: { content: entry.content, encoding: 'base64' } });
          change.sha = blob.sha;
        } else if (entry.content === null) change.sha = null;
        else change.content = entry.content;
        changes.push(change);
      }
      if (!changes.length) return { ...result, commit: snapshot.head };
      const tree = await this.request('/git/trees', { method: 'POST', body: { base_tree: snapshot.treeSha, tree: changes } });
      const commit = await this.request('/git/commits', { method: 'POST', body: { message: `Charta: ${operation.type} ${operation.id || operation.blockId || result.entityId || ''}`.trim(), tree: tree.sha, parents: [snapshot.head] } });
      try {
        await this.request(`/git/refs/heads/${this.branchPath}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
      } catch (error) {
        // A timed-out response may still have advanced the branch successfully.
        const latest = await this.request(`/git/ref/heads/${this.branchPath}`).catch(() => null);
        if (latest?.object.sha !== commit.sha) {
          if ([409, 422].includes(error.status) && attempt < 2) continue;
          throw error;
        }
      }
      result.catalog.sourceCommit = commit.sha;
      for (const block of result.catalog.blocks) for (const asset of block.assets || []) asset.remoteUrl = `https://raw.githubusercontent.com/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/${commit.sha}/${directory(block.path)}/${asset.path}`;
      await this.seed(result.catalog);
      return { ...result, commit: commit.sha, commitURL: `https://github.com/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/commit/${commit.sha}` };
    }
    throw new Error('The repository kept changing. Review the latest library and try again.');
  }
}
