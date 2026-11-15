import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { setupResearch } from '../web/research.mjs';

test('search modes stay synchronized and dismissing or editing search preserves research', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'charta-search-ui-'));
  const dom = new JSDOM('<body><div class="library-search-surface"><label><input data-library-search></label></div><div class="library-search-surface"><label><input data-library-search></label></div><div id="search-dropdown" hidden><span id="search-results-label"></span><span id="search-results-count"></span><div id="search-results"></div><div class="search-footer"></div></div><main class="research-content"></main></body>', { url: 'http://localhost/' });
  try {
    await cp(new URL('../web/archive-search.mjs', import.meta.url), path.join(directory, 'archive-search.mjs'));
    await cp(new URL('../shared', import.meta.url), path.join(directory, 'shared'), { recursive: true });
    const { setupArchiveSearch } = await import(pathToFileURL(path.join(directory, 'archive-search.mjs')));
    const { document } = dom.window, popup = document.getElementById('search-dropdown'), results = document.getElementById('search-results'), root = document.querySelector('main');
    const catalog = { folders: [], collections: [], blocks: [{ id: 'one', title: 'Biotech report', type: 'text', body: 'biotech investment', tags: [] }] };
    const requests = [], pending = [], routes = [];
    const fetch = (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('hybrid')) return Promise.resolve(Response.json({ results: [{ id: 'one', entity: 'block' }] }));
      return new Promise(resolve => pending.push(resolve));
    };
    const research = setupResearch({ document, getCatalog: () => catalog, fetch, loadThinking: () => Promise.reject(),
      navigate(hash) { routes.push(hash); popup.hidden = true; research.render(root, hash.split('/')[2]); },
    });
    const controller = setupArchiveSearch({ document, getCatalog: () => catalog, research, fetch,
      open(input) { input.closest('.library-search-surface').append(popup); popup.hidden = false; },
      renderItems(rows) { results.innerHTML = rows.map(row => `<button class="search-result" data-id="${row.id}"><strong>Biotech report</strong></button>`).join(''); },
    });
    const [input, header] = document.querySelectorAll('input');
    input.value = ''; assert.equal(controller.update(input), false); assert.equal(popup.hidden, true);
    input.value = 'biotech'; controller.update(input); assert.match(results.textContent, /Biotech/);
    await pause(260); assert.equal(requests.length, 1); assert.match(requests[0].url, /hybrid$/);
    document.querySelector('[data-search-mode=ask]').click();
    assert.equal(input.dataset.searchMode, 'ask'); assert.equal(header.dataset.searchMode, 'ask');
    assert.equal(requests.length, 1, 'switching modes never spends a ChatGPT turn');
    assert.equal(document.querySelectorAll('[data-research-link]').length, 2);
    const enter = () => input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    enter(); assert.equal(requests.length, 2); assert.equal(popup.hidden, true);
    assert.equal(root.querySelector('.research-reading').getAttribute('aria-busy'), 'true');
    const first = routes.at(-1).split('/')[2];
    controller.cancel(); input.value = 'a newer question'; controller.update(input);
    assert.equal(requests[1].options.signal.aborted, false, 'closing or editing search cannot cancel research');
    enter(); const second = routes.at(-1).split('/')[2]; assert.notEqual(first, second);
    pending[0](Response.json({ summary: 'OLDER ANSWER', resources: [], limitations: [] })); await pause(0);
    assert.equal(root.textContent.includes('OLDER ANSWER'), false, 'older requests cannot replace the selected question');
    pending[1](Response.json({ summary: 'Useful <img src=x onerror=alert(1)> [one]', resources: [{ id: 'one', reason: 'An investment perspective', evidence: [{ text: '<script>untrusted source</script>' }] }], limitations: ['Publication date unknown.'], retrieved: [{ id: 'one' }] })); await pause(0);
    assert.match(root.textContent, /investment perspective/); assert.match(root.textContent, /Publication date unknown/);
    assert.match(root.textContent, /\[1\]/); assert.equal(root.querySelector('img,script'), null);
    assert.equal(root.querySelector('[data-action=open-block]').tabIndex, 0);
    assert.equal(root.querySelector('.research-reading').getAttribute('aria-busy'), null);
    assert.equal(root.querySelector('blockquote').textContent, '<script>untrusted source</script>');
    research.render(root, first); assert.match(root.textContent, /OLDER ANSWER/, 'previous answers remain in history');
    input.value = 'biotech'; enter(); assert.equal(requests.length, 3, 'reopening completed research never spends another ChatGPT turn');
    controller.cancel(); research.unmount();
  } finally { dom.window.close(); await rm(directory, { recursive: true, force: true }); }
});
