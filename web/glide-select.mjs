/* Glide Select interaction adapted from React Bits by David Haz.
 * https://reactbits.dev/micro/glide-select · vendor/REACT-BITS-NOTICE.md */
export function setupGlideSelect(document, { selector = 'select.filter-select,.explore-filters select,.discover-controls select,.canvas-library-type' } = {}) {
  const view = document.defaultView, abort = new view.AbortController();
  const records = new Map(); let current = null, serial = 0, typeahead = '', typedAt = 0;
  const listen = (node, event, fn, options = {}) => node.addEventListener(event, fn, { ...options, signal: abort.signal });
  const motion = () => !view.matchMedia?.('(prefers-reduced-motion: reduce)').matches && document.documentElement.dataset.motionInput !== 'keyboard';
  const labelOf = select => {
    if (select.getAttribute('aria-label')) return select.getAttribute('aria-label');
    const label = select.labels?.[0]?.cloneNode(true);
    label?.querySelectorAll('select,button,.glide-control').forEach(node => node.remove());
    return label?.textContent.trim() || 'Choose an option';
  };
  function sync(record) {
    const { select, trigger } = record, label = select.selectedOptions[0]?.textContent || 'Choose…';
    if (trigger.firstChild.textContent !== label) trigger.firstChild.textContent = label;
    trigger.disabled = select.disabled;
    trigger.setAttribute('aria-label', `${record.name}: ${label}`);
  }
  function close({ focus = false, animate = false } = {}) {
    if (!current) return;
    const { list, record } = current; current = null;
    if (animate && motion() && list.animate) {
      list.setAttribute('aria-hidden', 'true'); list.setAttribute('inert', '');
      const exit = list.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateY(${list.dataset.side === 'above' ? 3 : -3}px) scale(.98)` }], { duration: 120, easing: 'cubic-bezier(.23,1,.32,1)', fill: 'forwards' });
      exit.finished.then(() => list.remove(), () => list.remove()); view.setTimeout(() => list.remove(), 160);
    } else list.remove();
    record.trigger.setAttribute('aria-expanded', 'false'); record.trigger.removeAttribute('aria-controls');
    if (focus) record.trigger.focus({ preventScroll: true });
  }
  function choose(index) {
    if (!current) return;
    const { record, options } = current, option = options[index];
    if (!option || option.disabled) return;
    const changed = record.select.value !== option.value;
    record.select.value = option.value; sync(record); close({ focus: true });
    if (changed) {
      record.select.dispatchEvent(new view.Event('change', { bubbles: true }));
      if (!record.trigger.isConnected) view.requestAnimationFrame(() => { refresh(); [...records.values()].find(item => item.key === record.key)?.trigger.focus({ preventScroll: true }); });
    }
  }
  function activate(index, keyboard = false) {
    if (!current) return;
    const { list, rows, highlight } = current, row = rows[index]; if (!row || row.disabled) return;
    current.active = index;
    rows.forEach((item, i) => item.classList.toggle('is-active', index === i));
    list.setAttribute('aria-activedescendant', row.id);
    highlight.style.transitionDuration = keyboard ? '0ms' : '';
    highlight.style.height = `${row.offsetHeight || 34}px`; highlight.style.transform = `translateY(${row.offsetTop}px)`;
    if (keyboard) row.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
  }
  function open(record, keyboard = false) {
    if (record.select.disabled) return;
    if (current?.record === record) { close({ focus: true, animate: !keyboard }); return; }
    close(); sync(record);
    const list = document.createElement('div'); list.className = 'glide-menu'; list.id = `glide-list-${++serial}`;
    list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', record.name); list.tabIndex = -1;
    const highlight = document.createElement('span'); highlight.className = 'glide-highlight'; highlight.setAttribute('aria-hidden', 'true'); list.append(highlight);
    const options = [...record.select.options], rows = options.map((option, i) => {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'glide-option'; row.id = `${list.id}-${i}`; row.tabIndex = -1;
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(option.selected)); row.disabled = option.disabled || option.parentElement.disabled === true;
      const label = document.createElement('span'); label.textContent = option.textContent; row.append(label);
      if (option.selected) { const check = document.createElement('span'); check.textContent = '✓'; check.setAttribute('aria-hidden', 'true'); row.append(check); }
      listen(row, 'click', () => choose(i)); listen(row, 'pointerover', () => activate(i)); list.append(row); return row;
    });
    current = { record, list, rows, options, highlight, active: -1 };
    if (typeof list.showPopover === 'function') list.setAttribute('popover', 'manual');
    (record.select.closest('dialog[open]') || document.body).append(list); list.showPopover?.();
    const rect = record.trigger.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 190), 360, view.innerWidth - 16); list.style.width = `${width}px`;
    const height = list.getBoundingClientRect().height, above = rect.bottom + height + 14 > view.innerHeight && rect.top > height + 14;
    list.dataset.side = above ? 'above' : 'below';
    list.style.left = `${Math.max(8, Math.min(rect.left, view.innerWidth - width - 8))}px`;
    list.style.top = `${Math.max(8, Math.min(above ? rect.top - height - 7 : rect.bottom + 7, view.innerHeight - height - 8))}px`;
    record.trigger.setAttribute('aria-expanded', 'true'); record.trigger.setAttribute('aria-controls', list.id);
    list.focus({ preventScroll: true }); activate(Math.max(0, options.findIndex(option => option.selected)), true);
    if (!keyboard && motion()) list.animate?.([{ opacity: 0, transform: `translateY(${above ? 4 : -4}px) scale(.97)` }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'cubic-bezier(.23,1,.32,1)' });
  }
  function refresh() {
    for (const [select, record] of records) {
      if (!select.isConnected) { if (current?.record === record) close(); records.delete(select); }
      else sync(record);
    }
    for (const select of document.querySelectorAll(selector)) {
      if (records.has(select) || select.multiple || select.size > 1) continue;
      const wrapper = document.createElement('span'); wrapper.className = 'glide-control';
      const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'glide-trigger';
      trigger.innerHTML = '<span></span><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
      const name = labelOf(select);
      const record = { select, trigger, wrapper, name, key: select.id || name, tabIndex: select.getAttribute('tabindex'), ariaHidden: select.getAttribute('aria-hidden') };
      select.before(wrapper); wrapper.append(select, trigger); select.classList.add('glide-native'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
      records.set(select, record); sync(record); listen(trigger, 'click', event => open(record, event.detail === 0));
    }
  }
  listen(document, 'change', event => { const record = records.get(event.target); if (record) sync(record); });
  listen(document, 'pointerdown', event => { if (current && !current.list.contains(event.target) && !current.record.wrapper.contains(event.target)) close({ animate: true }); }, { capture: true });
  listen(document, 'keydown', event => {
    if (event.isComposing) return;
    const record = [...records.values()].find(item => item.trigger === event.target);
    if (!current && record && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); open(record, true); return; }
    if (!current || (!current.list.contains(event.target) && current.record.trigger !== event.target)) return;
    if (event.key === 'Tab') { close({ focus: true }); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close({ focus: true }); return; }
    const { active, rows } = current; let next = active;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      for (let i = 1; i <= rows.length; i++) { const index = (active + direction * i + rows.length) % rows.length; if (!rows[index].disabled) { next = index; break; } }
    } else if (event.key === 'Home' || event.key === 'End') {
      const available = rows.map((row, i) => row.disabled ? -1 : i).filter(i => i >= 0); next = event.key === 'Home' ? available[0] : available.at(-1);
    } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopImmediatePropagation(); choose(active); return; }
    else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now(); typeahead = now - typedAt < 600 ? typeahead + event.key.toLowerCase() : event.key.toLowerCase(); typedAt = now;
      next = rows.findIndex(row => !row.disabled && row.textContent.toLowerCase().startsWith(typeahead));
    } else return;
    event.preventDefault(); event.stopImmediatePropagation(); activate(next, true);
  }, { capture: true });
  listen(document, 'scroll', event => { if (current && !current.list.contains(event.target)) close(); }, { capture: true });
  listen(view, 'resize', () => close()); listen(view, 'hashchange', () => close());
  listen(document, 'close', event => { if (current?.record.select.closest('dialog') === event.target) close(); }, { capture: true });
  refresh();
  return { refresh, close, destroy() {
    close(); abort.abort();
    for (const { select, wrapper, tabIndex, ariaHidden } of records.values()) {
      if (!wrapper.isConnected) continue;
      wrapper.replaceWith(select); select.classList.remove('glide-native');
      if (tabIndex === null) select.removeAttribute('tabindex'); else select.setAttribute('tabindex', tabIndex);
      if (ariaHidden === null) select.removeAttribute('aria-hidden'); else select.setAttribute('aria-hidden', ariaHidden);
    }
    records.clear();
  } };
}
