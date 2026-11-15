import { MAX_CAPTURE_BODY, MAX_CAPTURE_BYTES, serializeMarkdown } from './markdown.js';

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

export function validateRepository(config) {
  if (!config || !/^[A-Za-z0-9-]+$/.test(config.owner || '') || !/^[A-Za-z0-9_.-]+$/.test(config.repo || '') || config.repo === '..') {
    throw new Error('Enter a GitHub owner and repository name.');
  }
  const branch = config.branch || 'main';
  if (!/^[A-Za-z0-9_./-]+$/.test(branch) || branch.includes('..') || branch.includes('//') || branch.startsWith('/') || branch.endsWith('/') || branch.endsWith('.') || branch.endsWith('.lock')) {
    throw new Error('Enter a valid branch name.');
  }
  return { owner: config.owner, repo: config.repo, branch };
}

export function safeSource(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

// Kept local so the unpacked extension stays independent of the website build.
export function normalizeCaptureTaxonomy(capture) {
  const category = capture.category === undefined ? 'Uncategorized' : capture.category;
  if (typeof category !== 'string') throw new Error('Choose a category of up to 80 characters.');
  const normalizedCategory = category.normalize('NFKC').trim().replace(/\s+/gu, ' ') || 'Uncategorized';
  if (normalizedCategory.length > 80 || /[\u0000-\u001f\u007f-\u009f]/u.test(normalizedCategory)) throw new Error('Choose a category of up to 80 characters.');
  const tags = capture.tags === undefined ? [] : capture.tags;
  if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string')) throw new Error('Tags must be a list of names.');
  const normalizedTags = [];
  for (const tag of tags) {
    const value = tag.normalize('NFKC').trim().replace(/\s+/gu, ' ').replace(/^#+/u, '').trim().toLowerCase();
    if (!value || value.length > 48 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) throw new Error('Each tag must contain 1 to 48 characters.');
    if (!normalizedTags.includes(value)) normalizedTags.push(value);
  }
  if (normalizedTags.length > 20) throw new Error('Use up to 20 tags per material.');
  return { ...capture, category: normalizedCategory, tags: normalizedTags };
}

export function validateCapture(capture) {
  if (!capture || !/^[a-zA-Z0-9_-]{8,80}$/.test(capture.operationId || '')) throw new Error('This capture has no valid operation ID. Capture the page again.');
  if (!safeSource(capture.url)) throw new Error('Only ordinary HTTP or HTTPS pages can be saved.');
  if (!['link', 'text'].includes(capture.type)) throw new Error('This capture type is not supported.');
  if (typeof capture.title !== 'string' || !capture.title.trim() || capture.title.length > 500) throw new Error('Add a title of up to 500 characters.');
  if (typeof capture.body !== 'string' || capture.body.length > MAX_CAPTURE_BODY || new TextEncoder().encode(capture.body).length > MAX_CAPTURE_BYTES) throw new Error('The captured text is too long. Shorten it before saving.');
  if (typeof capture.description !== 'string' || capture.description.length > 10000) throw new Error('The note is too long.');
  if (capture.type === 'text' && !capture.body.trim()) throw new Error('The text selection is empty.');
  if (!Number.isFinite(Date.parse(capture.capturedAt))) throw new Error('The capture timestamp is invalid.');
  if (capture.format !== undefined && capture.format !== 'markdown') throw new Error('Unsupported capture format.');
  const normalized = normalizeCaptureTaxonomy({ ...capture, title: capture.title.trim(), sourceTitle: typeof capture.sourceTitle === 'string' ? capture.sourceTitle.slice(0, 1000) : capture.title.trim() });
  if (capture.format === 'markdown') {
    const article = {};
    for (const key of ['author', 'published', 'description', 'site']) {
      if (typeof capture.article?.[key] === 'string') article[key] = capture.article[key].slice(0, key === 'description' ? 10000 : 1000);
    }
    if (Number.isFinite(capture.article?.wordCount)) article.wordCount = Math.max(0, Math.round(capture.article.wordCount));
    const extraction = {};
    for (const key of ['kind', 'method', 'warning']) {
      if (typeof capture.extraction?.[key] === 'string') extraction[key] = capture.extraction[key].slice(0, key === 'warning' ? 2000 : 100);
    }
    extraction.truncated = capture.extraction?.truncated === true;
    extraction.canLoadMore = capture.extraction?.canLoadMore === true;
    if (Number.isInteger(capture.extraction?.loadedPostCount)) extraction.loadedPostCount = Math.max(0, capture.extraction.loadedPostCount);
    if (Array.isArray(capture.extraction?.posts)) extraction.posts = capture.extraction.posts.slice(0, 200).map(post => ({
      id: String(post.id || '').slice(0, 100),
      url: safeSource(post.url),
      ...(typeof post.author === 'string' ? { author: post.author.slice(0, 1000) } : {}),
      ...(typeof post.published === 'string' ? { published: post.published.slice(0, 100) } : {})
    })).filter(post => post.url);
    return { ...normalized, article, extraction };
  }
  return normalized;
}

function decodeBlob(content) {
  const bytes = Uint8Array.from(atob(content.replace(/\s/g, '')), char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function safeContentPath(path) {
  return typeof path === 'string' && /^content\/[A-Za-z0-9_./-]+$/.test(path) && !path.split('/').some(part => !part || part === '.' || part === '..');
}

export class JellyRepository {
  constructor(config, token, { fetchImpl = globalThis.fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    this.config = validateRepository(config);
    if (!token || typeof token !== 'string') throw new Error('Reconnect your GitHub token for this browser session.');
    this.token = token;
    this.fetch = fetchImpl;
    this.pause = pause;
    this.base = `/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}`;
  }

  async request(path, { method = 'GET', body } = {}) {
    const response = await this.fetch(`${API}${this.base}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2026-03-10',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(25000)
    });
    let data;
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) {
      let message = `GitHub request failed (${response.status}).`;
      if (response.status === 401) message = 'Your GitHub token expired or is invalid. Reconnect in Settings.';
      else if (response.status === 404) message = 'Repository, branch, or content not found. Check your settings and token access.';
      else if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') message = 'GitHub’s request limit was reached. Your capture is kept; retry later.';
      else if (response.status === 403) message = 'GitHub denied this request. Check Contents write permission and repository rules.';
      else if (response.status === 429) message = 'GitHub is limiting requests. Your capture is kept; retry later.';
      else if (response.status === 409 || response.status === 422) message = 'The repository changed or the branch rejected the update. Your capture is kept.';
      throw new GitHubError(message, response.status);
    }
    return data;
  }

  async snapshot() {
    const branchPath = this.config.branch.split('/').map(encodeURIComponent).join('/');
    const reference = await this.request(`/git/ref/heads/${branchPath}`);
    const commit = await this.request(`/git/commits/${reference.object.sha}`);
    const tree = await this.request(`/git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated) throw new Error('This repository is too large for the draft extension’s tree reader.');
    return { head: reference.object.sha, treeSha: commit.tree.sha, entries: tree.tree || [] };
  }

  async jsonAt(snapshot, path) {
    if (!safeContentPath(path)) throw new Error('An invalid content path was rejected.');
    const entry = snapshot.entries.find(item => item.path === path && item.type === 'blob' && item.mode === '100644');
    if (!entry) throw new Error(`Missing Charta content file: ${path}`);
    const blob = await this.request(`/git/blobs/${entry.sha}`);
    if (blob.encoding !== 'base64') throw new Error('GitHub returned an unsupported file encoding.');
    if ((blob.size || 0) > 2_000_000) throw new Error('This content record is too large for the draft extension.');
    try { return JSON.parse(decodeBlob(blob.content)); }
    catch { throw new Error(`Invalid JSON in ${path}.`); }
  }

  async collections(snapshot = null) {
    const current = snapshot || await this.snapshot();
    const entries = current.entries.filter(item => /^content\/collections\/(?:[A-Za-z0-9_-]+\/)+collection\.json$/.test(item.path) && item.type === 'blob');
    const records = [];
    // A small bounded pool avoids a request burst for libraries with many collections.
    for (let offset = 0; offset < entries.length; offset += 4) {
      const batch = await Promise.all(entries.slice(offset, offset + 4).map(async entry => {
        const record = await this.jsonAt(current, entry.path);
        if (record.schemaVersion !== 1 || !/^[A-Za-z0-9_-]+$/.test(record.id || '') || typeof record.title !== 'string' || !Array.isArray(record.items)) throw new Error(`Unsupported collection: ${entry.path}`);
        const references = new Set();
        for (const item of record.items) {
          if (!item || !['block', 'collection'].includes(item.kind) || !/^[A-Za-z0-9_-]+$/.test(item.id || '') || (item.kind === 'collection' && item.id === record.id)) throw new Error(`Invalid connection in ${entry.path}.`);
          const key = `${item.kind}:${item.id}`;
          if (references.has(key)) throw new Error(`Duplicate connection in ${entry.path}.`);
          references.add(key);
        }
        return { id: record.id, title: record.title || record.id, path: entry.path, folder: entry.path.slice('content/collections/'.length, -'/collection.json'.length).split('/').slice(0, -1).join(' / ') };
      }));
      records.push(...batch);
    }
    if (new Set(records.map(item => item.id)).size !== records.length) throw new Error('The library contains duplicate collection IDs.');
    const library = await this.jsonAt(current, 'content/library.json');
    if (library.schemaVersion !== 1) throw new Error('This library uses an unsupported content version.');
    return { collections: records.sort((a, b) => a.title.localeCompare(b.title)), head: current.head };
  }

  async save(capture, destinationId = '', { retries = 3 } = {}) {
    capture = validateCapture(capture);
    const blockId = `b_${capture.operationId}`;
    const blockPath = `content/blocks/${blockId}/block.json`;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const current = await this.snapshot();
      const destinations = await this.collections(current);
      const destination = destinations.collections.find(item => item.id === destinationId);
      if (destinationId && !destination) throw new Error('The destination collection moved or was removed. Choose another collection.');
      const collection = destination ? await this.jsonAt(current, destination.path) : null;
      const existing = current.entries.find(item => item.path === blockPath);
      const memberExists = collection?.items.some(item => item.kind === 'block' && item.id === blockId);
      if (existing && (!collection || memberExists)) {
        const block = await this.jsonAt(current, blockPath);
        if (block.operationId !== capture.operationId) throw new Error('This capture ID is already used by another material.');
        return { commit: current.head, blockId, collectionId: destinationId, alreadySaved: true };
      }
      const changes = [];
      if (existing) {
        const block = await this.jsonAt(current, blockPath);
        if (block.operationId !== capture.operationId) throw new Error('This capture ID is already used by another material.');
      } else {
        const block = {
          schemaVersion: 1,
          id: blockId,
          operationId: capture.operationId,
          type: capture.type,
          title: capture.title.trim(),
          category: capture.category,
          tags: capture.tags,
          source: { url: safeSource(capture.url), title: capture.sourceTitle || capture.title, capturedAt: capture.capturedAt },
          ...(capture.format === 'markdown' ? { contentFormat: 'markdown', article: capture.article, capture: capture.extraction } : {}),
          description: capture.description.trim(),
          ...(capture.body.trim() ? { bodyPath: 'body.md' } : {}),
          assets: [],
          related: [],
          createdAt: capture.capturedAt,
          updatedAt: capture.capturedAt
        };
        changes.push({ path: blockPath, mode: '100644', type: 'blob', content: JSON.stringify(block, null, 2) + '\n' });
        if (capture.body.trim()) changes.push({ path: `content/blocks/${blockId}/body.md`, mode: '100644', type: 'blob', content: capture.format === 'markdown' ? serializeMarkdown(capture) : capture.body.trim() + '\n' });
      }
      if (collection && !memberExists) {
        collection.items.push({ kind: 'block', id: blockId });
        changes.push({ path: destination.path, mode: '100644', type: 'blob', content: JSON.stringify(collection, null, 2) + '\n' });
      }
      if (changes.some(change => !safeContentPath(change.path))) throw new Error('A write outside the content folder was rejected.');
      const tree = await this.request('/git/trees', { method: 'POST', body: { base_tree: current.treeSha, tree: changes } });
      const commit = await this.request('/git/commits', { method: 'POST', body: { message: `Save to Charta: ${capture.title.trim().slice(0, 120)}`, tree: tree.sha, parents: [current.head] } });
      try {
        const branchPath = this.config.branch.split('/').map(encodeURIComponent).join('/');
        await this.request(`/git/refs/heads/${branchPath}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
        return { commit: commit.sha, blockId, collectionId: destinationId, alreadySaved: false };
      } catch (error) {
        if (![409, 422].includes(error.status) || attempt === retries) throw error;
        await this.pause(150 * (attempt + 1));
      }
    }
    throw new Error('The repository kept changing. Retry your saved capture.');
  }
}
