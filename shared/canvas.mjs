const ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,100}$/;
export const CANVAS_COLORS = ['paper', 'lilac', 'sage', 'sand', 'rose'];
const text = (value, max, label) => { if (typeof value !== 'string' || value.length > max) throw new Error(`${label} is too long or invalid.`); };
const number = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;

export function validateCanvases(library, blocks) {
  if (library.canvases === undefined) return;
  const boards = library.canvases;
  if (!Array.isArray(boards) || boards.length > 50) throw new Error('A library supports up to 50 canvases.');
  // library.json has the same 2 MiB read limit as other canonical records.
  if (new TextEncoder().encode(JSON.stringify(library)).length > 1800000) throw new Error('Canvas storage is full. Export and remove an old canvas before adding more.');
  const boardIds = new Set(), blockIds = new Set(blocks.map(b => b.id));
  for (const board of boards) {
    if (!ID.test(board.id) || boardIds.has(board.id)) throw new Error('Invalid or duplicate canvas ID.');
    boardIds.add(board.id);
    text(board.title, 120, 'Canvas title');
    if (!board.title.trim()) throw new Error('Give the canvas a title.');
    if (!Number.isSafeInteger(board.revision) || board.revision < 1) throw new Error('Invalid canvas revision.');
    if (!Array.isArray(board.nodes) || board.nodes.length > 200 || !Array.isArray(board.edges) || board.edges.length > 600) throw new Error('A canvas supports up to 200 cards and 600 connections.');
    const ids = new Set(), edgeIds = new Set(), pairs = new Set();
    for (const node of board.nodes) {
      if (!ID.test(node.id) || ids.has(node.id)) throw new Error('Invalid or duplicate canvas card ID.');
      ids.add(node.id);
      if (!number(node.x, -50000, 50000) || !number(node.y, -50000, 50000) || !number(node.width, 180, 1000) || !number(node.height, 140, 1400)) throw new Error('Invalid canvas card position or size.');
      if (node.kind === 'note') {
        text(node.title, 200, 'Note title'); text(node.text, 20000, 'Note');
        if (!CANVAS_COLORS.includes(node.color)) throw new Error('Unknown note color.');
        if (node.ai !== undefined && typeof node.ai !== 'boolean') throw new Error('Invalid AI note marker.');
      } else if (node.kind === 'material') {
        if (!blockIds.has(node.blockId)) throw new Error('Canvas material could not be found.');
      } else throw new Error('Unknown canvas card type.');
    }
    for (const edge of board.edges) {
      const pair = [edge.from, edge.to].sort().join(':');
      if (!ID.test(edge.id) || edgeIds.has(edge.id) || pairs.has(pair) || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) throw new Error('Invalid or duplicate canvas connection.');
      edgeIds.add(edge.id); pairs.add(pair); text(edge.label, 100, 'Connection label');
    }
    const view = board.viewport;
    if (!view || !number(view.x, -100000, 100000) || !number(view.y, -100000, 100000) || !number(view.zoom, .2, 2)) throw new Error('Invalid canvas viewport.');
  }
}

export function canvasBounds(nodes) {
  if (!nodes.length) return null;
  const x = Math.min(...nodes.map(n => n.x)), y = Math.min(...nodes.map(n => n.y));
  return { x, y, width: Math.max(...nodes.map(n => n.x + n.width)) - x, height: Math.max(...nodes.map(n => n.y + n.height)) - y };
}

export function connectionPath(from, to) {
  const right = to.x + to.width / 2 >= from.x + from.width / 2;
  const x1 = from.x + (right ? from.width : 0), y1 = from.y + from.height / 2;
  const x2 = to.x + (right ? 0 : to.width), y2 = to.y + to.height / 2;
  const bend = Math.max(60, Math.abs(x2 - x1) * .45) * (right ? 1 : -1);
  return { d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`, x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
}
