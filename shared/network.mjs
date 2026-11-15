const key = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const label = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
const DEFAULT_RELATIONS = ['tag', 'collection', 'related', 'suggested'];
const RELATION_ORDER = { related: 0, suggested: 1, tag: 2, category: 3, collection: 4 };
const clamp = (value, fallback, max) => Math.min(max, Math.max(1, Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallback));

/** Network browsing is for reading material. Preview images on links stay eligible. */
export const isNetworkMaterial = block => block?.type === 'link' || block?.type === 'text';

/** Curation suggestions stay distinct from the owner's explicit material links. */
export function relatedReadingSuggestions(block, catalog, { includeDocuments = false } = {}) {
  const eligible = item => isNetworkMaterial(item) || (includeDocuments && item?.type === 'file' &&
    (item.contentFormat === 'markdown' || (item.assets || []).some(asset => /^(?:application\/pdf|text\/(?:plain|markdown|x-markdown))$/i.test(asset.mimeType || '') || /\.(?:pdf|md|txt)$/i.test(asset.path || ''))));
  if (!eligible(block) || !Array.isArray(block.suggestedRelated)) return [];
  const blocks = new Map((catalog?.blocks || []).filter(eligible).map(item => [item.id, item]));
  const seen = new Set([block.id]);
  return block.suggestedRelated.flatMap(reference => {
    if (reference?.method !== 'curation-v1' || typeof reference.reason !== 'string' || !label(reference.reason) || !blocks.has(reference.id) || seen.has(reference.id)) return [];
    seen.add(reference.id);
    return [{ id: reference.id, method: reference.method, reason: label(reference.reason), block: blocks.get(reference.id) }];
  });
}

/**
 * Index the reading library once, then explore one reading at a time. Taxonomy
 * provides filters and context, rather than inventing pairwise relationships.
 */
export function createConnectionIndex(catalog) {
  const blocks = Array.isArray(catalog?.blocks) ? catalog.blocks.filter(isNetworkMaterial) : [];
  const sourceCollections = Array.isArray(catalog?.collections) ? catalog.collections : [];
  const nodes = [...new Map(blocks.filter(block => typeof block.id === 'string' && block.id).map(block => [block.id, {
    id: block.id, title: label(block.title) || 'Untitled reading', type: block.type,
    category: label(block.category) || 'Uncategorized',
    tags: [...new Map((Array.isArray(block.tags) ? block.tags : []).filter(tag => typeof tag === 'string' && key(tag)).map(tag => [key(tag), label(tag)])).values()],
    collectionIds: [], block,
  }])).values()];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const collections = [];
  const collectionNames = new Map();
  for (const collection of sourceCollections) {
    if (typeof collection.id !== 'string' || collectionNames.has(collection.id)) continue;
    const members = [...new Set((Array.isArray(collection.items) ? collection.items : []).filter(item => item.kind === 'block' && byId.has(item.id)).map(item => item.id))];
    if (!members.length) continue;
    const title = label(collection.title) || 'Untitled collection';
    collections.push({ id: collection.id, title });
    collectionNames.set(collection.id, title);
    for (const id of members) byId.get(id).collectionIds.push(collection.id);
  }
  collections.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const uniqueLabels = values => [...new Map(values.map(value => [key(value), value])).values()].sort((a, b) => a.localeCompare(b));
  const categories = uniqueLabels(nodes.map(node => node.category));
  const tags = uniqueLabels(nodes.flatMap(node => node.tags));
  const tagsById = new Map();
  const tagged = new Map();
  const searchable = new Map();
  const dates = new Map();
  const authored = new Map(nodes.map(node => [node.id, new Map()]));
  for (const node of nodes) {
    const tagKeys = new Set(node.tags.map(key));
    tagsById.set(node.id, tagKeys);
    for (const tag of tagKeys) {
      if (!tagged.has(tag)) tagged.set(tag, new Set());
      tagged.get(tag).add(node.id);
    }
    searchable.set(node.id, key([node.title, node.block.description, node.block.notes, node.block.body, node.block.summary?.text,
      node.block.source?.url, node.block.source?.arena?.originalTitle, node.category, ...node.tags].filter(Boolean).join(' ')));
    dates.set(node.id, Number.isFinite(Date.parse(node.block.createdAt)) ? Date.parse(node.block.createdAt) : 0);
  }
  function addReference(from, to, reason) {
    if (from === to || !byId.has(to)) return;
    for (const [source, target] of [[from, to], [to, from]]) {
      const neighbours = authored.get(source);
      if (!neighbours.has(target)) neighbours.set(target, []);
      const reasons = neighbours.get(target);
      if (!reasons.some(item => item.type === reason.type && item.from === reason.from && item.to === reason.to && item.label === reason.label)) reasons.push(reason);
    }
  }
  for (const node of nodes) {
    for (const reference of Array.isArray(node.block.related) ? node.block.related : []) {
      const to = typeof reference === 'string' ? reference : reference?.id;
      addReference(node.id, to, { type: 'related', label: 'Explicit link', from: node.id, to });
    }
    const seen = new Set([node.id]);
    for (const reference of Array.isArray(node.block.suggestedRelated) ? node.block.suggestedRelated : []) {
      if (reference?.method !== 'curation-v1' || typeof reference.reason !== 'string' || !label(reference.reason) || !byId.has(reference.id) || seen.has(reference.id)) continue;
      seen.add(reference.id);
      addReference(node.id, reference.id, { type: 'suggested', label: label(reference.reason), method: reference.method, from: node.id, to: reference.id });
    }
  }
  const compareTitles = (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  const compareRecent = (a, b) => dates.get(b.id) - dates.get(a.id) || compareTitles(a, b);
  const limitFor = (value, fallback) => clamp(value, fallback, Math.max(1, nodes.length));
  function matches(node, options) {
    return (!options.category || key(node.category) === key(options.category)) &&
      (!options.tag || tagsById.get(node.id).has(key(options.tag))) &&
      (!options.collection || node.collectionIds.includes(options.collection));
  }
  function search(options = {}) {
    const query = key(options.query);
    const words = query.split(' ').filter(Boolean);
    const titleScore = node => Number(key(node.title) === query) * 100 + Number(key(node.title).includes(query)) * 10 + words.filter(word => key(node.title).includes(word)).length;
    const results = nodes.filter(node => matches(node, options) && words.every(word => searchable.get(node.id).includes(word)))
      .sort((a, b) => (query ? titleScore(b) - titleScore(a) : 0) || compareRecent(a, b));
    return { nodes: results.slice(0, limitFor(options.limit, 6)), total: results.length };
  }
  function connections(focusId, options = {}) {
    const focus = byId.get(focusId);
    if (!focus) return { focus: null, connections: [], total: 0 };
    const candidates = new Set(authored.get(focusId).keys());
    for (const tag of tagsById.get(focusId)) for (const id of tagged.get(tag)) if (id !== focusId) candidates.add(id);
    const results = [];
    for (const id of candidates) {
      const node = byId.get(id);
      if (!matches(node, options)) continue;
      const reasons = (authored.get(focusId).get(id) || []).map(reason => ({ ...reason }));
      let tagScore = 0;
      for (const tag of focus.tags) {
        const tagKey = key(tag);
        if (!tagsById.get(id).has(tagKey)) continue;
        tagScore += 1 + Math.log((nodes.length + 1) / (tagged.get(tagKey).size + 1));
        reasons.push({ type: 'tag', label: tag });
      }
      if (key(focus.category) !== 'uncategorized' && key(focus.category) === key(node.category)) reasons.push({ type: 'category', label: focus.category });
      for (const collection of focus.collectionIds) if (node.collectionIds.includes(collection)) reasons.push({ type: 'collection', label: collectionNames.get(collection) });
      reasons.sort((a, b) => RELATION_ORDER[a.type] - RELATION_ORDER[b.type] || a.label.localeCompare(b.label) || String(a.from || '').localeCompare(String(b.from || '')));
      const kind = reasons.some(reason => reason.type === 'related') ? 'related' : reasons.some(reason => reason.type === 'suggested') ? 'suggested' : 'tag';
      const score = (kind === 'related' ? 2000 : kind === 'suggested' ? 1000 : 0) + 999 * tagScore / (tagScore + 999);
      results.push({ node, reasons, kind, score });
    }
    results.sort((a, b) => RELATION_ORDER[a.kind] - RELATION_ORDER[b.kind] || b.score - a.score || compareTitles(a.node, b.node));
    return { focus, connections: results.slice(0, limitFor(options.limit, 8)), total: results.length };
  }
  return { nodes, categories, tags, collections, search, connections };
}

/** A bounded, deterministic material graph. Every edge retains its actual reasons. */
export function buildNetwork(catalog, options = {}) {
  const blocks = Array.isArray(catalog?.blocks) ? catalog.blocks.filter(isNetworkMaterial) : [];
  const collections = Array.isArray(catalog?.collections) ? catalog.collections : [];
  const relations = new Set(options.relations || DEFAULT_RELATIONS);
  const memberships = new Map(blocks.map(block => [block.id, []]));
  for (const collection of collections) {
    for (const item of collection.items || []) {
      if (item.kind === 'block') memberships.get(item.id)?.push({ id: collection.id, title: collection.title });
    }
  }
  const words = key(options.query).split(' ').filter(Boolean);
  const matches = blocks.filter(block => {
    const category = label(block.category) || 'Uncategorized';
    const tags = Array.isArray(block.tags) ? block.tags.filter(tag => typeof tag === 'string') : [];
    return (!options.category || key(category) === key(options.category)) &&
      (!options.tag || tags.some(tag => key(tag) === key(options.tag))) &&
      (!options.collection || memberships.get(block.id).some(collection => collection.id === options.collection)) &&
      words.every(word => key([block.title, block.description, block.body, block.summary?.text, category, ...tags].join(' ')).includes(word));
  }).sort((a, b) => String(a.title).localeCompare(String(b.title)) || String(a.id).localeCompare(String(b.id)));
  const limit = clamp(options.limit, 200, 200);
  const maxEdges = clamp(options.maxEdges, 1200, 4000);
  const selected = matches.slice(0, limit);
  const focus = options.focus && matches.find(block => block.id === options.focus);
  if (focus && !selected.some(block => block.id === focus.id)) {
    selected[selected.length - 1] = focus;
    selected.sort((a, b) => String(a.title).localeCompare(String(b.title)) || String(a.id).localeCompare(String(b.id)));
  }
  const nodes = selected.map(block => ({
    id: block.id, title: block.title, type: block.type,
    category: label(block.category) || 'Uncategorized',
    tags: [...new Map((Array.isArray(block.tags) ? block.tags : []).filter(tag => typeof tag === 'string').map(tag => [key(tag), label(tag)])).values()],
    collectionIds: [...new Set(memberships.get(block.id).map(collection => collection.id))],
    block,
  }));
  const nodeIds = new Set(nodes.map(node => node.id));
  const pairs = new Map();
  function connect(a, b, reason) {
    if (a === b || !nodeIds.has(a) || !nodeIds.has(b)) return;
    const [source, target] = [a, b].sort();
    const id = JSON.stringify([source, target]);
    let edge = pairs.get(id);
    if (!edge) { edge = { id, source, target, reasons: [], _keys: new Set() }; pairs.set(id, edge); }
    const reasonKey = JSON.stringify([reason.type, reason.label, reason.from, reason.to]);
    if (!edge._keys.has(reasonKey)) { edge._keys.add(reasonKey); edge.reasons.push(reason); }
  }
  function shared(groups, type) {
    for (const group of groups.values()) {
      for (let a = 0; a < group.ids.length; a++) {
        for (let b = a + 1; b < group.ids.length; b++) connect(group.ids[a], group.ids[b], { type, label: group.label });
      }
    }
  }
  if (relations.has('related')) {
    for (const node of nodes) {
      for (const reference of node.block.related || []) {
        const target = typeof reference === 'string' ? reference : reference?.id;
        connect(node.id, target, { type: 'related', label: 'Explicit link', from: node.id, to: target });
      }
    }
  }
  if (relations.has('suggested')) {
    for (const node of nodes) for (const reference of relatedReadingSuggestions(node.block, catalog)) {
      connect(node.id, reference.id, { type: 'suggested', label: reference.reason, method: reference.method, from: node.id, to: reference.id });
    }
  }
  if (relations.has('tag')) {
    const groups = new Map();
    for (const node of nodes) for (const tag of node.tags) {
      const tagKey = key(tag);
      if (!tagKey) continue;
      if (!groups.has(tagKey)) groups.set(tagKey, { ids: [], label: tag });
      groups.get(tagKey).ids.push(node.id);
    }
    shared(groups, 'tag');
  }
  if (relations.has('category')) {
    const groups = new Map();
    for (const node of nodes) {
      const categoryKey = key(node.category);
      // Missing classifications do not create a misleading relationship.
      if (!categoryKey || categoryKey === 'uncategorized') continue;
      if (!groups.has(categoryKey)) groups.set(categoryKey, { ids: [], label: node.category });
      groups.get(categoryKey).ids.push(node.id);
    }
    shared(groups, 'category');
  }
  if (relations.has('collection')) {
    for (const collection of collections) {
      const ids = [...new Set((collection.items || []).filter(item => item.kind === 'block' && nodeIds.has(item.id)).map(item => item.id))];
      shared(new Map([[collection.id, { ids, label: collection.title }]]), 'collection');
    }
  }
  const allEdges = [...pairs.values()].map(({ _keys, ...edge }) => ({
    ...edge,
    reasons: edge.reasons.sort((a, b) => RELATION_ORDER[a.type] - RELATION_ORDER[b.type] || a.label.localeCompare(b.label) || String(a.from || '').localeCompare(String(b.from || ''))),
  })).sort((a, b) => {
    const focused = edge => options.focus && (edge.source === options.focus || edge.target === options.focus) ? 0 : 1;
    const explicit = edge => edge.reasons.some(reason => reason.type === 'related') ? 0 : 1;
    return focused(a) - focused(b) || explicit(a) - explicit(b) || a.source.localeCompare(b.source) || a.target.localeCompare(b.target);
  });
  return {
    nodes, edges: allEdges.slice(0, maxEdges), total: matches.length,
    truncated: matches.length > nodes.length,
    totalEdges: allEdges.length, edgesTruncated: allEdges.length > maxEdges,
  };
}

export const networkDefaults = Object.freeze({ relations: Object.freeze([...DEFAULT_RELATIONS]), limit: 200, maxEdges: 1200 });

/** Stable concentric positions: no simulation, boundary clamping, or idle animation. */
export function layoutNetwork(nodes, { width = 840, height = 680 } = {}) {
  width = Math.max(720, Number(width) || 840);
  height = Math.max(620, Number(height) || 680);
  const center = { x: width / 2, y: height / 2 };
  const count = nodes.length;
  const positions = new Map();
  if (!count) return { width, height, center, positions, rings: [] };
  const ringCount = count === 1 ? 1 : Math.max(2, Math.min(7, Math.ceil(Math.sqrt(count / 4))));
  const outer = Math.min(width / 2 - 84, height / 2 - 70);
  const inner = count < 10 ? outer * .62 : Math.max(40, outer * .2);
  const rings = Array.from({ length: ringCount }, (_, index) => ({
    radius: ringCount === 1 ? 0 : inner + (outer - inner) * index / (ringCount - 1),
    count: 0,
  }));
  const weight = rings.reduce((sum, ring) => sum + Math.max(inner, ring.radius), 0);
  let allocated = 0;
  for (const ring of rings) { ring.count = Math.floor(count * Math.max(inner, ring.radius) / weight); allocated += ring.count; }
  for (let remaining = count - allocated, index = rings.length - 1; remaining > 0; remaining--, index = (index - 1 + rings.length) % rings.length) rings[index].count++;
  const ordered = [...nodes].sort((a, b) => key(a.category).localeCompare(key(b.category)) || String(a.title).localeCompare(String(b.title)) || a.id.localeCompare(b.id));
  // Interleaving the rings keeps each category in an angular sector, with room
  // between adjacent rings even when every material shares the same taxonomy.
  const slots = rings.flatMap((ring, ringIndex) => Array.from({ length: ring.count }, (_, index) => ({
    ring: ringIndex,
    angle: (index + .5 * (ringIndex % 2)) / Math.max(1, ring.count) * Math.PI * 2 - Math.PI / 2,
  }))).sort((a, b) => a.angle - b.angle || a.ring - b.ring);
  ordered.forEach((node, index) => {
    const slot = slots[index], radius = rings[slot.ring].radius;
    positions.set(node.id, { x: center.x + Math.cos(slot.angle) * radius, y: center.y + Math.sin(slot.angle) * radius, ring: slot.ring, angle: slot.angle });
  });
  return { width, height, center, positions, rings };
}

/** A real, sparse spanning forest for the overview; no synthetic relationships. */
export function overviewConnections(nodes, edges, positions) {
  const parents = new Map(nodes.map(node => [node.id, node.id]));
  const root = id => { let value = id; while (parents.get(value) !== value) value = parents.get(value); return value; };
  const selected = new Set();
  const distance = edge => positions?.has(edge.source) && positions?.has(edge.target)
    ? Math.hypot(positions.get(edge.source).x - positions.get(edge.target).x, positions.get(edge.source).y - positions.get(edge.target).y) : 0;
  const ordered = [...edges].sort((a, b) => {
    const explicit = edge => edge.reasons.some(reason => reason.type === 'related') ? 0 : 1;
    return explicit(a) - explicit(b) || distance(a) - distance(b) || a.id.localeCompare(b.id);
  });
  for (const edge of ordered) {
    if (!parents.has(edge.source) || !parents.has(edge.target)) continue;
    const a = root(edge.source), b = root(edge.target);
    if (a === b) continue;
    parents.set(a, b); selected.add(edge.id);
    if (selected.size >= Math.min(40, Math.max(0, nodes.length - 1))) break;
  }
  return selected;
}
