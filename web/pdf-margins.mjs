const SVG = 'http://www.w3.org/2000/svg';

/** A viewport overlay keeps notes outside PDF.js's pages and text layer. */
export function setupPDFMargins({ container, scroll, pages, onWidthChange }) {
  const doc = container.ownerDocument, view = doc.defaultView;
  const stage = container.querySelector('.reader-document');
  const abort = new view.AbortController();
  const layer = doc.createElement('aside'); layer.className = 'reader-margin-layer'; layer.setAttribute('aria-label', 'Notes beside the document');
  const lines = doc.createElementNS(SVG, 'svg'); lines.classList.add('reader-margin-connectors'); lines.setAttribute('aria-hidden', 'true');
  const cards = doc.createElement('div'); cards.className = 'reader-margin-cards';
  layer.append(lines, cards); stage.append(layer);
  let records = [], frame = 0, destroyed = false, expanded = false, active = '', selected = '';
  const listen = (target, event, callback) => target.addEventListener(event, callback, { signal: abort.signal });

  function setActive(id = '') {
    active = id;
    for (const node of container.querySelectorAll('[data-reader-note]')) node.classList.toggle('is-active', node.dataset.readerNote === active);
  }
  function updateMode() {
    const next = records.length > 0 && stage.clientWidth >= 640;
    const changed = next !== expanded;
    expanded = next;
    if (records.length) container.dataset.marginNotes = expanded ? 'expanded' : 'compact';
    else delete container.dataset.marginNotes;
    layer.hidden = !records.length;
    if (changed) for (const record of records) record.height = 0;
    return changed;
  }
  function layout() {
    if (destroyed) return;
    const modeChanged = updateMode();
    if (modeChanged) onWidthChange?.(expanded);
    if (!records.length) { pages.style.removeProperty('--reader-notes-bottom'); return; }
    const bounds = stage.getBoundingClientRect(), width = stage.clientWidth, height = stage.clientHeight;
    if (!width || !height) return;
    lines.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const pageBounds = new Map([...pages.querySelectorAll('.page[data-page-number]')].map(page => [Number(page.dataset.pageNumber), page.getBoundingClientRect()]));
    let previousBottom = -Infinity;
    for (const record of records) {
      const page = pageBounds.get(record.note.page);
      if (!page?.width || !page.height) { record.card.hidden = true; record.line.setAttribute('hidden', ''); continue; }
      // Start the connector at the end of the first selected line, including
      // selections whose first line consists of several PDF text fragments.
      const first = record.note.rects.reduce((a, b) => b[1] < a[1] ? b : a);
      const right = Math.max(...record.note.rects.filter(rect => Math.abs(rect[1] - first[1]) < first[3] / 2).map(rect => rect[0] + rect[2]));
      const x = page.left - bounds.left + right * page.width;
      const y = page.top - bounds.top + (first[1] + first[3] / 2) * page.height;
      if (!record.height) { record.card.hidden = false; record.height = record.card.offsetHeight || (expanded ? 90 : 28); }
      const cardHeight = record.height;
      const cardWidth = expanded ? 200 : 28;
      const left = width - cardWidth - (expanded ? 12 : 8);
      const top = Math.max(y - (expanded ? 20 : 14), previousBottom + 10);
      previousBottom = top + cardHeight;
      Object.assign(record.card.style, { left: `${left}px`, top: `${top}px` });
      record.card.hidden = previousBottom < 0 || top > height;
      const endY = top + (expanded ? 20 : 14);
      const visible = Math.max(y, previousBottom) >= 0 && Math.min(y, top) <= height && x >= 0 && x < left;
      record.line.toggleAttribute('hidden', !visible);
      record.path.setAttribute('d', `M ${x} ${y} C ${x + Math.max(12, (left - x) * .45)} ${y}, ${left - 18} ${endY}, ${left} ${endY}`);
      record.dot.setAttribute('cx', String(x)); record.dot.setAttribute('cy', String(y));
    }
    // Stacked notes near the final paragraph must remain reachable by scrolling.
    const lastPage = [...pageBounds.values()].at(-1);
    const extra = lastPage ? Math.max(0, previousBottom - (lastPage.bottom - bounds.top) + 24) : 0;
    pages.style.setProperty('--reader-notes-bottom', `${Math.ceil(extra)}px`);
  }
  function schedule() { if (!destroyed && !frame) frame = view.requestAnimationFrame(() => { frame = 0; layout(); }); }
  function render(annotations) {
    const notes = annotations.filter(note => note.comment.trim()).slice().sort((a, b) => a.page - b.page || Math.min(...a.rects.map(rect => rect[1])) - Math.min(...b.rects.map(rect => rect[1])));
    if (notes.length === records.length && notes.every((note, index) => note === records[index].note && note.comment === records[index].comment && note.color === records[index].color)) {
      setActive(active); schedule(); return;
    }
    lines.replaceChildren(); cards.replaceChildren();
    records = notes.map((note, index) => {
      const card = doc.createElement('button'); card.type = 'button'; card.className = 'reader-margin-note'; card.dataset.readerNote = note.id; card.dataset.color = note.color;
      card.setAttribute('aria-label', `Note ${index + 1} on page ${note.page}: ${note.comment}`); card.title = note.comment;
      const number = doc.createElement('span'); number.className = 'reader-margin-number'; number.textContent = String(index + 1);
      const label = doc.createElement('small'); label.textContent = `NOTE ${index + 1} · PAGE ${note.page}`;
      const text = doc.createElement('span'); text.className = 'reader-margin-text'; text.textContent = note.comment;
      card.append(number, label, text); cards.append(card);
      const line = doc.createElementNS(SVG, 'g'); line.classList.add('reader-margin-link'); line.dataset.readerNote = note.id; line.dataset.color = note.color;
      const path = doc.createElementNS(SVG, 'path'), dot = doc.createElementNS(SVG, 'circle'); dot.setAttribute('r', '2.5');
      line.append(path, dot); lines.append(line);
      return { note, comment: note.comment, color: note.color, card, line, path, dot, height: 0 };
    });
    setActive(active); layout();
  }
  listen(scroll, 'scroll', schedule);
  listen(view, 'resize', () => { for (const record of records) record.height = 0; schedule(); });
  listen(container, 'pointerover', event => { const note = event.target.closest('[data-reader-note]'); if (note) setActive(note.dataset.readerNote); });
  listen(container, 'pointerout', event => { if (event.target.closest('[data-reader-note]') && !event.relatedTarget?.closest?.('[data-reader-note]')) setActive(selected); });
  listen(container, 'focusin', event => { const note = event.target.closest('[data-reader-note],[data-reader-comment]'); if (note) { selected = note.dataset.readerNote || note.dataset.readerComment; setActive(selected); } });
  const resize = view.ResizeObserver ? new view.ResizeObserver(() => { for (const record of records) record.height = 0; schedule(); onWidthChange?.(false); }) : null;
  resize?.observe(stage);
  return {
    render, schedule,
    select(id) { selected = id; setActive(id); },
    destroy() { destroyed = true; view.cancelAnimationFrame(frame); resize?.disconnect(); abort.abort(); layer.remove(); delete container.dataset.marginNotes; pages.style.removeProperty('--reader-notes-bottom'); },
  };
}
