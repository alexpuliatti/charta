const STORAGE_KEY = 'charta.research.v1';
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const validAnswer = value => value && typeof value.summary === 'string' && Array.isArray(value.resources)
  && value.resources.every(resource => typeof resource?.id === 'string' && typeof resource.reason === 'string'
    && (resource.evidence === undefined || (Array.isArray(resource.evidence) && resource.evidence.every(passage => typeof passage?.text === 'string'))))
  && (value.limitations === undefined || (Array.isArray(value.limitations) && value.limitations.every(note => typeof note === 'string')))
  && (value.retrieved === undefined || (Array.isArray(value.retrieved) && value.retrieved.every(row => typeof row?.id === 'string')));

export function setupResearch({ document, getCatalog, navigate, fetch: request = globalThis.fetch,
  loadThinking = () => import('./vendor/archive-thinking-react.mjs') }) {
  const view = document.defaultView, running = new Map();
  let entries = [], draft = '', root = null, selectedId = '', storageAvailable = true, thinking, renderedCatalog;
  try {
    const saved = JSON.parse(view.localStorage.getItem(STORAGE_KEY) || '{}');
    draft = typeof saved?.draft === 'string' ? saved.draft.slice(0, 3000) : '';
    entries = (Array.isArray(saved?.entries) ? saved.entries : []).filter(entry => typeof entry?.id === 'string' && /^[\w-]+$/.test(entry.id) && typeof entry.query === 'string' && entry.query.length <= 3000).map(entry => ({
      id: entry.id, query: entry.query, createdAt: entry.createdAt,
      status: entry.status === 'complete' && validAnswer(entry.answer) ? 'complete' : ['cancelled', 'error'].includes(entry.status) ? entry.status : 'interrupted',
      answer: validAnswer(entry.answer) ? entry.answer : null,
      error: typeof entry.error === 'string' ? entry.error : '',
    }));
  } catch { storageAvailable = false; }

  function save() {
    try { view.localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries, draft })); storageAvailable = true; }
    catch { storageAvailable = false; }
  }
  function refresh() {
    for (const link of document.querySelectorAll('[data-research-link]')) {
      link.dataset.running = String(running.size);
      link.setAttribute('aria-label', running.size ? `Research, ${running.size} in progress` : 'Research history');
    }
  }
  function stopThinking() { thinking?.destroy(); thinking = null; }
  function status(entry) {
    const count = entry.answer?.resources.length || 0;
    return ({ running: 'Researching…', complete: `${count} ${count === 1 ? 'source' : 'sources'}`, cancelled: 'Cancelled', interrupted: 'Interrupted', error: 'Needs attention' })[entry.status];
  }
  function answerHTML(answer) {
    const blocks = new Map((getCatalog()?.blocks || []).map(block => [block.id, block]));
    const summary = answer.summary.replace(/\[([^\]]+)\]/g, (_, id) => { const index = answer.resources.findIndex(resource => resource.id === id); return index >= 0 ? `[${index + 1}]` : ''; });
    const limitations = [...(answer.limitations || []), ...(answer.warning ? [answer.warning] : [])];
    const resources = answer.resources.map((resource, index) => {
      const block = blocks.get(resource.id);
      return `<article class="research-source"><div class="research-source-heading"><span class="research-source-number">${index + 1}</span>${block ? `<button type="button" data-action="open-block" data-id="${escape(block.id)}">${escape(block.title)}<span aria-hidden="true">↗</span></button>` : '<strong>Resource no longer in this library</strong>'}</div><p>${escape(resource.reason)}</p>${resource.evidence?.length ? `<details><summary>Source excerpts</summary>${resource.evidence.map(passage => `<blockquote>${escape(passage.text)}</blockquote>`).join('')}</details>` : ''}</article>`;
    }).join('');
    const selected = new Set(answer.resources.map(resource => resource.id));
    const more = (answer.retrieved || []).filter(row => !selected.has(row.id) && blocks.has(row.id));
    return `<div class="research-summary">${escape(summary)}</div>${limitations.length ? `<div class="research-limitations">${limitations.map(note => `<p>${escape(note)}</p>`).join('')}</div>` : ''}<h3 class="research-sources-title">${answer.resources.length} ${answer.resources.length === 1 ? 'source' : 'sources'} from your archive</h3>${resources}${more.length ? `<details class="research-more"><summary>${more.length} more matching resources</summary>${more.map(row => `<button type="button" data-action="open-block" data-id="${escape(row.id)}">${escape(blocks.get(row.id).title)}</button>`).join('')}</details>` : ''}`;
  }
  function paint(changedId, keepReading = false) {
    refresh();
    if (!root?.isConnected || !root.classList.contains('research-content')) return;
    const preserveReading = (keepReading || (changedId && changedId !== selectedId)) && root.querySelector('.research-reading');
    const focused = document.activeElement === root.querySelector('textarea');
    const selection = focused ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    if (!preserveReading) stopThinking();
    const entry = entries.find(item => item.id === selectedId);
    const next = document.createElement('div');
    next.innerHTML = `<div class="research-workspace"><aside class="research-history" aria-label="Research history"><div class="research-history-heading"><h2>Your research</h2><a href="#/research/new" class="research-new" aria-label="New research">+ New</a></div>${entries.length ? `<nav aria-label="Saved research">${entries.map(item => {
      const date = new Date(item.createdAt);
      return `<a class="research-history-item" href="#/research/${escape(item.id)}"${item.id === selectedId ? ' aria-current="page"' : ''}><span>${escape(item.query)}</span><small><span class="research-state" data-state="${escape(item.status)}">${status(item)}</span>${Number.isNaN(+date) ? '' : `<time datetime="${escape(item.createdAt)}">${escape(date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</time>`}</small></a>`;
    }).join('')}</nav>` : '<p class="research-history-empty">Your questions and answers will be kept here.</p>'}<p class="research-storage" role="status">${storageAvailable ? 'Saved in this browser' : 'Browser storage unavailable. Keep this tab open to retain your research.'}</p></aside><section class="research-reading" aria-label="${entry ? 'Research answer' : 'New research'}">${entry ? `<div class="research-question-meta"><span class="research-state" data-state="${entry.status}" role="status">${status(entry)}</span></div><h2 class="research-question" tabindex="-1">${escape(entry.query)}</h2>${entry.status === 'complete' ? answerHTML(entry.answer) : entry.status === 'running' ? '<div class="research-progress" role="status"><span class="research-progress-dot" aria-hidden="true"></span><div><strong>Reading your archive</strong><p>You can browse elsewhere. Your answer will be waiting here.</p></div></div><button type="button" class="research-secondary" data-research-cancel>Cancel research</button>' : `<div class="research-notice" role="status">${escape(entry.status === 'interrupted' ? 'This request was interrupted when the page closed. Your question is saved; try again when you’re ready.' : entry.status === 'cancelled' ? 'Research cancelled. Your question is kept here.' : entry.error || 'Research could not complete. Please try again.')}</div><button type="button" class="research-secondary" data-research-retry>Try again</button>`}` : `<div class="research-compose-intro"><span class="research-eyebrow">ASK YOUR ARCHIVE</span><h2>Start with a question.</h2><p>Find connections, explore an idea, or bring together the resources you’ve saved.</p></div><form class="research-compose"><label for="research-question">What would you like to explore?</label><textarea id="research-question" name="query" maxlength="3000" rows="5" placeholder="How is interface design evolving with AI?" required>${escape(draft)}</textarea><div class="research-compose-footer"><span>Your question and answer are saved here automatically.</span><button type="submit">Ask archive <span aria-hidden="true">↗</span></button></div></form><p class="research-privacy">ChatGPT subscription · selected excerpts are sent to OpenAI</p>`}</section></div>`;
    if (preserveReading) { root.querySelector('.research-history').replaceWith(next.querySelector('.research-history')); return; }
    root.replaceChildren(...next.childNodes);
    const progress = root.querySelector('.research-progress');
    if (progress) {
      progress.innerHTML = '<div class="archive-thinking-visual" aria-hidden="true"><span class="archive-thinking-fallback"></span><div class="archive-thinking-orb" data-react-bits="Orb"></div></div><div class="archive-thinking-copy"><strong>Thinking with your archive</strong><p>Reading relevant resources with ChatGPT…<br>You can browse elsewhere. Your answer will be waiting here.</p></div>';
      const orb = progress.querySelector('.archive-thinking-orb');
      root.querySelector('.research-reading').setAttribute('aria-busy', 'true');
      loadThinking().then(api => {
        if (root?.contains(orb) && orb.isConnected && running.has(entry.id)) thinking = api.mountArchiveThinking(orb);
      }).catch(() => {});
    }
    root.querySelector('.research-compose')?.addEventListener('submit', event => { event.preventDefault(); start(root.querySelector('textarea').value); });
    root.querySelector('textarea')?.addEventListener('input', event => { draft = event.target.value; save(); const notice = root.querySelector('.research-storage'); if (notice && !storageAvailable) notice.textContent = 'Browser storage unavailable. Keep this tab open to retain your research.'; });
    root.querySelector('[data-research-cancel]')?.addEventListener('click', () => {
      running.get(entry.id)?.abort(); running.delete(entry.id); entry.status = 'cancelled'; save(); paint(entry.id);
    });
    root.querySelector('[data-research-retry]')?.addEventListener('click', () => run(entry));
    const input = root.querySelector('textarea');
    if (selection && input) { input.focus(); input.setSelectionRange(...selection); }
  }
  async function run(entry) {
    if (running.has(entry.id)) return;
    const controller = new AbortController();
    running.set(entry.id, controller); entry.status = 'running'; entry.error = ''; save(); paint(entry.id);
    try {
      const response = await request('./api/search/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: entry.query }), signal: controller.signal });
      let answer;
      try { answer = await response.json(); } catch { throw new Error('Start Charta locally with npm run dev to research your archive.'); }
      if (!response.ok) throw new Error(answer.error || 'Research could not complete. Please try again.');
      if (!validAnswer(answer)) throw new Error('The answer could not be read. Please try again.');
      if (controller.signal.aborted) return;
      entry.answer = answer; entry.status = 'complete';
    } catch (error) {
      if (controller.signal.aborted) return;
      entry.status = 'error'; entry.error = error.message || 'ChatGPT is unavailable. Please try again.';
    } finally {
      // A cancelled request may already have been retried with another controller.
      if (running.get(entry.id) === controller) { running.delete(entry.id); save(); paint(entry.id); }
    }
  }
  function start(query) {
    query = query.trim().slice(0, 3000);
    if (!query || !getCatalog()) return;
    const existing = entries.find(entry => entry.query === query && ['running', 'complete'].includes(entry.status));
    if (existing) { navigate(`#/research/${existing.id}`); return; }
    const entry = { id: view.crypto.randomUUID(), query, createdAt: new Date().toISOString(), status: 'running', answer: null, error: '' };
    entries.unshift(entry); draft = ''; selectedId = entry.id;
    run(entry); navigate(`#/research/${entry.id}`);
  }
  return {
    start, refresh,
    unmount() { stopThinking(); root = null; },
    render(container, id) {
      const nextId = id === 'new' ? '' : id || entries[0]?.id || '';
      const keepReading = root === container && selectedId === nextId && renderedCatalog === getCatalog();
      root = container; selectedId = nextId; renderedCatalog = getCatalog();
      paint(undefined, keepReading);
      if (!id && selectedId) navigate(`#/research/${selectedId}`);
    },
  };
}
