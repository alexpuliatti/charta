const DAY = 86400000;
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const isoDay = time => new Date(time).toISOString().slice(0, 10);
const timestamp = value => typeof value === 'string' || value instanceof Date ? Date.parse(value) : NaN;
const number = value => value.toLocaleString('en-GB');

/** Twenty-six UTC calendar weeks, including the current week. */
export function buildActivity(catalog, now = new Date()) {
  const instant = now instanceof Date ? now.valueOf() : new Date(now).valueOf();
  if (!Number.isFinite(instant)) throw new Error('Activity needs a valid date.');
  const current = new Date(instant);
  const todayTime = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate());
  const startTime = todayTime - (current.getUTCDay() + 25 * 7) * DAY;
  const endTime = startTime + (26 * 7 - 1) * DAY;
  const counts = new Map();
  for (const block of catalog?.blocks || []) {
    const created = timestamp(block.createdAt);
    if (!Number.isFinite(created)) continue;
    const date = isoDay(created);
    if (date < isoDay(startTime) || date > isoDay(todayTime)) continue;
    counts.set(date, (counts.get(date) || 0) + 1);
  }
  const maxCount = Math.max(0, ...counts.values());
  const months = [];
  let previousMonth = '';
  const weeks = Array.from({ length: 26 }, (_, week) => Array.from({ length: 7 }, (_, day) => {
    const time = startTime + (week * 7 + day) * DAY;
    const date = isoDay(time);
    const calendar = new Date(time);
    const month = date.slice(0, 7);
    if (month !== previousMonth) {
      months.push({ label: calendar.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }), column: week });
      previousMonth = month;
    }
    const count = counts.get(date) || 0;
    return { date, count, level: count ? Math.max(1, Math.ceil(count / maxCount * 4)) : 0, future: time > todayTime };
  }));
  return { start: isoDay(startTime), end: isoDay(endTime), today: isoDay(todayTime), total: [...counts.values()].reduce((sum, count) => sum + count, 0), maxCount, weeks, months };
}

const icon = name => {
  const paths = {
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 4.5 4.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
    collection: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 5V3m8 2V3M4 10h16"/>',
    network: '<circle cx="6" cy="12" r="2.5"/><circle cx="17" cy="5" r="2.5"/><circle cx="17" cy="19" r="2.5"/><path d="m8.5 10.5 6-4m-6 7 6 4M17 7.5v9"/>',
    arrow: '<path d="M7 17 17 7M7 7h10v10"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.collection}</svg>`;
};

export function renderDashboard(catalog, { now } = {}) {
  const activity = buildActivity(catalog, now);
  const blocks = Array.isArray(catalog?.blocks) ? catalog.blocks : [];
  const byId = new Map(blocks.map(block => [block.id, block]));
  const blockIds = new Set(blocks.map(block => block.id));
  const collections = (Array.isArray(catalog?.collections) ? catalog.collections : [])
    .filter(collection => !collection.source?.external && collection.source?.arena?.importScope !== 'reference' && !collection.path?.startsWith('content/collections/archive/'))
    .map(collection => {
      const ids = [...new Set((collection.items || []).filter(item => item.kind === 'block' && blockIds.has(item.id)).map(item => item.id))];
      return { ...collection, count: ids.length, latest: Math.max(timestamp(collection.updatedAt) || 0, timestamp(collection.createdAt) || 0, ...ids.map(id => timestamp(byId.get(id)?.createdAt) || 0)) };
    })
    .sort((a, b) => b.latest - a.latest || String(a.title).localeCompare(String(b.title)) || String(a.id).localeCompare(String(b.id)))
    .slice(0, 3);
  const readingCount = blocks.filter(block => block.type === 'link' || block.type === 'text').length;
  const countLabel = count => `${number(count)} material${count === 1 ? '' : 's'}`;
  const heatmap = activity.weeks.map(week => `<span class="dashboard-heatmap-week">${week.map(day => `<span class="dashboard-heatmap-day" data-level="${day.level}"${day.future ? ' data-future="true"' : ''} title="${day.date}: ${day.future ? 'future date' : countLabel(day.count)}"></span>`).join('')}</span>`).join('');
  const months = activity.months.filter((month, index, all) => !all[index + 1] || all[index + 1].column - month.column >= 3).map(month => `<span style="grid-column:${month.column + 1}">${month.label}</span>`).join('');
  return `<section class="archive-dashboard" aria-label="Archive">
    <div class="dashboard-brand"><h1 aria-label="Charta"><svg class="dashboard-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="64" height="64" fill="none" aria-hidden="true" focusable="false"><g class="charta-mark"><path d="M36 8H18L8 18v12l10 10h18v-8H22l-6-6v-4l6-6h14V8Z" fill="#EAE7DF"/><path class="charta-fold" d="M28 8h8v8l-8-8Z" fill="#96958F"/></g></svg></h1></div>
    <span class="dashboard-brand-accent gradient-line-base gradient-line-horizontal gradient-line-taper" aria-hidden="true"></span>
    <div class="dashboard-search-frame spotlight-card"><span class="search-spotlight" aria-hidden="true"></span><div class="dashboard-search-panel"><div class="library-search-surface"><label class="dashboard-search" for="library-search">${icon('search')}<input class="search-input" id="library-search" data-library-search type="search" role="combobox" aria-autocomplete="list" aria-controls="search-results" aria-expanded="false" aria-label="Search materials and collections" placeholder="Search your archive…" autocomplete="off" spellcheck="false"><kbd>⌘ K</kbd></label></div><div class="dashboard-search-tools"><button class="add-resource-launch" data-action="add-resource">${icon('plus')}Add resource</button><button data-action="view-network">${icon('network')}Connections</button></div></div></div>
    <div class="dashboard-cards">
      <section class="dashboard-card dashboard-activity"><div class="dashboard-card-heading"><h2>Activity</h2><span>26 weeks</span></div><div class="dashboard-activity-summary"><strong class="dashboard-activity-total">${number(activity.total)}</strong><span>material${activity.total === 1 ? '' : 's'} saved</span></div><div class="dashboard-heatmap" role="img" aria-label="${escape(countLabel(activity.total))} saved from ${activity.start} to ${activity.today}"><div class="dashboard-heatmap-grid" aria-hidden="true">${heatmap}</div><div class="dashboard-heatmap-months" aria-hidden="true">${months}</div></div></section>
      <section class="dashboard-card dashboard-recents"><div class="dashboard-card-heading"><h2>Recent collections</h2>${icon('collection')}</div><div class="dashboard-recent-list">${collections.length ? collections.map(collection => `<button class="dashboard-recent" data-action="open-collection" data-id="${escape(collection.id)}">${icon('collection')}<span class="dashboard-recent-title"><span class="gradient-underline gradient-underline-hover">${escape(collection.title)}</span></span><span class="dashboard-recent-count">${number(collection.count)}</span>${icon('arrow')}</button>`).join('') : '<p class="dashboard-empty">No collections yet.</p>'}</div></section>
      <section class="dashboard-card dashboard-reading-count"><div class="dashboard-card-heading"><h2>Connections</h2>${icon('network')}</div><div class="dashboard-network-summary"><strong class="dashboard-reading-total">${number(readingCount)}</strong><svg class="dashboard-network-art" viewBox="0 0 88 72" fill="none" aria-hidden="true"><defs><linearGradient id="dashboard-orbit-gradient" x1="12" y1="10" x2="76" y2="64" gradientUnits="userSpaceOnUse"><stop stop-color="#929292"/><stop offset=".52" stop-color="#b0b0b0"/><stop offset="1" stop-color="#d4d4d4"/></linearGradient></defs><g stroke="url(#dashboard-orbit-gradient)"><ellipse cx="44" cy="36" rx="33" ry="22" opacity=".2"/><ellipse cx="44" cy="36" rx="17" ry="32" transform="rotate(-35 44 36)" opacity=".35"/><path d="m17 23 27 13 25-13M44 36l12 26" opacity=".65"/></g><g fill="#1b1b1b" stroke="url(#dashboard-orbit-gradient)" stroke-width="1.5"><circle cx="17" cy="23" r="3"/><circle cx="69" cy="23" r="3"/><circle cx="56" cy="62" r="3"/><circle cx="44" cy="36" r="4"/></g></svg></div><p>Links and notes</p><button class="dashboard-network-link" data-action="view-network"><span class="gradient-underline gradient-underline-hover">Explore connections</span>${icon('arrow')}</button></section>
    </div>
  </section>`;
}
