import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, validateCatalog } from '../shared/model.mjs';
import { canvasBounds, connectionPath, validateCanvases } from '../shared/canvas.mjs';
import { canvasAIRequest, requestCanvasAI } from '../shared/canvas-ai.mjs';
import { canvasAIConfig, expandCanvasNote } from '../scripts/canvas-ai.mjs';

const fixture = () => ({ schemaVersion: 1, library: { schemaVersion: 1, title: 'Canvas test' }, folders: [], collections: [], blocks: [] });
const note = (id = 'card_one') => ({ id, kind: 'note', title: 'A thought', text: 'Connected knowledge', color: 'lilac', x: -40, y: 80, width: 280, height: 250 });
function boardFixture() {
  const created = applyOperation(fixture(), { type: 'create-canvas', id: 'canvas_one', title: 'Connected ideas' });
  const canvas = structuredClone(created.catalog.library.canvases[0]);
  canvas.nodes = [note(), { ...note('card_two'), x: 400 }];
  canvas.edges = [{ id: 'edge_one', from: 'card_one', to: 'card_two', label: 'Develops' }];
  return applyOperation(created.catalog, { type: 'save-canvas', id: canvas.id, expectedRevision: 1, canvas });
}

test('canvas operations persist layouts and authored links without changing original snapshots', () => {
  const input = fixture(), created = applyOperation(input, { type: 'create-canvas', id: 'canvas_one', title: 'Ideas' });
  assert.equal(input.library.canvases, undefined);
  assert.equal(created.writes[0].path, 'content/library.json');
  const saved = boardFixture();
  const disk = JSON.parse(saved.writes[0].content);
  assert.equal(disk.canvases[0].revision, 2);
  assert.equal(disk.canvases[0].edges[0].label, 'Develops');
  assert.deepEqual(disk.canvases[0].nodes[0], note());
  validateCatalog(saved.catalog);
  const next = applyOperation(saved.catalog, { type: 'delete-canvas', id: 'canvas_one', expectedRevision: 2 });
  assert.deepEqual(next.catalog.library.canvases, []);
  assert.equal(saved.catalog.library.canvases.length, 1);
});

test('canvas writes reject stale revisions, dangling references, duplicate edges, and invalid geometry', () => {
  const { catalog } = boardFixture(), canvas = catalog.library.canvases[0];
  assert.throws(() => applyOperation(catalog, { type: 'save-canvas', id: canvas.id, expectedRevision: 1, canvas }), /changed elsewhere/);
  assert.throws(() => applyOperation(catalog, { type: 'delete-canvas', id: canvas.id, expectedRevision: 1 }), /changed elsewhere/);
  for (const change of [b => { b.nodes[0].x = Infinity; }, b => { b.nodes[0].height = -3; }, b => { b.nodes[0].color = 'unknown'; }, b => { b.edges[0].to = 'missing'; }, b => { b.edges.push({ ...b.edges[0], id: 'edge_two', from: 'card_two', to: 'card_one' }); }, b => { b.nodes[0].text = 'a'.repeat(20001); }, b => { b.nodes[0] = { ...b.nodes[0], kind: 'material', blockId: 'missing' }; }]) {
    const bad = structuredClone(canvas); change(bad);
    assert.throws(() => validateCanvases({ canvases: [bad] }, []));
  }
});

test('deleting a material removes its canvas references and connections while keeping authored notes', () => {
  let { catalog } = boardFixture();
  catalog = applyOperation(catalog, { type: 'add-block', block: { id: 'b_one', title: 'Original', type: 'text' }, body: 'Original words' }).catalog;
  const board = structuredClone(catalog.library.canvases[0]); board.nodes[1] = { ...board.nodes[1], kind: 'material', blockId: 'b_one' };
  catalog = applyOperation(catalog, { type: 'save-canvas', id: board.id, expectedRevision: 2, canvas: board }).catalog;
  const deleted = applyOperation(catalog, { type: 'delete-block', id: 'b_one' });
  assert.equal(deleted.catalog.library.canvases[0].revision, 4);
  assert.deepEqual(deleted.catalog.library.canvases[0].nodes, [note()]);
  assert.deepEqual(deleted.catalog.library.canvases[0].edges, []);
  assert.ok(deleted.writes.some(file => file.path === 'content/library.json'));
});

test('canvas fit includes negative positions and connections have finite paths in either direction', () => {
  assert.equal(canvasBounds([]), null);
  assert.deepEqual(canvasBounds([note(), { ...note('card_two'), x: 400 }]), { x: -40, y: 80, width: 720, height: 250 });
  for (const [from, to] of [[note(), { ...note(), x: 400 }], [{ ...note(), x: 400 }, note()]]) assert.doesNotMatch(connectionPath(from, to).d, /NaN|Infinity/);
});

test('AI sends bounded explicit context, keeps source data separate, validates output, and never returns credentials', async () => {
  const input = { title: 'Linked thinking', text: 'How can connected notes help learning?', prompt: 'Expand this topic.', context: Array.from({ length: 10 }, () => ({ title: 'Reference', text: 'x'.repeat(3000) })) };
  const body = canvasAIRequest(input, 'test-model');
  assert.equal(body.store, false);
  const sent = JSON.parse(body.messages[1].content);
  assert.equal(sent.connectedContext.length, 6); assert.equal(sent.connectedContext[0].text.length, 1500);
  assert.equal(sent.instruction, input.prompt);
  let request;
  const result = await expandCanvasNote(input, { env: { CHARTA_AI_API_KEY: 'private-test-key', CHARTA_AI_ENDPOINT: 'https://provider.test/v1/chat/completions', CHARTA_AI_MODEL: 'test-model' }, fetchImpl: async (url, init) => { request = { url, ...init }; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: 'Developing ideas', text: 'Combine retrieval practice with connections.' }) }, finish_reason: 'stop' }] })); } });
  assert.deepEqual(result, { title: 'Developing ideas', text: 'Combine retrieval practice with connections.' });
  assert.equal(request.headers.Authorization, 'Bearer private-test-key'); assert.equal(request.redirect, 'error');
  assert.doesNotMatch(JSON.stringify(result), /private-test-key/);
  assert.equal(canvasAIConfig({}), null);
  assert.equal(canvasAIConfig({ CHARTA_AI_API_KEY: 'secret', CHARTA_AI_ENDPOINT: 'http://unsafe.test', CHARTA_AI_MODEL: 'test' }), null);
  await assert.rejects(expandCanvasNote(input, { env: {} }), /Connect an AI provider/);
  const config = { endpoint: 'https://provider.test/v1/chat/completions', model: 'test-model', key: 'private-test-key' };
  await assert.rejects(requestCanvasAI(input, { ...config, fetchImpl: async () => new Response('private-test-key', { status: 401 }) }), /rejected the connection/);
  await assert.rejects(requestCanvasAI(input, { ...config, fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'broken JSON' } }] })) }), /invalid note/);
  await assert.rejects(requestCanvasAI(input, { ...config, fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"title":"Partial","text":"Cut off"}' } }] })) }), /incomplete/);
  assert.throws(() => canvasAIRequest({ ...input, text: '' }, 'test'), /Write a note/);
});
