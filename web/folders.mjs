import { previewAsset } from './media.mjs';

/** Browse the physical hierarchy without flattening collections or duplicating materials. */
export function createFolderIndex(catalog) {
  const folders = new Map(catalog.folders.map(record => [record.id, record]));
  const collections = new Map(catalog.collections.map(record => [record.id, record]));
  const blocks = new Map(catalog.blocks.map(record => [record.id, record]));
  const children = new Map();
  for (const [kind, records] of [['folder', catalog.folders], ['collection', catalog.collections]]) {
    for (const record of records) {
      const parent = record.parentId || null;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push({ kind, record });
    }
  }
  const referenceURL = record => {
    if (!record?.source?.external && record?.source?.arena?.importScope !== 'reference') return '';
    try {
      const url = new URL(record.source.url);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  };
  const sort = (a, b) => (Number.isFinite(a.record.order) ? a.record.order : Infinity) - (Number.isFinite(b.record.order) ? b.record.order : Infinity) || a.record.title.localeCompare(b.record.title) || a.record.id.localeCompare(b.record.id);
  const cachedStats = new Map(), covers = new Map();

  function stats(kind, id) {
    const key = `${kind}:${id}`;
    if (cachedStats.has(key)) return cachedStats.get(key);
    const materialIds = new Set(), references = new Set(), visited = new Set();
    const pending = [{ kind, id }];
    while (pending.length) {
      const next = pending.pop();
      const key = `${next.kind}:${next.id}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (next.kind === 'folder') {
        for (const child of children.get(next.id) || []) pending.push({ kind: child.kind, id: child.record.id });
      } else {
        const collection = collections.get(next.id);
        if (!collection) continue;
        if (referenceURL(collection)) { references.add(collection.id); continue; }
        for (const item of collection.items || []) {
          if (item.kind === 'block' && blocks.has(item.id)) materialIds.add(item.id);
          else if (item.kind === 'collection') pending.push({ kind: 'collection', id: item.id });
        }
      }
    }
    const result = { materials: materialIds.size, links: references.size, empty: !materialIds.size && !references.size };
    const members = [...materialIds].map(id => blocks.get(id));
    const images = members.filter(block => previewAsset(block));
    const candidates = images.length >= 3 ? images : [...images, ...members.filter(block => !previewAsset(block))];
    const cover = candidates.length <= 3 ? candidates : [candidates[0], candidates[Math.floor(candidates.length / 2)], candidates.at(-1)];
    covers.set(key, cover);
    cachedStats.set(key, result);
    return result;
  }

  function contents(parentId = null, { showEmpty = false } = {}) {
    const entries = (children.get(parentId || null) || []).slice().sort(sort);
    const links = entries.filter(entry => entry.kind === 'collection' && referenceURL(entry.record));
    const local = entries.filter(entry => !links.includes(entry)).map(entry => ({ ...entry, ...stats(entry.kind, entry.record.id) }));
    return {
      folders: local.filter(entry => showEmpty || !entry.empty),
      links: links.map(entry => ({ ...entry.record, url: referenceURL(entry.record) })),
      hiddenEmpty: showEmpty ? 0 : local.filter(entry => entry.empty).length
    };
  }

  function ancestors(record) {
    const result = [], visited = new Set();
    let parent = folders.get(record?.parentId);
    while (parent && !visited.has(parent.id)) {
      visited.add(parent.id);
      result.unshift(parent);
      parent = folders.get(parent.parentId);
    }
    return result;
  }

  function cover(kind, id) {
    stats(kind, id);
    return covers.get(`${kind}:${id}`);
  }
  return { contents, stats, cover, ancestors, referenceURL };
}
