import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNetwork, createConnectionIndex, isNetworkMaterial, layoutNetwork, overviewConnections, relatedReadingSuggestions } from '../shared/network.mjs';

const fixture = () => ({
  blocks: [
    { id: 'a', title: 'Alpha', type: 'link', category: 'Design', tags: ['collecting', 'Personal web'], related: ['b'], description: 'A living library' },
    { id: 'b', title: 'Beta', type: 'text', category: 'design', tags: ['COLLECTING'], related: ['a'] },
    { id: 'c', title: 'Gamma', type: 'text', category: 'Art', tags: ['color'], related: [] },
    { id: 'd', title: 'Delta', type: 'link', related: [] },
  ],
  collections: [{ id: 'c_one', title: 'Reading room', items: [{ kind: 'block', id: 'a' }, { kind: 'block', id: 'b' }, { kind: 'collection', id: 'c_two' }] }],
});

test('one edge retains shared tag, category, collection, and explicit directions', () => {
  const graph = buildNetwork(fixture(), { relations: ['tag', 'category', 'collection', 'related'] });
  assert.equal(graph.nodes.length, 4);
  assert.equal(graph.edges.length, 1);
  const edge = graph.edges[0];
  assert.equal(edge.source, 'a'); assert.equal(edge.target, 'b');
  assert.deepEqual(new Set(edge.reasons.map(reason => reason.type)), new Set(['tag', 'category', 'collection', 'related']));
  const direct = edge.reasons.filter(reason => reason.type === 'related');
  assert.equal(direct.length, 2);
  assert.deepEqual(direct.map(reason => [reason.from, reason.to]), [['a', 'b'], ['b', 'a']]);
  assert.ok(edge.reasons.some(reason => reason.type === 'collection' && reason.label === 'Reading room'));
});

test('filters apply before graph limits, with case-insensitive tags, categories, and search', () => {
  const library = fixture();
  assert.equal(buildNetwork(library, { category: 'DESIGN' }).nodes.length, 2);
  assert.equal(buildNetwork(library, { tag: ' collecting ' }).nodes.length, 2);
  assert.equal(buildNetwork(library, { collection: 'c_one' }).nodes.length, 2);
  assert.deepEqual(buildNetwork(library, { query: 'LIVING personal' }).nodes.map(node => node.id), ['a']);
  assert.equal(buildNetwork(library, { category: 'Art', tag: 'collecting' }).nodes.length, 0);
  assert.deepEqual(buildNetwork(library, { category: 'Art', limit: 1 }).nodes.map(node => node.id), ['c']);
});

test('disabled relations and missing taxonomy do not invent connections', () => {
  const library = fixture();
  assert.equal(buildNetwork(library, { relations: [] }).edges.length, 0);
  const graph = buildNetwork({ blocks: [{ id: 'a', title: 'Old A', type: 'link' }, { id: 'b', title: 'Old B', type: 'text' }], collections: [] }, { relations: ['category'] });
  assert.equal(graph.edges.length, 0);
  assert.ok(graph.nodes.every(node => node.category === 'Uncategorized'));
  assert.equal(buildNetwork({ blocks: [], collections: [] }).total, 0);
});

test('curated reading suggestions keep their reasons distinct from authored links and reject media targets', () => {
  const library = fixture();
  library.blocks.push({ id: 'image', type: 'image', title: 'A visual reference' });
  library.blocks[0].suggestedRelated = [
    { id: 'b', reason: 'Both explore personal archives.', method: 'curation-v1' },
    { id: 'b', reason: 'Duplicate target', method: 'curation-v1' },
    { id: 'image', reason: 'An image cannot enter the reading graph.', method: 'curation-v1' },
    { id: 'a', reason: 'No self links', method: 'curation-v1' },
    { id: 'c', reason: 'Unknown provenance', method: 'embedding' },
  ];
  const before = structuredClone(library);
  assert.deepEqual(relatedReadingSuggestions(library.blocks[0], library).map(item => item.id), ['b']);
  const graph = buildNetwork(library, { relations: ['related', 'suggested'] });
  const edge = graph.edges.find(edge => edge.source === 'a' && edge.target === 'b');
  assert.equal(edge.reasons.filter(reason => reason.type === 'related').length, 2, 'existing authored directions stay authored');
  assert.deepEqual(edge.reasons.find(reason => reason.type === 'suggested'), { type: 'suggested', label: 'Both explore personal archives.', method: 'curation-v1', from: 'a', to: 'b' });
  assert.ok(graph.nodes.every(node => node.id !== 'image'));
  assert.ok(buildNetwork(library, { relations: ['related'] }).edges.every(edge => edge.reasons.every(reason => reason.type !== 'suggested')), 'suggestions have an independent filter');
  assert.deepEqual(library, before, 'browsing does not merge suggestions into authored references');
});

test('drawer suggestions include saved PDF and text documents while the reading network remains text and links only', () => {
  const suggest = id => ({ id, reason: 'A related saved document.', method: 'curation-v1' });
  const library = { blocks: [
    { id: 'article', type: 'link', title: 'An article', suggestedRelated: [suggest('pdf'), suggest('textfile'), suggest('image')] },
    { id: 'pdf', type: 'file', title: 'A book', assets: [{ path: 'assets/book.pdf', mimeType: 'application/pdf' }], suggestedRelated: [suggest('article'), suggest('textfile')] },
    { id: 'textfile', type: 'file', title: 'Saved text', assets: [{ path: 'assets/document.txt', mimeType: 'text/plain' }] },
    { id: 'image', type: 'image', title: 'A cover', assets: [{ path: 'assets/cover.jpg', mimeType: 'image/jpeg' }] },
  ], collections: [] };
  assert.deepEqual(relatedReadingSuggestions(library.blocks[0], library, { includeDocuments: true }).map(item => item.id), ['pdf', 'textfile']);
  assert.deepEqual(relatedReadingSuggestions(library.blocks[1], library, { includeDocuments: true }).map(item => item.id), ['article', 'textfile']);
  assert.deepEqual(relatedReadingSuggestions(library.blocks[3], library, { includeDocuments: true }), [], 'an image cannot become a reading source');
  assert.deepEqual(relatedReadingSuggestions(library.blocks[0], library), [], 'document inclusion is explicit and applies only to the drawer');
  const graph = buildNetwork(library);
  assert.deepEqual(graph.nodes.map(node => node.id), ['article']);
  assert.deepEqual(graph.edges, [], 'PDF suggestions do not add document nodes or synthetic bridges to the network');
});

test('graph caps are explicit and prioritize existing links over dense shared relations', () => {
  const library = { blocks: Array.from({ length: 205 }, (_, index) => ({ id: `n_${String(index).padStart(3, '0')}`, title: `Material ${String(index).padStart(3, '0')}`, type: 'link', tags: ['everything'], related: index === 199 ? ['n_198'] : [] })), collections: [] };
  const graph = buildNetwork(library, { maxEdges: 5 });
  assert.equal(graph.nodes.length, 200);
  assert.equal(graph.total, 205);
  assert.equal(graph.truncated, true);
  assert.equal(graph.edges.length, 5);
  assert.equal(graph.totalEdges, 19900);
  assert.equal(graph.edgesTruncated, true);
  assert.ok(graph.edges[0].reasons.some(reason => reason.type === 'related'));
});

test('graph output is deterministic without changing source records', () => {
  const library = fixture();
  const original = structuredClone(library);
  const first = buildNetwork(library);
  assert.deepEqual(buildNetwork(library), first);
  assert.deepEqual(library, original);
  assert.equal(new Set(first.edges.map(edge => edge.id)).size, first.edges.length);
  assert.ok(first.nodes.some(node => node.id === 'd'), 'disconnected material remains visible');
});

test('focused material remains in a bounded view when it matches the filters', () => {
  const library = { blocks: Array.from({ length: 205 }, (_, index) => ({ id: `n_${String(index).padStart(3, '0')}`, title: `Material ${String(index).padStart(3, '0')}`, type: 'link', category: index === 204 ? 'Art' : 'Design', tags: [], related: [] })), collections: [] };
  const graph = buildNetwork(library, { focus: 'n_204' });
  assert.equal(graph.nodes.length, 200);
  assert.equal(graph.total, 205);
  assert.ok(graph.nodes.some(node => node.id === 'n_204'));
  assert.equal(new Set(graph.nodes.map(node => node.id)).size, 200);
  const filtered = buildNetwork(library, { focus: 'n_204', category: 'Design' });
  assert.equal(filtered.nodes.some(node => node.id === 'n_204'), false);
});

test('only links and text enter the network before limits, filters, and edge construction', () => {
  const library = fixture();
  const media = ['image', 'file', 'video', 'audio'].map((type, index) => ({ id: `media_${index}`, title: `00 ${type}`, type, category: 'Media only', tags: ['media-only'], related: ['a', 'b'] }));
  library.blocks.unshift(...media);
  library.blocks[4].assets = [{ role: 'thumbnail', mime: 'image/jpeg', path: 'thumbnail.jpg' }];
  library.blocks[4].related = [...library.blocks[4].related, 'media_0'];
  library.collections[0].items.unshift(...media.map(item => ({ kind: 'block', id: item.id })));
  const original = structuredClone(library);
  const graph = buildNetwork(library, { limit: 2, focus: 'media_0', relations: ['related'] });
  assert.deepEqual(graph.nodes.map(node => node.id), ['a', 'b']);
  assert.equal(graph.total, 4, 'media does not consume the bounded reading view');
  assert.equal(graph.edges.length, 1);
  assert.ok(graph.nodes.every(node => isNetworkMaterial(node.block)));
  assert.equal(graph.nodes[0].block.assets[0].role, 'thumbnail', 'article preview images do not turn links into image records');
  assert.equal(buildNetwork(library, { tag: 'media-only' }).total, 0);
  assert.equal(buildNetwork(library, { category: 'Media only' }).total, 0);
  assert.deepEqual(library, original, 'the image archive remains untouched');
  const bridge = buildNetwork({ blocks: [{ id: 'a', type: 'link', title: 'A', related: ['image'] }, { id: 'image', type: 'image', title: 'I', related: ['b'] }, { id: 'b', type: 'text', title: 'B' }], collections: [] }, { relations: ['related'] });
  assert.equal(bridge.edges.length, 0, 'excluded media cannot form a synthetic bridge');
});

test('a selected reading retains its complete neighborhood within the edge cap', () => {
  const library = { blocks: Array.from({ length: 200 }, (_, index) => ({ id: `n_${String(index).padStart(3, '0')}`, title: `Reading ${index}`, type: 'link', tags: ['everything'] })), collections: [] };
  const graph = buildNetwork(library, { focus: 'n_199' });
  assert.equal(graph.edgesTruncated, true);
  assert.equal(graph.totalEdges, 19900);
  assert.equal(graph.edges.filter(edge => edge.source === 'n_199' || edge.target === 'n_199').length, 199);
});

test('orbital positions are deterministic, spaced, and never clamped to a rectangular perimeter', () => {
  const nodes = Array.from({ length: 200 }, (_, index) => ({ id: `n_${index}`, title: `Reading ${index}`, category: index % 3 ? 'Design' : 'Technology' }));
  const before = structuredClone(nodes);
  const result = layoutNetwork(nodes, { width: 800, height: 640 });
  assert.deepEqual(layoutNetwork([...nodes].reverse(), { width: 800, height: 640 }), result);
  assert.deepEqual(nodes, before);
  assert.equal(result.positions.size, 200);
  assert.equal(result.rings.reduce((sum, ring) => sum + ring.count, 0), 200);
  assert.ok(result.rings.length > 3);
  for (const position of result.positions.values()) {
    assert.ok(position.x > 30 && position.x < result.width - 30);
    assert.ok(position.y > 30 && position.y < result.height - 30);
    assert.ok(Math.abs(Math.hypot(position.x - result.center.x, position.y - result.center.y) - result.rings[position.ring].radius) < .00001);
  }
  const values = [...result.positions.values()];
  for (let a = 0; a < values.length; a++) for (let b = a + 1; b < values.length; b++) assert.ok(Math.hypot(values[a].x - values[b].x, values[a].y - values[b].y) > 18, 'different readings must not collapse onto one point');
  const mobile = layoutNetwork(nodes, { width: 300, height: 430 });
  assert.ok(mobile.width >= 720, 'narrow displays fit a zoomable diagram rather than squeezing nodes onto the edges');
});

test('overview draws a bounded forest using actual connections without losing detailed edges', () => {
  const graph = buildNetwork({ blocks: Array.from({ length: 80 }, (_, index) => ({ id: `n_${index}`, title: `Reading ${index}`, type: 'link', tags: ['shared'] })), collections: [] });
  const layout = layoutNetwork(graph.nodes);
  const visible = overviewConnections(graph.nodes, graph.edges, layout.positions);
  assert.equal(visible.size, 40);
  assert.ok([...visible].every(id => graph.edges.some(edge => edge.id === id)));
  assert.ok(graph.edges.length > visible.size, 'overview decluttering does not remove inspectable relationships');
  const parents = new Map(graph.nodes.map(node => [node.id, node.id]));
  const root = id => parents.get(id) === id ? id : root(parents.get(id));
  for (const edge of graph.edges.filter(edge => visible.has(edge.id))) {
    const a = root(edge.source), b = root(edge.target);
    assert.notEqual(a, b, 'overview connections cannot form a dense clique');
    parents.set(a, b);
  }
});

test('focused connections rank the complete library before the display limit and retain both authored directions', () => {
  const library = { blocks: Array.from({ length: 260 }, (_, index) => ({
    id: `n_${String(index).padStart(3, '0')}`, title: `Reading ${String(index).padStart(3, '0')}`, type: 'link', tags: ['common'],
  })), collections: [] };
  library.blocks[0].related = ['n_259'];
  library.blocks[259].related = ['n_000'];
  library.blocks[258].suggestedRelated = [{ id: 'n_000', reason: 'A reviewed connection from the end of the library.', method: 'curation-v1' }];
  const index = createConnectionIndex(library);
  const result = index.connections('n_000');
  assert.equal(result.focus.id, 'n_000');
  assert.equal(result.connections.length, 8);
  assert.equal(result.total, 259);
  assert.deepEqual(result.connections.slice(0, 2).map(item => [item.node.id, item.kind]), [['n_259', 'related'], ['n_258', 'suggested']]);
  assert.deepEqual(result.connections[0].reasons.filter(reason => reason.type === 'related').map(reason => [reason.from, reason.to]), [['n_000', 'n_259'], ['n_259', 'n_000']]);
  assert.deepEqual(result.connections[1].reasons.find(reason => reason.type === 'suggested'), {
    type: 'suggested', label: 'A reviewed connection from the end of the library.', method: 'curation-v1', from: 'n_258', to: 'n_000',
  });
  assert.equal(index.connections('n_000', { limit: 260 }).connections.length, 259, 'show more can reach the entire neighborhood');
});

test('specific shared tags outrank broad ones and multiple independent overlaps improve relevance', () => {
  const library = { blocks: [
    { id: 'focus', title: 'Focus', type: 'text', tags: ['common', 'rare', 'publishing'] },
    { id: 'broad', title: 'A broad match', type: 'link', tags: ['common'] },
    { id: 'specific', title: 'Z specific match', type: 'link', tags: ['rare'] },
    { id: 'multiple', title: 'Multiple overlaps', type: 'link', tags: ['rare', 'publishing', 'RARE'] },
    ...Array.from({ length: 20 }, (_, index) => ({ id: `filler_${index}`, title: `Filler ${index}`, type: 'link', tags: ['common'] })),
  ], collections: [] };
  const result = createConnectionIndex(library).connections('focus', { limit: 30 });
  assert.deepEqual(result.connections.slice(0, 2).map(item => item.node.id), ['multiple', 'specific']);
  const broad = result.connections.find(item => item.node.id === 'broad');
  const specific = result.connections.find(item => item.node.id === 'specific');
  assert.ok(specific.score > broad.score);
  assert.equal(result.connections[0].reasons.filter(reason => reason.type === 'tag').length, 2, 'normalized duplicate tags do not inflate the score');
});

test('categories and collections filter focused results without creating connections or hiding the focal reading', () => {
  const library = { blocks: [
    { id: 'focus', title: 'Focus', type: 'link', category: 'Design', tags: ['archives'] },
    { id: 'context', title: 'Just filed together', type: 'link', category: 'Design', tags: [] },
    { id: 'same', title: 'A shared interest', type: 'text', category: 'Design', tags: ['ARCHIVES'] },
    { id: 'other', title: 'Another subject', type: 'text', category: 'Culture', tags: ['archives'] },
  ], collections: [
    { id: 'one', title: 'Reading room', items: [{ kind: 'block', id: 'focus' }, { kind: 'block', id: 'context' }, { kind: 'block', id: 'same' }] },
    { id: 'two', title: 'Other collection', items: [{ kind: 'block', id: 'other' }] },
  ] };
  const index = createConnectionIndex(library);
  const result = index.connections('focus');
  assert.equal(result.total, 2);
  assert.ok(result.connections.every(item => item.node.id !== 'context'));
  assert.deepEqual(new Set(result.connections.find(item => item.node.id === 'same').reasons.map(reason => reason.type)), new Set(['tag', 'category', 'collection']));
  const filtered = index.connections('focus', { category: 'CULTURE', tag: ' Archives ', collection: 'two' });
  assert.equal(filtered.focus.id, 'focus', 'candidate filters never remove the chosen starting point');
  assert.deepEqual(filtered.connections.map(item => item.node.id), ['other']);
  assert.equal(index.connections('focus', { collection: 'missing' }).total, 0);
  assert.deepEqual(index.connections('missing'), { focus: null, connections: [], total: 0 });
});

test('starting-point search covers saved text across the library, ranks titles, and seeds recent readings', () => {
  const library = { blocks: [
    { id: 'a', title: 'Archive systems', type: 'link', category: 'Design', tags: ['collecting'], createdAt: '2025-01-01', source: { url: 'https://example.com/personal-web' } },
    { id: 'b', title: 'A newer reading', type: 'text', category: 'Culture', tags: ['reading'], createdAt: '2026-04-01', body: 'Archive systems and memory', notes: 'My handwritten observations' },
    { id: 'c', title: 'An older reading', type: 'link', createdAt: '2024-01-01', summary: { text: 'A summary about identity.' } },
    { id: 'media', title: 'Archive systems image', type: 'image', category: 'Media only', tags: ['media-only'], createdAt: '2027-01-01' },
  ], collections: [{ id: 'c_one', title: 'Some reading', items: [{ kind: 'block', id: 'b' }] }] };
  const index = createConnectionIndex(library);
  assert.deepEqual(index.search().nodes.map(node => node.id), ['b', 'a', 'c']);
  assert.deepEqual(index.search({ query: 'archive systems' }).nodes.map(node => node.id), ['a', 'b'], 'an exact title beats a newer body-text match');
  assert.deepEqual(index.search({ query: 'HANDWRITTEN observations', category: 'culture', tag: 'reading', collection: 'c_one' }).nodes.map(node => node.id), ['b']);
  assert.equal(index.search({ query: 'personal-web' }).nodes[0].id, 'a');
  assert.equal(index.search({ query: 'identity' }).nodes[0].id, 'c');
  assert.deepEqual(index.categories, ['Culture', 'Design', 'Uncategorized']);
  assert.ok(!index.tags.includes('media-only'));
  assert.equal(index.search({ limit: 1 }).total, 3);
  assert.equal(index.search({ limit: 1 }).nodes.length, 1);
});

test('focused indexing rejects unreviewed suggestions and media links without mutating source records', () => {
  const library = { blocks: [
    { id: 'focus', title: 'Focus', type: 'link', related: ['focus', 'image'], suggestedRelated: [
      { id: 'other', reason: 'An automatic guess', method: 'embedding' },
      { id: 'other', reason: '   ', method: 'curation-v1' },
      { id: 'reviewed', reason: 'A reviewed reason.', method: 'curation-v1' },
      { id: 'reviewed', reason: 'A duplicate target.', method: 'curation-v1' },
      { id: 'image', reason: 'A media target.', method: 'curation-v1' },
    ] },
    { id: 'other', title: 'Other', type: 'text' },
    { id: 'reviewed', title: 'Reviewed', type: 'text' },
    { id: 'image', title: 'Image', type: 'image', related: ['other'] },
  ], collections: [] };
  const before = structuredClone(library);
  const index = createConnectionIndex(library);
  const first = index.connections('focus');
  assert.deepEqual(first.connections.map(item => item.node.id), ['reviewed']);
  assert.equal(first.connections[0].reasons.length, 1);
  assert.equal(first.connections[0].reasons[0].label, 'A reviewed reason.');
  assert.deepEqual(index.connections('focus'), first, 'repeated exploration produces a stable result');
  assert.deepEqual(library, before);
  assert.deepEqual(createConnectionIndex({ blocks: [], collections: [] }).search(), { nodes: [], total: 0 });
});
