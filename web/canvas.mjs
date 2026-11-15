import { newId } from './shared/model.mjs';
import { CANVAS_COLORS, canvasBounds, connectionPath, validateCanvases } from './shared/canvas.mjs';
import { aiEndpoint, requestCanvasAI } from './shared/canvas-ai.mjs';
import { base64FromBytes, detectUpload, MAX_UPLOAD_BYTES } from './shared/uploads.mjs';
import { previewAsset, assetURL } from './media.mjs';
import { stripFrontmatter } from './shared/clip-markdown.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const glyphs = {
  note: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 4-5 4 6"/>',
  library: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  connect: '<circle cx="5" cy="6" r="3"/><circle cx="19" cy="18" r="3"/><path d="M5 9v5a4 4 0 0 0 4 4h7"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  undo: '<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12"/>',
  redo: '<path d="m16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  fit: '<path d="M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6"/>',
  arrow: '<path d="m7 17 10-10M7 7h10v10"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[name] || glyphs.note}</svg>`;
const btn = (action, name, label, extra = '') => `<button type="button" data-canvas-action="${action}" title="${esc(label)}" aria-label="${esc(label)}" ${extra}>${icon(name)}</button>`;
let provider = null; // Credentials stay in page memory and never enter catalog/export/storage.
let localProvider = null;

export function renderCanvas(container, store, options = {}) {
  const abort = new AbortController(), { signal } = abort;
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const $ = selector => container.querySelector(selector);
  let board = structuredClone(store.catalog.library.canvases?.find(item => item.id === options.boardId) || null);
  let revision = board?.revision, selected = '', selectedEdge = '', connecting = '', panelMode = 'inspect';
  let history = [], future = [], editing = false, gesture = null, space = false, destroyed = false;
  let dirty = false, generation = 0, timer, pending = Promise.resolve(true), queuedJSON = '', saveError = '';
  let aiController = null, aiResult = null, aiBusy = false, aiPrompt = '', aiError = '';
  let librarySearch = '', libraryType = 'all', highlightedText = '', useContext = true;
  const recoveryKey = board ? `charta:canvas-recovery:${win.location.pathname}:${board.id}` : '';
  const notify = message => options.onMessage?.(message);
  const snapshot = () => structuredClone({ title: board.title, nodes: board.nodes, edges: board.edges, viewport: board.viewport });
  const recover = () => {
    if (!board) return;
    try {
      const saved = JSON.parse(win.sessionStorage.getItem(recoveryKey));
      if (saved?.canvas) {
        const candidate = { ...board, ...saved.canvas, id: board.id, revision: saved.revision };
        validateCanvases({ canvases: [candidate] }, store.catalog.blocks);
        if (saved.revision !== revision) notify('Recovered unsaved edits. This canvas also changed elsewhere; export your draft before reloading.');
        Object.assign(board, candidate); revision = saved.revision; dirty = true;
      }
    } catch { /* Session recovery is optional; normal saves still work. */ }
  };
  recover();
  function remember() { history.push(snapshot()); if (history.length > 40) history.shift(); future = []; updateTools(); }
  function changed(delay = 450) {
    dirty = true; generation++; saveError = '';
    try { win.sessionStorage.setItem(recoveryKey, JSON.stringify({ revision, canvas: snapshot() })); } catch { /* A full session store does not prevent canonical saves. */ }
    updateTools(); clearTimeout(timer); timer = setTimeout(() => void save(), delay);
  }
  function updateTools() {
    if (destroyed || !board) return;
    const status = $('.canvas-save');
    if (status) { status.textContent = saveError ? 'Save failed · retry' : dirty ? 'Saving…' : 'All changes saved'; status.dataset.error = String(Boolean(saveError)); status.title = saveError || ''; }
    const undo = $('[data-canvas-action=undo]'), redo = $('[data-canvas-action=redo]');
    if (undo) undo.disabled = !history.length; if (redo) redo.disabled = !future.length;
    const count = $('.canvas-count'); if (count) count.textContent = `${board.nodes.length} card${board.nodes.length === 1 ? '' : 's'} · ${board.edges.length} connection${board.edges.length === 1 ? '' : 's'}`;
  }
  function save() {
    clearTimeout(timer);
    if (!board || !dirty) return pending;
    const canvas = snapshot(), serial = JSON.stringify(canvas), version = generation;
    if (serial === queuedJSON && !saveError) return pending.then(saved => {
      if (saved && JSON.stringify(snapshot()) === serial) { dirty = false; try { win.sessionStorage.removeItem(recoveryKey); } catch {} updateTools(); }
      return saved;
    });
    queuedJSON = serial;
    pending = pending.then(async () => {
      try {
        const result = await store.apply({ type: 'save-canvas', id: board.id, expectedRevision: revision, canvas });
        revision = result.catalog.library.canvases.find(item => item.id === board.id).revision;
        board.revision = revision;
        if (generation === version) { dirty = false; try { win.sessionStorage.removeItem(recoveryKey); } catch {} }
        else { try { win.sessionStorage.setItem(recoveryKey, JSON.stringify({ revision, canvas: snapshot() })); } catch {} }
        saveError = ''; options.onCatalogChange?.(); updateTools(); return true;
      } catch (error) { saveError = error.message; queuedJSON = ''; updateTools(); notify(error.message); return false; }
    });
    return pending;
  }
  function mutate(fn) { remember(); fn(); changed(); paint(); inspect(); }
  const nodeById = id => board.nodes.find(node => node.id === id);
  const material = node => store.catalog.blocks.find(block => block.id === node?.blockId);
  const nodeTitle = node => node.kind === 'note' ? node.title || 'Untitled note' : material(node)?.title || 'Material';
  const nodeText = node => node.kind === 'note' ? node.text : stripFrontmatter(material(node)?.body || material(node)?.description || '');
  function point(clientX, clientY) { const r = $('.canvas-stage').getBoundingClientRect(), v = board.viewport; return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom }; }
  function center() { const r = $('.canvas-stage').getBoundingClientRect(); return point(r.left + r.width / 2, r.top + r.height / 2); }
  function addNote(position, value = {}) {
    const p = position || center();
    const node = { id: newId('card'), kind: 'note', title: '', text: '', color: 'paper', x: clamp(p.x - 140, -50000, 49000), y: clamp(p.y - 110, -50000, 49000), width: 280, height: 250, ...value };
    mutate(() => { board.nodes.push(node); selected = node.id; selectedEdge = ''; panelMode = 'inspect'; });
    $('.canvas-panel').hidden = false;
    $('.canvas-note-title')?.focus();
  }
  function addMaterial(blockId, position) {
    const p = position || center();
    mutate(() => { const node = { id: newId('card'), kind: 'material', blockId, x: clamp(p.x - 140, -50000, 49000), y: clamp(p.y - 120, -50000, 49000), width: 280, height: 290 }; board.nodes.push(node); selected = node.id; selectedEdge = ''; });
  }
  function connect(from, to) {
    if (from === to) { connecting = ''; paint(); return; }
    if (board.edges.some(edge => [edge.from, edge.to].includes(from) && [edge.from, edge.to].includes(to))) { connecting = ''; paint(); notify('These cards are already connected.'); return; }
    mutate(() => { board.edges.push({ id: newId('edge'), from, to, label: '' }); connecting = ''; selected = to; });
  }
  function select(id) {
    if (connecting) { connect(connecting, id); return; }
    if (selected !== id) { aiController?.abort(); aiBusy = false; aiResult = null; aiError = ''; highlightedText = ''; }
    selected = id; selectedEdge = ''; panelMode = 'inspect'; $('.canvas-panel').hidden = false; paintSelection(); inspect();
  }
  function paintSelection() {
    for (const card of container.querySelectorAll('.canvas-card')) { card.classList.toggle('is-selected', card.dataset.id === selected); card.setAttribute('aria-pressed', String(card.dataset.id === selected)); }
  }
  function paint() {
    if (!board || destroyed) return;
    const v = board.viewport;
    $('.canvas-world').style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
    const stage = $('.canvas-stage'); stage.style.backgroundPosition = `${v.x}px ${v.y}px`; stage.style.backgroundSize = `${24 * v.zoom}px ${24 * v.zoom}px`;
    stage.classList.toggle('is-connecting', Boolean(connecting));
    $('.canvas-zoom').textContent = `${Math.round(v.zoom * 100)}%`;
    const zoomInput = $('.canvas-zoom-range');
    if (zoomInput) { zoomInput.value = Math.round(v.zoom * 100); zoomInput.setAttribute('aria-valuetext', `${Math.round(v.zoom * 100)} percent`); }
    $('.canvas-empty').hidden = board.nodes.length > 0;
    $('.canvas-cards').innerHTML = board.nodes.map(node => {
      const block = material(node), asset = block && previewAsset(block), src = asset && assetURL(block, asset, doc.baseURI);
      return `<article class="canvas-card ${node.kind === 'note' ? `canvas-note color-${node.color}` : 'canvas-material'}${src ? ' canvas-visual' : ''}${selected === node.id ? ' is-selected' : ''}" data-id="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px" role="button" tabindex="0" aria-pressed="${selected === node.id}" aria-label="${esc(nodeTitle(node))}. Use arrow keys to move, Enter to edit."><div class="canvas-card-head"><span>${icon(node.ai ? 'spark' : node.kind === 'note' ? 'note' : block?.type === 'image' ? 'image' : 'library')}<span class="canvas-card-label">${node.ai ? 'AI note' : node.kind === 'note' ? 'Note' : esc(nodeTitle(node))}</span></span><button type="button" class="canvas-port" data-connect="${esc(node.id)}" title="Connect this card" aria-label="Connect ${esc(nodeTitle(node))}">${icon('connect')}</button></div>${src ? `<img class="canvas-card-image" src="${esc(src)}" alt="${esc(block.title)}" draggable="false">` : ''}<div class="canvas-card-copy"><h2>${esc(nodeTitle(node))}</h2>${!src ? `<p>${esc(nodeText(node).slice(0, 2500) || 'A thought starts here…')}</p>` : ''}</div><button type="button" class="canvas-resize" data-resize="${esc(node.id)}" title="Drag to resize; use Shift + arrow keys when focused" aria-label="Resize ${esc(nodeTitle(node))}"></button></article>`;
    }).join('');
    paintEdges(); updateTools();
    $('.canvas-connection-hint').hidden = !connecting;
  }
  function paintEdges() {
    $('.canvas-edges').innerHTML = board.edges.map(edge => {
      const from = nodeById(edge.from), to = nodeById(edge.to); if (!from || !to) return '';
      const p = connectionPath(from, to);
      return `<g class="canvas-edge${selectedEdge === edge.id ? ' is-selected' : ''}" data-edge="${esc(edge.id)}" tabindex="0" role="button" aria-label="Connection from ${esc(nodeTitle(from))} to ${esc(nodeTitle(to))}${edge.label ? `: ${esc(edge.label)}` : ''}"><path class="canvas-edge-hit" d="${p.d}"/><path class="canvas-edge-line" d="${p.d}"/>${edge.label ? `<text x="${p.x}" y="${p.y - 10}" text-anchor="middle">${esc(edge.label)}</text>` : ''}</g>`;
    }).join('');
  }
  function paintCard(id) {
    const node = nodeById(id), element = [...container.querySelectorAll('.canvas-card')].find(card => card.dataset.id === id);
    if (!node || !element) return;
    Object.assign(element.style, { left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px` });
    element.querySelector('h2').textContent = nodeTitle(node);
    const p = element.querySelector('.canvas-card-copy p'); if (p) p.textContent = nodeText(node).slice(0, 2500) || 'A thought starts here…';
    paintEdges();
  }
  function inspect() {
    const panel = $('.canvas-panel');
    if (!board || !panel || destroyed) return;
    const node = nodeById(selected), edge = board.edges.find(edge => edge.id === selectedEdge);
    const head = title => `<div class="canvas-panel-head"><h2>${title}</h2>${btn('close-panel', 'close', 'Close panel')}</div>`;
    if (panelMode === 'library') {
      panel.innerHTML = `${head('Your library')}<p class="canvas-panel-hint">Bring a reference into your canvas. The original stays in your library.</p><input class="canvas-library-search" type="search" aria-label="Search materials for canvas" placeholder="Find a material…" value="${esc(librarySearch)}"><select class="canvas-library-type" aria-label="Material type"><option value="all">All materials</option><option value="image">Images</option><option value="text">Notes</option><option value="link">Links</option></select><div class="canvas-library-results"></div>`;
      $('.canvas-library-type').value = libraryType; libraryResults(); return;
    }
    if (panelMode === 'settings') {
      panel.innerHTML = `${head('AI connection')}<p class="canvas-panel-hint">${localProvider?.configured ? `Local server connected · ${esc(localProvider.model)}. You can use a different provider for this session.` : 'Connect a provider to expand notes, explore questions, and develop ideas.'}</p><form class="canvas-ai-settings"><label>Chat-completions endpoint<input name="endpoint" type="url" required placeholder="https://…/v1/chat/completions" value="${esc(provider?.endpoint || '')}"></label><label>Model<input name="model" required placeholder="Your provider’s model name" value="${esc(provider?.model || '')}" maxlength="200"></label><label>API key<input name="key" type="password" required autocomplete="off" spellcheck="false" placeholder="Enter your provider’s API key"></label><p class="canvas-panel-hint">Your key stays in memory until reload. Notes and connected text are sent only when you press Generate. The provider must allow browser requests.</p><button class="canvas-primary" type="submit">Connect for this session</button>${provider ? '<button type="button" data-canvas-action="disconnect-ai">Disconnect provider</button>' : ''}<p class="canvas-inline-error" role="status"></p></form>`; return;
    }
    if (edge) {
      panel.innerHTML = `${head('Connection')}<p class="canvas-panel-hint">${esc(nodeTitle(nodeById(edge.from)))} ↔ ${esc(nodeTitle(nodeById(edge.to)))}</p><label>Label<input class="canvas-edge-label" maxlength="100" value="${esc(edge.label)}" placeholder="What’s the connection?"></label><button class="canvas-remove" data-canvas-action="remove-edge">${icon('trash')}Remove connection</button>`; return;
    }
    if (!node) {
      panel.innerHTML = `${head('Room to think')}<div class="canvas-panel-emblem">${icon('connect')}</div><h3>Collect. Connect. Explore.</h3><p class="canvas-panel-hint">Put your ideas and references side by side. Follow a connection and see where it takes you.</p><dl class="canvas-shortcuts"><dt>Move a card</dt><dd>Drag or arrow keys</dd><dt>Pan</dt><dd>Drag empty space</dd><dt>Zoom</dt><dd>⌘ / Ctrl + scroll</dd><dt>Add a note</dt><dd>Double-click the canvas</dd><dt>Undo</dt><dd>⌘ / Ctrl + Z</dd></dl><button class="canvas-secondary" data-canvas-action="ai-settings">${icon('spark')}AI connection</button><details class="canvas-board-options"><summary>Canvas options</summary><button data-canvas-action="export">Export this canvas</button><button class="canvas-remove" data-canvas-action="delete-board">Delete this canvas…</button></details>`; return;
    }
    const note = node.kind === 'note';
    panel.innerHTML = `${head(note ? 'Your note' : 'Library reference')}${note ? `<label>Title<input class="canvas-note-title" maxlength="200" placeholder="Untitled note" value="${esc(node.title)}"></label><label>Note<textarea class="canvas-note-text" maxlength="20000" placeholder="What’s on your mind?">${esc(node.text)}</textarea></label><div class="canvas-colors" aria-label="Note color">${CANVAS_COLORS.map(color => `<button class="color-${color}${color === node.color ? ' is-active' : ''}" data-color="${color}" aria-label="${color} note" aria-pressed="${color === node.color}"></button>`).join('')}</div>` : `<h3>${esc(nodeTitle(node))}</h3><p class="canvas-panel-hint">${esc(nodeText(node).slice(0, 450) || 'A visual reference from your library.')}</p><button class="canvas-secondary" data-canvas-action="open-material">${icon('arrow')}Open material</button>`}<div class="canvas-card-actions"><button class="canvas-secondary" data-canvas-action="connect">${icon('connect')}Connect to a card</button><button class="canvas-remove" data-canvas-action="remove">${icon('trash')}Remove from canvas</button></div><section class="canvas-ai"><div class="canvas-ai-heading"><h3>${icon('spark')}Think a little further</h3>${btn('ai-settings', 'spark', 'AI connection settings')}</div><p class="canvas-panel-hint">Expand a topic into a new, connected note.${note ? ' Highlight text in your note to focus on one part.' : ''}</p><div class="canvas-ai-presets"><button data-preset="Expand this topic with useful details, examples, and directions to explore.">Expand</button><button data-preset="Suggest thoughtful questions and new directions to explore.">Questions</button><button data-preset="Summarize the key ideas clearly and concisely.">Summarize</button></div><textarea class="canvas-ai-prompt" maxlength="1000" aria-label="AI instruction" placeholder="What would you like to explore?">${esc(aiPrompt)}</textarea><label class="canvas-context-toggle"><input type="checkbox" class="canvas-use-context" ${useContext ? 'checked' : ''}>Include directly connected notes</label><p class="canvas-panel-hint canvas-ai-scope">${provider ? esc(provider.model) : localProvider?.configured ? esc(localProvider.model) : 'Connect a provider to get started.'} · Selected text and up to 6 connected cards are sent to your provider.</p><button class="canvas-primary" data-canvas-action="generate" ${aiBusy ? 'disabled' : ''}>${icon('spark')}${aiBusy ? 'Thinking…' : provider || localProvider?.configured ? 'Generate' : 'Connect AI'}</button>${aiBusy ? '<button class="canvas-secondary" data-canvas-action="cancel-ai">Cancel</button>' : ''}<p class="canvas-ai-error" role="status">${esc(aiError)}</p><div class="canvas-ai-result" ${aiResult ? '' : 'hidden'}>${aiResult ? `<span>AI draft · review before keeping</span><h4>${esc(aiResult.title)}</h4><p>${esc(aiResult.text)}</p><button class="canvas-primary" data-canvas-action="keep-ai">${icon('plus')}Add connected note</button>` : ''}</div></section>`;
  }
  function libraryResults() {
    const results = $('.canvas-library-results'); if (!results) return;
    const query = librarySearch.trim().toLowerCase();
    const blocks = store.catalog.blocks.filter(b => (libraryType === 'all' || b.type === libraryType) && `${b.title} ${b.category} ${(b.tags || []).join(' ')}`.toLowerCase().includes(query));
    results.innerHTML = `<p class="canvas-panel-hint">${blocks.length} material${blocks.length === 1 ? '' : 's'}${blocks.length > 60 ? ' · Showing first 60; search to narrow' : ''}</p>` + blocks.slice(0, 60).map(block => {
      const asset = previewAsset(block), src = asset && assetURL(block, asset, doc.baseURI);
      return `<button class="canvas-library-item" data-material="${esc(block.id)}" title="Add ${esc(block.title)}">${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : `<span>${icon(block.type === 'text' ? 'note' : 'library')}</span>`}<span><strong>${esc(block.title)}</strong><small>${esc(block.type)} · ${esc(block.category)}</small></span>${icon('plus')}</button>`;
    }).join('') || '<p class="canvas-panel-hint">No matching materials.</p>';
  }
  function zoom(value, client) {
    const stage = $('.canvas-stage'), r = stage.getBoundingClientRect(), x = client?.x ?? r.width / 2, y = client?.y ?? r.height / 2;
    const v = board.viewport, next = clamp(value, .2, 2);
    v.x = clamp(x - (x - v.x) * next / v.zoom, -100000, 100000); v.y = clamp(y - (y - v.y) * next / v.zoom, -100000, 100000); v.zoom = next; paint(); changed();
  }
  function fit() {
    const bounds = canvasBounds(board.nodes); if (!bounds) return;
    const r = $('.canvas-stage').getBoundingClientRect(), v = board.viewport;
    v.zoom = clamp(Math.min((r.width - 100) / bounds.width, (r.height - 100) / bounds.height), .2, 1.2);
    v.x = r.width / 2 - (bounds.x + bounds.width / 2) * v.zoom; v.y = r.height / 2 - (bounds.y + bounds.height / 2) * v.zoom;
    paint(); changed();
  }
  function download() {
    const value = { schemaVersion: 1, ...structuredClone(board), materials: board.nodes.filter(node => node.kind === 'material').map(node => { const block = material(node); return { id: block.id, title: block.title, source: block.source, path: block.path }; }) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
    const link = doc.createElement('a'); link.href = url; link.download = `${board.title.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 70) || 'canvas'}.canvas.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function upload(files, position) {
    for (const [index, file] of [...files].entries()) {
      if (file.size > MAX_UPLOAD_BYTES) { notify('Choose an image smaller than 50 MB.'); continue; }
      const bytes = new Uint8Array(await file.arrayBuffer()), format = detectUpload(bytes, file.name, file.type);
      if (format.type !== 'image') { notify('Canvas uploads support PNG, JPEG, WebP, GIF, and AVIF images.'); continue; }
      const result = await store.apply({ type: 'add-block', block: { id: newId('b'), title: file.name || 'Pasted image', type: 'image', category: 'Canvas', tags: ['canvas'] }, attachments: [{ name: file.name || 'image.png', type: format.mimeType, data: base64FromBytes(bytes) }] });
      options.onCatalogChange?.();
      if (destroyed) return;
      const p = position || center(); addMaterial(result.entityId, { x: p.x + index * 35, y: p.y + index * 35 });
    }
  }
  async function generate() {
    if (!provider && !localProvider?.configured) { panelMode = 'settings'; inspect(); return; }
    const node = nodeById(selected); if (!node) return;
    aiPrompt = $('.canvas-ai-prompt').value;
    const neighbors = new Set(board.edges.filter(e => e.from === selected || e.to === selected).flatMap(e => [e.from, e.to])); neighbors.delete(selected);
    const input = { title: nodeTitle(node), text: highlightedText || nodeText(node), prompt: aiPrompt, context: $('.canvas-use-context').checked ? [...neighbors].slice(0, 6).map(id => { const n = nodeById(id); return { title: nodeTitle(n), text: nodeText(n).slice(0, 1500) }; }) : [] };
    aiController?.abort(); const controller = new AbortController(); aiController = controller; aiBusy = true; aiResult = null; aiError = ''; inspect();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      let result;
      if (provider) result = await requestCanvasAI(input, { ...provider, signal: controller.signal });
      else {
        const response = await fetch(new URL('api/canvas/ai', doc.baseURI), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: controller.signal });
        result = await response.json(); if (!response.ok) throw new Error(result.error || 'The local AI request failed.');
      }
      if (aiController === controller && !destroyed) aiResult = { ...result, sourceId: node.id };
    } catch (error) { if (aiController === controller && !destroyed) aiError = error.name === 'AbortError' ? 'Generation stopped. You can try again.' : error instanceof TypeError ? 'Could not reach the provider. Check its endpoint and browser access (CORS), or use the local server configuration.' : error.message; }
    finally { clearTimeout(timeout); if (aiController === controller) { aiBusy = false; if (panelMode === 'inspect') inspect(); } }
  }
  function overview() {
    const boards = store.catalog.library.canvases || [];
    container.innerHTML = `<section class="canvas-overview"><div class="canvas-overview-heading"><div><span class="canvas-eyebrow">A little room for big ideas</span><h1>Your canvases</h1><p>Gather references, connect thoughts, and see what takes shape.</p></div></div><form class="canvas-create-form"><input name="title" aria-label="New canvas name" placeholder="Name a new canvas…" maxlength="120" required><button class="canvas-primary" type="submit">${icon('plus')}Create canvas</button><p class="canvas-inline-error" role="status"></p></form><div class="canvas-board-grid">${boards.map(item => `<a class="canvas-board-tile" href="#/canvas/${esc(item.id)}"><div class="canvas-board-preview">${item.nodes.slice(0, 8).map((node, index) => `<i class="${node.kind === 'note' ? `color-${node.color}` : 'color-material'}" style="--tile-x:${15 + (index % 3) * 27}%;--tile-y:${18 + Math.floor(index / 3) * 23}%;--tile-r:${index % 2 ? 5 : -4}deg">${icon(node.kind === 'note' ? 'note' : 'image')}</i>`).join('') || `<span>${icon('connect')}</span>`}</div><div class="canvas-board-caption"><h2>${esc(item.title)}</h2>${icon('arrow')}<p>${item.nodes.length} cards · ${item.edges.length} connections</p></div></a>`).join('') || '<div class="canvas-overview-empty"><span>01 — Make space for a thought</span><p>Start a canvas for a project, a question, or a collection of things that belong together.</p></div>'}</div></section>`;
    $('.canvas-create-form').addEventListener('submit', async event => {
      event.preventDefault(); const form = event.target, button = form.querySelector('button'); button.disabled = true;
      try { const result = await store.apply({ type: 'create-canvas', id: newId('canvas'), title: form.elements.title.value.trim() }); options.onCatalogChange?.(); options.onNavigate?.(result.entityId); }
      catch (error) { form.querySelector('[role=status]').textContent = error.message; }
      finally { button.disabled = false; }
    }, { signal });
  }
  if (!board) {
    if (options.boardId) notify('That canvas could not be found.');
    overview();
    return { destroy() { destroyed = true; abort.abort(); }, flush: () => Promise.resolve(true) };
  }
  container.innerHTML = `<div class="canvas-workspace"><header class="canvas-top"><div class="canvas-titlebar"><a class="canvas-back" href="#/canvas" title="All canvases">Canvases <span>/</span></a><input class="canvas-board-title" aria-label="Canvas name" maxlength="120" value="${esc(board.title)}"></div><div class="canvas-statusbar"><button class="canvas-save" data-canvas-action="retry-save" title="Save status" aria-live="polite"></button><div class="canvas-history">${btn('undo', 'undo', 'Undo (⌘ / Ctrl Z)')}${btn('redo', 'redo', 'Redo (⌘ / Ctrl Shift Z)')}${btn('export', 'download', 'Export canvas')}</div></div></header><div class="canvas-body"><div class="canvas-stage" tabindex="0" role="region" aria-label="Canvas workspace. Drag to pan; double-click to add a note."><div class="canvas-world"><svg class="canvas-edges" aria-label="Connections"></svg><div class="canvas-cards"></div></div><div class="canvas-empty"><div>${icon('connect')}</div><span>A thought. An image. A connection.</span><h2>See where your ideas take you.</h2><p>Double-click anywhere to write a note,<br>or bring something in from your library.</p><button class="canvas-primary" data-canvas-action="note">${icon('plus')}Add your first note</button></div><div class="canvas-connection-hint" hidden>Choose another card to connect <button data-canvas-action="cancel-connect">Cancel</button></div><div class="canvas-tools" role="toolbar" aria-label="Canvas tools"><button data-canvas-action="note" title="Add a note (N)" aria-label="Add a note">${icon('note')}<span>Note</span></button><button data-canvas-action="image" title="Upload images" aria-label="Upload images">${icon('image')}<span>Image</span></button><button data-canvas-action="library" title="Add from library" aria-label="Add from library">${icon('library')}<span>Library</span></button><i></i><button data-canvas-action="show-panel" title="Ideas and canvas options" aria-label="Ideas and canvas options">${icon('spark')}<span>Ideas</span></button></div><div class="canvas-navigation"><button data-canvas-action="zoom-out" aria-label="Zoom out">−</button><button class="canvas-zoom" data-canvas-action="reset-zoom" title="Reset zoom">100%</button><label class="wake-slider"><input class="canvas-zoom-range" type="range" min="20" max="200" step="1" value="100" aria-label="Canvas zoom"></label><button data-canvas-action="zoom-in" aria-label="Zoom in">+</button>${btn('fit', 'fit', 'Fit all cards')}</div><span class="canvas-count"></span></div><aside class="canvas-panel" aria-label="Canvas inspector"></aside></div><input class="canvas-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" multiple hidden></div>`;
  paint(); inspect();
  $('.canvas-panel').hidden = true;
  const stage = $('.canvas-stage');
  container.addEventListener('click', async event => {
    const color = event.target.closest('[data-color]'); if (color) { const n = nodeById(selected); if (n?.kind === 'note') mutate(() => { n.color = color.dataset.color; }); return; }
    const materialButton = event.target.closest('[data-material]'); if (materialButton) { addMaterial(materialButton.dataset.material); return; }
    const preset = event.target.closest('[data-preset]'); if (preset) { aiPrompt = preset.dataset.preset; $('.canvas-ai-prompt').value = aiPrompt; return; }
    const port = event.target.closest('[data-connect]'); if (port) { if (connecting) connect(connecting, port.dataset.connect); else { connecting = port.dataset.connect; selected = connecting; paint(); inspect(); } return; }
    const action = event.target.closest('[data-canvas-action]')?.dataset.canvasAction;
    try {
      if (action === 'note') addNote();
      else if (action === 'image') $('.canvas-file').click();
      else if (action === 'library') { panelMode = 'library'; $('.canvas-panel').hidden = false; inspect(); $('.canvas-library-search').focus(); }
      else if (action === 'close-panel') { $('.canvas-panel').hidden = true; }
      else if (action === 'show-panel') { $('.canvas-panel').hidden = false; panelMode = 'inspect'; inspect(); }
      else if (action === 'ai-settings') { panelMode = 'settings'; inspect(); }
      else if (action === 'disconnect-ai') { provider = null; panelMode = 'inspect'; inspect(); }
      else if (action === 'connect' && selected) { connecting = selected; paint(); }
      else if (action === 'cancel-connect') { connecting = ''; paint(); }
      else if (action === 'remove') mutate(() => { board.nodes = board.nodes.filter(n => n.id !== selected); board.edges = board.edges.filter(e => e.from !== selected && e.to !== selected); selected = ''; });
      else if (action === 'remove-edge') mutate(() => { board.edges = board.edges.filter(e => e.id !== selectedEdge); selectedEdge = ''; });
      else if (action === 'undo' || action === 'redo') {
        const source = action === 'undo' ? history : future, target = action === 'undo' ? future : history;
        if (source.length) { target.push(snapshot()); Object.assign(board, source.pop()); selected = ''; selectedEdge = ''; changed(); paint(); inspect(); }
      } else if (action === 'zoom-in') zoom(board.viewport.zoom * 1.2);
      else if (action === 'zoom-out') zoom(board.viewport.zoom / 1.2);
      else if (action === 'reset-zoom') zoom(1);
      else if (action === 'fit') fit();
      else if (action === 'export') download();
      else if (action === 'retry-save') await save();
      else if (action === 'open-material') { if (await save()) options.onOpen?.(nodeById(selected).blockId); }
      else if (action === 'generate') await generate();
      else if (action === 'cancel-ai') aiController?.abort();
      else if (action === 'keep-ai' && aiResult) {
        const value = aiResult, source = nodeById(value.sourceId); if (!source) return;
        remember(); const node = { id: newId('card'), kind: 'note', title: value.title, text: value.text, ai: true, color: 'lilac', x: clamp(source.x + source.width + 110, -50000, 49000), y: source.y, width: 320, height: 350 };
        board.nodes.push(node); board.edges.push({ id: newId('edge'), from: source.id, to: node.id, label: 'Expanded with AI' }); selected = node.id; aiResult = null; changed(); paint(); inspect(); fit();
      } else if (action === 'delete-board') {
        $('.canvas-panel').innerHTML = `<div class="canvas-panel-head"><h2>Delete this canvas?</h2></div><p class="canvas-panel-hint">This removes “${esc(board.title)}” and its notes and connections. Library materials are kept. Export a copy first if you want to keep the layout.</p><button class="canvas-secondary" data-canvas-action="export">Export a copy</button><button class="canvas-remove" data-canvas-action="confirm-delete">Delete canvas</button><button class="canvas-secondary" data-canvas-action="show-panel">Keep canvas</button>`;
      } else if (action === 'confirm-delete') {
        if (!await save()) return;
        await store.apply({ type: 'delete-canvas', id: board.id, expectedRevision: revision }); dirty = false; win.sessionStorage.removeItem(recoveryKey); options.onCatalogChange?.(); options.onNavigate?.('');
      }
    } catch (error) { notify(error.message); }
    if (!action && !event.target.closest('.canvas-panel')) {
      const edge = event.target.closest('[data-edge]'), card = event.target.closest('.canvas-card');
      if (edge) { selectedEdge = edge.dataset.edge; selected = ''; panelMode = 'inspect'; $('.canvas-panel').hidden = false; paintSelection(); paintEdges(); inspect(); }
      else if (card && !gesture?.moved) { $('.canvas-panel').hidden = false; select(card.dataset.id); }
    }
  }, { signal });
  container.addEventListener('focusin', event => { if (event.target.matches('.canvas-note-title,.canvas-note-text,.canvas-edge-label,.canvas-board-title') && !editing) { remember(); editing = true; } }, { signal });
  container.addEventListener('focusout', () => { editing = false; }, { signal });
  container.addEventListener('input', event => {
    const input = event.target, n = nodeById(selected);
    if (input.matches('.canvas-zoom-range')) { zoom(Number(input.value) / 100); return; }
    if (input.matches('.canvas-note-title') && n?.kind === 'note') { n.title = input.value; changed(); paintCard(n.id); }
    else if (input.matches('.canvas-note-text') && n?.kind === 'note') { n.text = input.value; highlightedText = ''; changed(); paintCard(n.id); }
    else if (input.matches('.canvas-board-title')) { board.title = input.value.trim() || 'Untitled canvas'; changed(); }
    else if (input.matches('.canvas-edge-label')) { const edge = board.edges.find(e => e.id === selectedEdge); if (edge) { edge.label = input.value; changed(); paintEdges(); } }
    else if (input.matches('.canvas-library-search')) { librarySearch = input.value; libraryResults(); }
    else if (input.matches('.canvas-ai-prompt')) aiPrompt = input.value;
  }, { signal });
  container.addEventListener('select', event => { if (event.target.matches('.canvas-note-text')) highlightedText = event.target.value.slice(event.target.selectionStart, event.target.selectionEnd); }, { signal });
  container.addEventListener('change', event => {
    if (event.target.matches('.canvas-use-context')) useContext = event.target.checked;
    if (event.target.matches('.canvas-library-type')) { libraryType = event.target.value; libraryResults(); }
    if (event.target.matches('.canvas-file')) { void upload(event.target.files).catch(error => notify(error.message)); event.target.value = ''; }
  }, { signal });
  container.addEventListener('submit', event => {
    if (!event.target.matches('.canvas-ai-settings')) return;
    event.preventDefault(); const form = event.target;
    try { const data = new FormData(form), endpoint = aiEndpoint(data.get('endpoint')), model = data.get('model').trim(), key = data.get('key').trim(); if (!model || !key) throw new Error('Enter a model and API key.'); provider = { endpoint, model, key }; form.reset(); panelMode = 'inspect'; inspect(); notify('AI provider connected for this session.'); }
    catch (error) { form.querySelector('[role=status]').textContent = error.message; }
  }, { signal });
  stage.addEventListener('dblclick', event => { if (!event.target.closest('.canvas-card,.canvas-tools,.canvas-navigation,[data-edge],button')) addNote(point(event.clientX, event.clientY)); }, { signal });
  stage.addEventListener('pointerdown', event => {
    if (event.button > 1 || event.target.closest('.canvas-tools,.canvas-navigation,.canvas-connection-hint,[data-edge]')) return;
    const card = event.target.closest('.canvas-card'), resize = event.target.closest('[data-resize]');
    if (event.target.closest('button') && !resize) return;
    if (connecting && card) return;
    const node = card && nodeById(card.dataset.id);
    if (node && !space && event.button !== 1) { select(node.id); }
    gesture = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, node: node && !space && event.button !== 1 ? node : null, resize: Boolean(resize), original: node && !space && event.button !== 1 ? { ...node } : { ...board.viewport }, moved: false };
    stage.setPointerCapture?.(event.pointerId); event.preventDefault();
  }, { signal });
  stage.addEventListener('pointermove', event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const g = gesture, dx = event.clientX - g.startX, dy = event.clientY - g.startY;
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    if (!g.moved && g.node) remember(); g.moved = true;
    if (g.node) {
      if (g.resize) { g.node.width = clamp(g.original.width + dx / board.viewport.zoom, 180, 1000); g.node.height = clamp(g.original.height + dy / board.viewport.zoom, 140, 1400); }
      else { g.node.x = clamp(g.original.x + dx / board.viewport.zoom, -50000, 50000); g.node.y = clamp(g.original.y + dy / board.viewport.zoom, -50000, 50000); }
      paintCard(g.node.id);
    } else { board.viewport.x = clamp(g.original.x + dx, -100000, 100000); board.viewport.y = clamp(g.original.y + dy, -100000, 100000); const v = board.viewport; $('.canvas-world').style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`; stage.style.backgroundPosition = `${v.x}px ${v.y}px`; }
  }, { signal });
  function endGesture(event) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const moved = gesture.moved;
    if (stage.hasPointerCapture?.(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    if (moved) changed(0);
    gesture = null;
  }
  stage.addEventListener('pointerup', endGesture, { signal }); stage.addEventListener('pointercancel', endGesture, { signal });
  stage.addEventListener('wheel', event => {
    if (event.target.closest('.canvas-tools,.canvas-navigation')) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) { const r = stage.getBoundingClientRect(); zoom(board.viewport.zoom * Math.exp(-event.deltaY * .006), { x: event.clientX - r.left, y: event.clientY - r.top }); }
    else { board.viewport.x = clamp(board.viewport.x - event.deltaX, -100000, 100000); board.viewport.y = clamp(board.viewport.y - event.deltaY, -100000, 100000); paint(); changed(); }
  }, { signal, passive: false });
  stage.addEventListener('dragover', event => { event.preventDefault(); stage.classList.add('is-dropping'); }, { signal });
  stage.addEventListener('dragleave', event => { if (!stage.contains(event.relatedTarget)) stage.classList.remove('is-dropping'); }, { signal });
  stage.addEventListener('drop', event => { event.preventDefault(); stage.classList.remove('is-dropping'); void upload(event.dataTransfer.files, point(event.clientX, event.clientY)).catch(error => notify(error.message)); }, { signal });
  doc.addEventListener('paste', event => {
    if (doc.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(doc.activeElement.tagName)) return;
    const files = [...(event.clipboardData?.files || [])];
    if (files.length) { event.preventDefault(); void upload(files).catch(error => notify(error.message)); }
    else { const text = event.clipboardData?.getData('text/plain'); if (text) { event.preventDefault(); addNote(null, { text: text.slice(0, 20000) }); } }
  }, { signal });
  doc.addEventListener('keydown', event => {
    if (doc.querySelector('dialog[open]') || event.defaultPrevented) return;
    const inField = /INPUT|TEXTAREA|SELECT/.test(event.target.tagName);
    if (event.key === 'Escape') { connecting = ''; selected = ''; selectedEdge = ''; paint(); inspect(); return; }
    if (inField) return;
    const key = event.key.toLowerCase(), command = event.metaKey || event.ctrlKey;
    if (key === ' ' && !command) { space = true; event.preventDefault(); }
    else if (command && key === 's') { event.preventDefault(); void save(); }
    else if (command && (key === 'z' || key === 'y')) { event.preventDefault(); $(`[data-canvas-action=${key === 'y' || event.shiftKey ? 'redo' : 'undo'}]`).click(); }
    else if (event.target.closest('[data-edge]') && (key === 'enter' || key === ' ')) { event.preventDefault(); selectedEdge = event.target.closest('[data-edge]').dataset.edge; selected = ''; panelMode = 'inspect'; $('.canvas-panel').hidden = false; inspect(); paintEdges(); }
    else if (event.target.closest('.canvas-card') && (key === 'enter' || key === ' ')) { event.preventDefault(); select(event.target.closest('.canvas-card').dataset.id); $('.canvas-panel').hidden = false; $('.canvas-note-text')?.focus(); }
    else if (event.target.closest('.canvas-card') && key.startsWith('arrow')) {
      event.preventDefault(); const node = nodeById(event.target.closest('.canvas-card').dataset.id), step = event.shiftKey ? 20 : 10; selected = node.id; remember();
      if (event.target.matches('[data-resize]')) { if (key === 'arrowright' || key === 'arrowleft') node.width = clamp(node.width + (key === 'arrowright' ? step : -step), 180, 1000); else node.height = clamp(node.height + (key === 'arrowdown' ? step : -step), 140, 1400); }
      else { if (key === 'arrowright' || key === 'arrowleft') node.x = clamp(node.x + (key === 'arrowright' ? step : -step), -50000, 50000); else node.y = clamp(node.y + (key === 'arrowdown' ? step : -step), -50000, 50000); }
      paintCard(node.id); paintSelection(); changed();
    } else if (key === 'n' && !command && !event.altKey) { event.preventDefault(); event.stopImmediatePropagation(); addNote(); }
    else if ((key === 'backspace' || key === 'delete') && (selected || selectedEdge)) { event.preventDefault(); $(`[data-canvas-action=${selectedEdge ? 'remove-edge' : 'remove'}]`)?.click(); }
  }, { signal, capture: true });
  doc.addEventListener('keyup', event => { if (event.key === ' ') space = false; }, { signal });
  win.addEventListener('blur', () => { space = false; }, { signal });
  win.addEventListener('beforeunload', event => { if (dirty) { void save(); event.preventDefault(); event.returnValue = ''; } }, { signal });
  void (async () => {
    if (localProvider === null) {
      try { const response = await fetch(new URL('api/canvas/ai', doc.baseURI), { cache: 'no-store', signal }); if (response.ok && response.headers.get('content-type')?.includes('application/json')) localProvider = await response.json(); else localProvider = { configured: false }; }
      catch { localProvider = { configured: false }; }
    }
    if (!destroyed && panelMode === 'inspect' && !container.contains(doc.activeElement)) inspect();
  })();
  if (dirty) changed();
  return { flush: save, getBoard: () => structuredClone(board), destroy() { clearTimeout(timer); void save(); destroyed = true; aiController?.abort(); abort.abort(); } };
}
