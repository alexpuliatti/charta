import { validateCanvases } from './canvas.mjs';
import { normalizeCategory, normalizeTags, normalizeTaxonomy } from './taxonomy.mjs';
import { serializeMarkdown, stripFrontmatter } from './clip-markdown.mjs';
import { validatedAttachments } from './uploads.mjs';
import { normalizedResourceURL, resourceFolderPath } from './resource-routing.mjs';
import { emptyPDFReading, validatePDFReading, validatePDFReadings } from './pdf-reading.mjs';

const ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,100}$/;
const ACTIVE = /\.(?:html?|svg|m?js|cjs|xml|xhtml)$/i;
const TYPES = new Set(['link', 'text', 'image', 'file', 'video', 'audio']);
const MAX_MATERIAL_BYTES = 2 * 1024 * 1024;
const string = (value, label, max = 100000) => {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label} must be text under ${max} characters.`);
  return value;
};
const id = (value) => { if (!ID.test(value || '')) throw new Error('Invalid record ID.'); return value; };
const materialText = value => {
  if (typeof value !== 'string' || value.length > MAX_MATERIAL_BYTES || new TextEncoder().encode(value).byteLength > MAX_MATERIAL_BYTES) {
    throw new Error('Material text must be text under 2 MiB.');
  }
  return value;
};
export const newId = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;

export function safeContentPath(path) {
  if (typeof path !== 'string' || !path.startsWith('content/') || path.includes('\\') || /[\u0000-\u001f?#%]/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..') || ACTIVE.test(path)) throw new Error('Unsafe content path.');
  return path;
}

export function safeSourceUrl(url) {
  if (!url) return '';
  try { const parsed = new URL(url); if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(); return parsed.href; }
  catch { throw new Error('Use a complete http or https source URL without embedded credentials.'); }
}

export function canonicalRecord(record) {
  const { path, parentId, body, summary, collectionIds, _assetURLs, _assetData, ...data } = record;
  if (TYPES.has(data.type)) Object.assign(data, normalizeTaxonomy(data));
  if (Array.isArray(data.assets)) data.assets = data.assets.map(({ remoteUrl, ...asset }) => asset);
  return data;
}

export function canonicalContentPaths(catalog) {
  const paths = new Set(['content/library.json']);
  for (const record of [...(catalog.folders || []), ...(catalog.collections || []), ...(catalog.blocks || [])]) paths.add(record.path);
  for (const block of catalog.blocks || []) {
    const base = block.path?.slice(0, block.path.lastIndexOf('/') + 1);
    if (!base) continue;
    if (block.bodyPath) paths.add(base + block.bodyPath);
    paths.add(base + 'summary.json');
    for (const asset of block.assets || []) paths.add(base + asset.path);
  }
  return paths;
}

export function validateExtraFiles(catalog) {
  if (catalog.extraFiles === undefined) return [];
  if (!Array.isArray(catalog.extraFiles)) throw new Error('Extra archive files must be an array.');
  const canonical = canonicalContentPaths(catalog), seen = new Set();
  for (const file of catalog.extraFiles) {
    safeContentPath(file);
    if (file.startsWith('content/_generated/') || canonical.has(file) || seen.has(file)) throw new Error('Extra archive files must be unique noncanonical content paths.');
    seen.add(file);
  }
  return catalog.extraFiles;
}

export function validateCatalog(catalog) {
  if (catalog.schemaVersion !== 1 || catalog.library?.schemaVersion !== 1) throw new Error('Unsupported library version.');
  const records = [...catalog.folders, ...catalog.collections, ...catalog.blocks];
  const ids = new Set(), paths = new Set();
  for (const record of records) {
    id(record.id);
    if (ids.has(record.id)) throw new Error(`Duplicate ID: ${record.id}`);
    ids.add(record.id);
    safeContentPath(record.path);
    if (paths.has(record.path)) throw new Error('Duplicate content path.');
    paths.add(record.path);
    if (record.schemaVersion !== 1) throw new Error('Unsupported record version.');
    string(record.title, 'Title', 1000);
    if (!record.title.trim()) throw new Error('A title is required.');
  }
  const folderIds = new Set(catalog.folders.map(f => f.id));
  const collectionIds = new Set(catalog.collections.map(c => c.id));
  const blockIds = new Set(catalog.blocks.map(b => b.id));
  if (catalog.library.inboxCollectionId != null && !collectionIds.has(catalog.library.inboxCollectionId)) throw new Error('The legacy inboxCollectionId must refer to an existing collection.');
  for (const record of [...catalog.folders, ...catalog.collections]) {
    if (record.parentId && !folderIds.has(record.parentId)) throw new Error('Unknown parent folder.');
    if (!record.path.startsWith('content/collections/')) throw new Error('Collections must live inside content/collections/.');
    const parentPath = dir(dir(record.path));
    const parent = catalog.folders.find(f => f.id === record.parentId);
    if (parent ? dir(parent.path) !== parentPath : parentPath !== 'content/collections') throw new Error('Parent folder must match the physical content path.');
    if (!record.path.endsWith(catalog.folders.includes(record) ? '/folder.json' : '/collection.json')) throw new Error('Invalid collection or folder record filename.');
  }
  for (const folder of catalog.folders) {
    const visited = new Set([folder.id]);
    let current = folder;
    while (current.parentId) {
      if (visited.has(current.parentId)) throw new Error('Folder hierarchy cannot contain a cycle.');
      visited.add(current.parentId);
      current = catalog.folders.find(f => f.id === current.parentId);
    }
  }
  for (const collection of catalog.collections) {
    const membership = new Set();
    if (!Array.isArray(collection.items)) throw new Error('Collection items must be an array.');
    for (const item of collection.items) {
      const target = item.kind === 'block' ? blockIds : item.kind === 'collection' ? collectionIds : null;
      if (!target?.has(item.id)) throw new Error('Unknown connection target.');
      if (item.kind === 'collection' && item.id === collection.id) throw new Error('A collection cannot connect to itself.');
      const key = `${item.kind}:${item.id}`;
      if (membership.has(key)) throw new Error('Duplicate collection membership.');
      membership.add(key);
    }
  }
  for (const block of catalog.blocks) {
    validatePDFReadings(block);
    Object.assign(block, normalizeTaxonomy(block));
    if (!TYPES.has(block.type)) throw new Error('Unknown material type.');
    if (block.path !== `content/blocks/${block.id}/block.json`) throw new Error('Material path must match its ID.');
    if (block.source?.url) safeSourceUrl(block.source.url);
    if (block.bodyPath) {
      safeContentPath(`${block.path.slice(0, block.path.lastIndexOf('/') + 1)}${block.bodyPath}`);
      if (!/\.(?:md|txt)$/i.test(block.bodyPath)) throw new Error('Saved text must use a Markdown or plain text file.');
    }
    if (!Array.isArray(block.assets) || !Array.isArray(block.related)) throw new Error('Material assets and relations must be arrays.');
    const mimeTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', mp4: 'video/mp4', m4v: 'video/x-m4v', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav', bin: 'application/octet-stream' };
    for (const asset of block.assets) {
      safeContentPath(`${block.path.slice(0, block.path.lastIndexOf('/') + 1)}${asset.path}`);
      if (!asset.path.startsWith('assets/') || !/\.(?:png|jpe?g|webp|gif|avif|pdf|txt|md|mp4|m4v|webm|mov|mp3|m4a|ogg|wav|bin)$/i.test(asset.path)) throw new Error('Unsupported uploaded file type.');
      if (mimeTypes[asset.path.split('.').at(-1).toLowerCase()] !== asset.mimeType) throw new Error('Uploaded file MIME type does not match its extension.');
    }
    const seenRelated = new Set();
    for (const ref of block.related) {
      const target = typeof ref === 'string' ? ref : ref.id;
      if (!blockIds.has(target) || target === block.id || seenRelated.has(target)) throw new Error('Unknown or duplicate related material.');
      seenRelated.add(target);
    }
  }
  validateCanvases(catalog.library, catalog.blocks);
  validateExtraFiles(catalog);
  return catalog;
}

function title(value) {
  const result = string(value, 'Title', 1000).trim();
  if (!result) throw new Error('A title is required.');
  return result;
}
const slug = value => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';
const dir = path => path.slice(0, path.lastIndexOf('/'));

export function applyOperation(input, operation) {
  const catalog = structuredClone(input);
  validateCatalog(catalog);
  const writes = new Map();
  const write = (path, content, encoding) => writes.set(safeContentPath(path), { path, content, ...(encoding ? { encoding } : {}) });
  const record = value => write(value.path, `${JSON.stringify(canonicalRecord(value), null, 2)}\n`);
  const syncMarkdown = material => {
    if (material.contentFormat !== 'markdown' || typeof material.body !== 'string') return;
    const body = materialText(serializeMarkdown({
      title: material.title,
      url: material.source?.url,
      capturedAt: material.source?.capturedAt || material.createdAt,
      description: material.description,
      category: material.category,
      tags: material.tags,
      // Owner metadata takes precedence even when its description was cleared.
      article: { ...material.article, description: material.description },
      extraction: material.capture,
      body: stripFrontmatter(material.body)
    }));
    if (body === material.body) return;
    material.body = body;
    material.bodyPath ||= 'body.md';
    write(`${dir(material.path)}/${material.bodyPath}`, body);
  };
  const collection = value => {
    const result = catalog.collections.find(c => c.id === value);
    if (!result) throw new Error('Collection not found.');
    return result;
  };
  const block = value => {
    const result = catalog.blocks.find(b => b.id === value);
    if (!result) throw new Error('Material not found.');
    return result;
  };
  const now = new Date().toISOString();
  let entityId;
  switch (operation.type) {
    case 'save-pdf-reading': {
      const material = block(operation.id);
      if (!material.assets.some(asset => asset.path === operation.assetPath && asset.mimeType === 'application/pdf')) throw new Error('The saved PDF could not be found.');
      const previous = material.pdfReading?.[operation.assetPath] || emptyPDFReading();
      if (previous.revision !== operation.expectedRevision) throw new Error('These PDF notes changed elsewhere. Export your open notes, then reload before saving.');
      const reading = validatePDFReading({ revision: previous.revision + 1, notes: operation.reading?.notes, annotations: operation.reading?.annotations });
      material.pdfReading = { ...material.pdfReading, [operation.assetPath]: reading };
      entityId = material.id;
      record(material);
      break;
    }
    case 'create-canvas': {
      const canvasId = id(operation.id || newId('canvas'));
      catalog.library.canvases ||= [];
      if (catalog.library.canvases.some(board => board.id === canvasId)) throw new Error('Canvas already exists.');
      catalog.library.canvases.push({ id: canvasId, title: title(operation.title || 'Untitled canvas'), revision: 1, nodes: [], edges: [], viewport: { x: 100, y: 80, zoom: 1 }, createdAt: now, updatedAt: now });
      entityId = canvasId;
      write('content/library.json', `${JSON.stringify(catalog.library, null, 2)}\n`);
      break;
    }
    case 'save-canvas':
    case 'delete-canvas': {
      const boards = catalog.library.canvases || [];
      const index = boards.findIndex(board => board.id === operation.id);
      if (index < 0) throw new Error('Canvas could not be found.');
      const previous = boards[index];
      if (previous.revision !== operation.expectedRevision) throw new Error('This canvas changed elsewhere. Your edits are still open; export them before reloading.');
      if (operation.type === 'delete-canvas') boards.splice(index, 1);
      else {
        const value = operation.canvas;
        if (!value || typeof value !== 'object') throw new Error('Invalid canvas.');
        boards[index] = { id: previous.id, title: title(value.title), nodes: value.nodes, edges: value.edges, viewport: value.viewport, revision: previous.revision + 1, createdAt: previous.createdAt, updatedAt: now };
      }
      entityId = operation.id;
      write('content/library.json', `${JSON.stringify(catalog.library, null, 2)}\n`);
      break;
    }
    case 'import-resource': {
      const input = operation.block || {};
      const resourceId = id(input.id || newId('b'));
      const url = normalizedResourceURL(input.source?.url);
      const fileHash = operation.attachments?.find(file => file.role !== 'thumbnail')?.sha256;
      const duplicate = catalog.blocks.find(block => (url && normalizedResourceURL(block.source?.url) === url) || (fileHash && /^[a-f0-9]{64}$/.test(fileHash) && block.assets.some(asset => asset.role === 'original' && asset.sha256 === fileHash)) || (block.id === resourceId && block.ingest?.operationId === resourceId));
      const chosen = operation.destinationId ? collection(operation.destinationId) : null;
      if (duplicate) {
        const membership = c => c.items.some(item => item.kind === 'block' && item.id === duplicate.id);
        if (chosen && !membership(chosen)) {
          const ids = catalog.collections.filter(membership).map(c => c.id);
          const result = applyOperation(catalog, { type: 'connect', blockId: duplicate.id, collectionIds: [...ids, chosen.id] });
          return { ...result, entityId: duplicate.id, alreadySaved: true, destinationId: chosen.id };
        }
        return { catalog, writes: [], entityId: duplicate.id, alreadySaved: true, destinationId: operation.destinationId ?? catalog.collections.find(membership)?.id ?? '' };
      }
      if (catalog.blocks.some(block => block.id === resourceId)) throw new Error('This resource ID is already in use.');
      const destination = operation.destinationId === undefined ? operation.destinationPath || [] : [];
      if (!Array.isArray(destination) || destination.length > 6 || destination.some(part => typeof part !== 'string' || !part.trim() || part.length > 120)) throw new Error('The resource destination is invalid.');
      let next = catalog, parentId = null, destinationId = chosen?.id || '';
      const allWrites = new Map();
      const merge = result => { next = result.catalog; for (const entry of result.writes) allWrites.set(entry.path, entry); return result.entityId; };
      for (const [index, name] of destination.entries()) {
        const isLeaf = index === destination.length - 1;
        const existing = next[isLeaf ? 'collections' : 'folders'].find(record => (record.parentId || null) === parentId && record.title.toLocaleLowerCase() === name.trim().toLocaleLowerCase());
        const containerId = existing?.id || merge(applyOperation(next, { type: isLeaf ? 'create-collection' : 'create-folder', id: `${isLeaf ? 'c' : 'f'}_res_${resourceId.slice(-40)}_${index}`, title: name, parentId }));
        if (isLeaf) destinationId = containerId;
        else parentId = containerId;
      }
      const classification = operation.classification || {};
      const organization = { method: string(classification.method || 'resource-import-v1', 'Classification method', 80), reason: string(classification.reason || '', 'Classification reason', 500), confidence: Math.max(0, Math.min(1, Number(classification.confidence) || 0)), destinationPath: chosen ? resourceFolderPath(catalog, chosen.id) : destination };
      const result = applyOperation(next, { type: 'add-block', block: { ...input, id: resourceId, organization }, body: operation.body || '', attachments: operation.attachments || [], collectionIds: destinationId ? [destinationId] : [] });
      merge(result);
      return { catalog: next, writes: [...allWrites.values()], entityId: resourceId, alreadySaved: false, destinationId };
    }
    case 'add-block': {
      const data = operation.block || {};
      entityId = id(data.id || newId('b'));
      if (catalog.blocks.some(b => b.id === entityId)) throw new Error('Material already exists.');
      const body = materialText(operation.body || '');
      const source = { ...(data.source || {}) };
      if (source.url) source.url = safeSourceUrl(source.url);
      const material = {
        schemaVersion: 1, id: entityId, type: data.type || 'link', title: title(data.title),
        source, description: string(data.description || '', 'Description'),
        category: normalizeCategory(data.category), tags: normalizeTags(data.tags),
        assets: data.assets || [], related: data.related || [],
        createdAt: now, updatedAt: now, path: `content/blocks/${entityId}/block.json`,
        body, summary: null,
        ...(body ? { bodyPath: 'body.md' } : {})
      };
      if (material.assets.length) throw new Error('Attach original files instead of supplying asset records.');
      const attachments = validatedAttachments(operation.attachments);
      material.assets = attachments.map(file => file.asset);
      if (attachments.length) {
        const original = attachments.find(file => file.asset.role === 'original');
        if (!original) throw new Error('An original file is required.');
        const expected = original.type === 'text' ? 'text' : original.type;
        if (material.type !== expected) throw new Error('The resource type does not match its original file.');
      }
      if (data.organization || attachments.length) material.ingest = { operationId: entityId };
      if (data.organization) material.organization = data.organization;
      const destinations = [...new Set(operation.collectionIds || [])];
      destinations.forEach(value => collection(value));
      catalog.blocks.push(material);
      record(material);
      for (const attachment of attachments) write(`${dir(material.path)}/${attachment.asset.path}`, attachment.data, 'base64');
      if (body) write(`${dir(material.path)}/body.md`, body);
      for (const value of destinations) { const c = collection(value); c.items.push({ kind: 'block', id: entityId }); record(c); }
      break;
    }
    case 'update-block': {
      const material = block(operation.id);
      const patch = operation.patch || {};
      for (const key of Object.keys(patch)) if (!['title', 'description', 'source', 'related', 'summary', 'category', 'tags'].includes(key)) throw new Error(`Cannot edit ${key}.`);
      if ('title' in patch) material.title = title(patch.title);
      if ('description' in patch) material.description = string(patch.description, 'Description');
      if ('category' in patch) material.category = normalizeCategory(patch.category);
      if ('tags' in patch) material.tags = normalizeTags(patch.tags);
      if ('source' in patch) material.source = { ...patch.source, ...(patch.source.url ? { url: safeSourceUrl(patch.source.url) } : {}) };
      if ('related' in patch) material.related = patch.related;
      if ('summary' in patch) {
        const summaryText = string(typeof patch.summary === 'string' ? patch.summary : patch.summary.text, 'Summary');
        if (summaryText !== (material.summary?.text || '')) {
          material.summary = { status: 'ready', text: summaryText, provider: 'manual', editedByOwner: true, generatedAt: now };
          write(`${dir(material.path)}/summary.json`, `${JSON.stringify(material.summary, null, 2)}\n`);
        }
      }
      if ('body' in operation && operation.body !== (material.body || '')) {
        material.body = materialText(operation.body);
        material.bodyPath ||= 'body.md';
        write(`${dir(material.path)}/${material.bodyPath}`, material.body);
      }
      if ('body' in operation || ['title', 'description', 'source', 'category', 'tags'].some(key => key in patch)) syncMarkdown(material);
      material.updatedAt = now;
      entityId = material.id;
      record(material);
      break;
    }
    case 'connect': {
      const material = block(operation.blockId);
      if ('taxonomy' in operation) {
        const taxonomy = operation.taxonomy;
        if (!taxonomy || typeof taxonomy !== 'object' || Array.isArray(taxonomy)) throw new Error('Connection taxonomy must contain category and tag fields.');
        if (Object.keys(taxonomy).some(key => !['category', 'tags'].includes(key))) throw new Error('Unknown connection taxonomy field.');
        if ('category' in taxonomy) material.category = normalizeCategory(taxonomy.category);
        if ('tags' in taxonomy) material.tags = normalizeTags(taxonomy.tags);
        if (Object.keys(taxonomy).length) { syncMarkdown(material); material.updatedAt = now; record(material); }
      }
      const destinations = new Set(operation.collectionIds || []);
      for (const value of destinations) collection(value);
      for (const c of catalog.collections) {
        const before = JSON.stringify(c.items);
        c.items = c.items.filter(item => !(item.kind === 'block' && item.id === material.id && !destinations.has(c.id)));
        if (destinations.has(c.id) && !c.items.some(item => item.kind === 'block' && item.id === material.id)) c.items.push({ kind: 'block', id: material.id });
        if (before !== JSON.stringify(c.items)) record(c);
      }
      entityId = material.id;
      break;
    }
    case 'create-folder':
    case 'create-collection': {
      const isFolder = operation.type === 'create-folder';
      const parent = operation.parentId ? catalog.folders.find(f => f.id === operation.parentId) : null;
      if (operation.parentId && !parent) throw new Error('Parent folder not found.');
      const name = title(operation.title);
      entityId = id(operation.id || newId(isFolder ? 'f' : 'c'));
      const base = parent ? dir(parent.path) : 'content/collections';
      let location = `${base}/${slug(name)}`;
      if ([...catalog.folders, ...catalog.collections].some(r => dir(r.path) === location)) location += `-${entityId.slice(-8)}`;
      const next = { schemaVersion: 1, id: entityId, title: name, description: string(operation.description || '', 'Description'), path: `${location}/${isFolder ? 'folder' : 'collection'}.json`, parentId: parent?.id || null, ...(isFolder ? {} : { items: operation.items || [] }) };
      (isFolder ? catalog.folders : catalog.collections).push(next);
      record(next);
      break;
    }
    case 'update-collection': {
      const c = collection(operation.id);
      let previousPath;
      if ('title' in operation) c.title = title(operation.title);
      if ('description' in operation) c.description = string(operation.description, 'Description');
      if ('items' in operation) c.items = operation.items;
      if ('parentId' in operation && (operation.parentId || null) !== (c.parentId || null)) {
        const parentId = operation.parentId || null;
        const parent = parentId ? catalog.folders.find(folder => folder.id === parentId) : null;
        if (parentId && !parent) throw new Error('Parent folder not found.');
        const base = parent ? dir(parent.path) : 'content/collections';
        const name = dir(c.path).split('/').at(-1);
        const occupied = location => [...catalog.folders, ...catalog.collections].some(record => record.id !== c.id && dir(record.path) === location);
        let location = `${base}/${name}`;
        if (occupied(location)) location = `${base}/${name}-${c.id}`;
        for (let suffix = 2; occupied(location); suffix++) location = `${base}/${name}-${c.id}-${suffix}`;
        previousPath = c.path;
        c.path = `${location}/collection.json`;
        c.parentId = parentId;
      }
      entityId = c.id;
      record(c);
      if (previousPath) write(previousPath, null);
      break;
    }
    case 'update-folder': {
      const folder = catalog.folders.find(f => f.id === operation.id);
      if (!folder) throw new Error('Folder not found.');
      if ('title' in operation) folder.title = title(operation.title);
      if ('description' in operation) folder.description = string(operation.description, 'Description');
      entityId = folder.id;
      record(folder);
      break;
    }
    case 'delete-block': {
      const material = block(operation.id);
      const prefix = `${dir(material.path)}/`;
      write(material.path, null);
      if (material.bodyPath) write(`${prefix}${material.bodyPath}`, null);
      if (material.summary) write(`${prefix}summary.json`, null);
      for (const asset of material.assets) write(`${prefix}${asset.path}`, null);
      for (const path of catalog.extraFiles || []) if (path.startsWith(prefix)) write(path, null);
      catalog.extraFiles = (catalog.extraFiles || []).filter(path => !path.startsWith(prefix));
      catalog.blocks = catalog.blocks.filter(b => b.id !== material.id);
      for (const board of catalog.library.canvases || []) {
        const removed = new Set(board.nodes.filter(node => node.kind === 'material' && node.blockId === material.id).map(node => node.id));
        if (!removed.size) continue;
        board.nodes = board.nodes.filter(node => !removed.has(node.id));
        board.edges = board.edges.filter(edge => !removed.has(edge.from) && !removed.has(edge.to));
        board.revision++; board.updatedAt = now;
        write('content/library.json', `${JSON.stringify(catalog.library, null, 2)}\n`);
      }
      for (const c of catalog.collections) {
        if (!c.items.some(item => item.kind === 'block' && item.id === material.id)) continue;
        c.items = c.items.filter(item => item.kind !== 'block' || item.id !== material.id);
        record(c);
      }
      for (const b of catalog.blocks) {
        const references = ref => (typeof ref === 'string' ? ref : ref.id) !== material.id;
        if (![...(b.related || []), ...(b.suggestedRelated || [])].some(ref => !references(ref))) continue;
        b.related = b.related.filter(references);
        if (b.suggestedRelated) b.suggestedRelated = b.suggestedRelated.filter(references);
        record(b);
      }
      entityId = material.id;
      break;
    }
    case 'delete-collection': {
      const c = collection(operation.id);
      if (c.id === catalog.library.inboxCollectionId) {
        delete catalog.library.inboxCollectionId;
        write('content/library.json', JSON.stringify(catalog.library, null, 2) + '\n');
      }
      catalog.collections = catalog.collections.filter(item => item.id !== c.id);
      for (const parent of catalog.collections) {
        if (!parent.items.some(item => item.kind === 'collection' && item.id === c.id)) continue;
        parent.items = parent.items.filter(item => item.kind !== 'collection' || item.id !== c.id);
        record(parent);
      }
      write(c.path, null);
      entityId = c.id;
      break;
    }
    case 'delete-folder': {
      const folder = catalog.folders.find(f => f.id === operation.id);
      if (!folder) throw new Error('Folder not found.');
      if ([...catalog.folders, ...catalog.collections].some(item => item.parentId === folder.id) || (catalog.extraFiles || []).some(path => path.startsWith(`${dir(folder.path)}/`))) throw new Error('Move or remove the contents before deleting this folder.');
      catalog.folders = catalog.folders.filter(f => f.id !== folder.id);
      write(folder.path, null);
      entityId = folder.id;
      break;
    }
    case 'remove-connection': {
      if (!['block', 'collection'].includes(operation.kind)) throw new Error('Unknown connection kind.');
      const c = collection(operation.collectionId);
      c.items = c.items.filter(item => !(item.kind === operation.kind && item.id === operation.id));
      record(c);
      break;
    }
    default: throw new Error('Unknown library operation.');
  }
  validateCatalog(catalog);
  for (const material of catalog.blocks) material.collectionIds = catalog.collections.filter(c => c.items.some(item => item.kind === 'block' && item.id === material.id)).map(c => c.id);
  for (const c of catalog.collections) c.collectionIds = catalog.collections.filter(parent => parent.items.some(item => item.kind === 'collection' && item.id === c.id)).map(parent => parent.id);
  return { catalog, writes: [...writes.values()], entityId };
}
