import { canonicalRecord } from './model.mjs';
import { normalizeCategory, normalizeTags } from './taxonomy.mjs';
const jsonText = object => `${JSON.stringify(object, null, 2)}\n`;
const directory = path => path.slice(0, path.lastIndexOf('/'));
const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const equal = (a, b) => stable(a) === stable(b);

export function intendedOperation(catalog, input) {
  const operation = structuredClone(input);
  if (operation.type === 'update-block') {
    const original = catalog.blocks.find(b => b.id === operation.id);
    for (const key of Object.keys(operation.patch || {})) {
      const before = key === 'summary' ? original?.summary?.text || '' : original?.[key];
      if (equal(operation.patch[key], before)) delete operation.patch[key];
    }
    if ('body' in operation && operation.body === (original?.body || '')) delete operation.body;
  }
  if (['update-collection', 'update-folder'].includes(operation.type)) {
    const original = catalog[operation.type === 'update-folder' ? 'folders' : 'collections'].find(c => c.id === operation.id);
    for (const key of ['title', 'description', 'items', 'parentId']) if (key in operation && equal(operation[key], original?.[key])) delete operation[key];
  }
  if (operation.type === 'connect' && operation.taxonomy && typeof operation.taxonomy === 'object' && !Array.isArray(operation.taxonomy)) {
    const original = catalog.blocks.find(block => block.id === operation.blockId);
    for (const key of Object.keys(operation.taxonomy)) {
      if (!['category', 'tags'].includes(key)) continue;
      const normalize = key === 'category' ? normalizeCategory : normalizeTags;
      operation.taxonomy[key] = normalize(operation.taxonomy[key]);
      if (equal(operation.taxonomy[key], normalize(original?.[key]))) delete operation.taxonomy[key];
    }
    if (!Object.keys(operation.taxonomy).length) delete operation.taxonomy;
  }
  return operation;
}

export function assertNoExternalConflict(before, current, operation) {
  const conflict = () => { throw new Error('This item changed outside Charta. Reload the latest library before saving. Your open form has been kept.'); };
  if (operation.type === 'update-block' || operation.type === 'update-collection') {
    const records = operation.type === 'update-block' ? 'blocks' : 'collections';
    const old = before[records].find(record => record.id === operation.id);
    const latest = current[records].find(record => record.id === operation.id);
    if (!old || !latest) conflict();
    const changes = operation.type === 'update-block' ? { ...(operation.patch || {}), ...('body' in operation ? { body: operation.body } : {}) } : Object.fromEntries(['title', 'description', 'items', 'parentId'].filter(key => key in operation).map(key => [key, operation[key]]));
    for (const [key, value] of Object.entries(changes)) {
      const oldValue = key === 'summary' ? old.summary?.text || '' : old[key];
      const latestValue = key === 'summary' ? latest.summary?.text || '' : latest[key];
      if (!equal(oldValue, latestValue) && !equal(value, latestValue)) conflict();
    }
  }
  if (['save-canvas', 'delete-canvas'].includes(operation.type)) {
    const old = before.library.canvases?.find(board => board.id === operation.id);
    const latest = current.library.canvases?.find(board => board.id === operation.id);
    if (!old || !latest || old.revision !== latest.revision) conflict();
  }
  if (operation.type === 'update-folder' || (operation.type.startsWith('delete-') && operation.type !== 'delete-canvas')) {
    const kind = operation.type.endsWith('block') ? 'blocks' : operation.type.endsWith('collection') ? 'collections' : 'folders';
    const old = before[kind].find(record => record.id === operation.id);
    const latest = current[kind].find(record => record.id === operation.id);
    const persisted = record => ({ ...canonicalRecord(record), path: record.path, parentId: record.parentId, body: record.body, summary: record.summary });
    if (!old || !latest || !equal(persisted(old), persisted(latest))) conflict();
  }
  if (operation.type === 'connect') {
    const memberships = catalog => catalog.collections.filter(c => c.items.some(item => item.kind === 'block' && item.id === operation.blockId)).map(c => c.id).sort();
    const original = memberships(before), latest = memberships(current), desired = [...new Set(operation.collectionIds)].sort();
    if (!equal(original, latest) && !equal(latest, desired)) conflict();
    if (operation.taxonomy) {
      const oldBlock = before.blocks.find(block => block.id === operation.blockId);
      const currentBlock = current.blocks.find(block => block.id === operation.blockId);
      if (!oldBlock || !currentBlock) conflict();
      for (const [key, value] of Object.entries(operation.taxonomy)) {
        if (!equal(oldBlock[key], currentBlock[key]) && !equal(value, currentBlock[key])) conflict();
      }
    }
  }
}

export function canonicalFiles(catalog) {
  const files = new Map([['content/library.json', jsonText(catalog.library)]]);
  for (const record of [...catalog.folders, ...catalog.collections, ...catalog.blocks]) files.set(record.path, jsonText(canonicalRecord(record)));
  for (const block of catalog.blocks) {
    if (block.bodyPath) files.set(`${directory(block.path)}/${block.bodyPath}`, block.body || '');
    if (block.summary) files.set(`${directory(block.path)}/summary.json`, jsonText(block.summary));
  }
  return files;
}


/** The records needed to detect conflicts, without resending the whole archive. */
export function operationBase(catalog, operation) {
  const base = { library: {}, blocks: [], collections: [], folders: [] };
  const copy = record => ({ ...canonicalRecord(record), path: record.path, parentId: record.parentId, body: record.body, summary: record.summary });
  const targetId = operation.id || operation.blockId;
  for (const kind of ['blocks', 'collections', 'folders']) {
    base[kind] = catalog[kind].filter(record => record.id === targetId).map(copy);
  }
  if (operation.type === 'connect') {
    base.collections = catalog.collections.filter(collection => collection.items.some(item => item.kind === 'block' && item.id === operation.blockId))
      .map(collection => ({ id: collection.id, items: [{ kind: 'block', id: operation.blockId }] }));
  }
  if (['save-canvas', 'delete-canvas'].includes(operation.type)) {
    base.library.canvases = (catalog.library.canvases || []).filter(board => board.id === operation.id).map(board => ({ id: board.id, revision: board.revision }));
  }
  return base;
}
