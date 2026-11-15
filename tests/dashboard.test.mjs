import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildActivity, renderDashboard } from '../web/dashboard.mjs';

const now = new Date('2026-11-15T12:00:00Z');

test('activity uses real created dates in a stable 26-week UTC range', () => {
  const catalog = { blocks: [
    { createdAt: '2026-11-15T00:00:01Z' }, { createdAt: '2026-11-15T23:59:59Z' },
    { createdAt: '2026-11-14T23:00:00-02:00' },
    { createdAt: '2026-11-14T12:00:00Z', updatedAt: '2026-11-15T10:00:00Z' },
    { createdAt: '2026-01-01' }, { createdAt: '2026-11-16' },
    { createdAt: 'not a date' }, { updatedAt: '2026-11-15' }
  ] };
  const before = structuredClone(catalog);
  const activity = buildActivity(catalog, now);
  assert.equal(activity.weeks.length, 26);
  assert.ok(activity.weeks.every(week => week.length === 7));
  assert.equal(activity.start, '2026-05-24');
  assert.equal(activity.end, '2026-11-21');
  assert.equal(activity.today, '2026-11-15');
  assert.equal(activity.total, 4);
  assert.equal(activity.maxCount, 3);
  assert.deepEqual(activity.weeks.at(-1)[0], { date: '2026-11-15', count: 3, level: 4, future: false });
  assert.equal(activity.weeks.at(-1)[1].future, true);
  assert.equal(activity.weeks.at(-1)[1].count, 0);
  assert.deepEqual(catalog, before);
});

test('an empty archive has empty activity rather than illustrative data', () => {
  const activity = buildActivity({}, now);
  assert.equal(activity.total, 0);
  assert.equal(activity.maxCount, 0);
  assert.ok(activity.weeks.flat().every(day => day.count === 0 && day.level === 0));
  assert.throws(() => buildActivity({}, 'invalid'), /valid date/);
});

test('dashboard escapes collection data and limits its network count to text and links', () => {
  const html = renderDashboard({ blocks: [
    { id: 'b_link', type: 'link', createdAt: '2026-11-15' },
    { id: 'b_text', type: 'text', createdAt: '2026-11-14' },
    { id: 'b_image', type: 'image', createdAt: '2026-11-13' },
    { id: 'b_video', type: 'video' }, { id: 'b_audio', type: 'audio' }, { id: 'b_file', type: 'file' }
  ], collections: [
    { id: 'c_old', title: 'Older', updatedAt: '2026-05-01', items: [] },
    { id: 'c_new" onmouseover="bad()', title: '<img src=x onerror=bad()>', updatedAt: '2026-11-15', items: [{ kind: 'block', id: 'b_link' }, { kind: 'block', id: 'b_link' }, { kind: 'block', id: 'missing' }, { kind: 'collection', id: 'c_old' }] },
    { id: 'c_middle', title: 'Middle', createdAt: '2026-07-15', items: [] },
    { id: 'c_fourth', title: 'Fourth', updatedAt: '2026-01-01', items: [] },
    { id: 'c_reference', title: 'External Are.na', updatedAt: '2026-11-15', source: { arena: { importScope: 'reference' } }, items: [] },
    { id: 'c_external', title: 'External reference', updatedAt: '2026-11-15', source: { external: true }, items: [] }
  ] }, { now });
  const dom = new JSDOM(html);
  try {
    const document = dom.window.document;
    assert.equal(document.querySelector('h1').getAttribute('aria-label'), 'Charta');
    assert.equal(document.querySelector('h1').textContent.trim(), '', 'the logo has no visible wordmark');
    assert.ok(document.querySelector('h1 svg.dashboard-logo'));
    assert.equal(document.querySelector('.dashboard-reading-total').textContent, '2');
    assert.equal(document.querySelector('.dashboard-activity-total').textContent, '3', 'archive activity still includes saved images');
    assert.equal(document.querySelectorAll('.dashboard-heatmap-week').length, 26);
    assert.equal(document.querySelectorAll('.dashboard-heatmap-day').length, 182);
    assert.equal(document.querySelector('.dashboard-heatmap-day').title, '2026-05-24: 0 materials');
    const recents = [...document.querySelectorAll('.dashboard-recent')];
    assert.equal(recents.length, 3);
    assert.equal(recents[0].dataset.id, 'c_new" onmouseover="bad()');
    assert.equal(recents[0].querySelector('.dashboard-recent-title').textContent, '<img src=x onerror=bad()>');
    assert.equal(recents[0].querySelector('.dashboard-recent-count').textContent, '1');
    assert.equal(document.querySelector('img,[onmouseover],[onerror]'), null);
    assert.doesNotMatch(document.querySelector('.dashboard-recents').textContent, /External|Fourth/);
    assert.equal(document.querySelector('#library-search').tagName, 'INPUT');
    assert.equal(document.querySelector('#library-search').placeholder, 'Search your archive…');
    assert.equal(document.querySelector('[data-action="add-resource"]').textContent, 'Add resource');
    assert.equal(document.querySelectorAll('[data-action="view-network"]').length, 2);
  } finally { dom.window.close(); }
});
