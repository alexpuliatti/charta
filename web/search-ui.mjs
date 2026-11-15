/* Spotlight Card and Animated List interaction patterns adapted for Charta.
 * React Bits by David Haz: https://reactbits.dev
 * See vendor/REACT-BITS-NOTICE.md for source references and license.
 */
export function setupSearchUI(document) {
  const view = document.defaultView;
  const reduced = view.matchMedia?.('(prefers-reduced-motion: reduce)');
  setupWarmTooltips(document);
  let spotlight = null, frame = 0;

  document.addEventListener('error', event => {
    if (event.target.matches?.('.search-result-thumbnail')) event.target.remove();
  }, true);

  function followPointer() {
    frame = 0;
    if (!spotlight?.card.isConnected || reduced?.matches) return;
    const light = spotlight;
    light.x += (light.targetX - light.x) * .22;
    light.y += (light.targetY - light.y) * .22;
    light.element.style.transform = `translate3d(${light.x - 220}px, ${light.y - 180}px, 0)`;
    if (Math.abs(light.targetX - light.x) + Math.abs(light.targetY - light.y) > .2) frame = view.requestAnimationFrame(followPointer);
  }

  document.addEventListener('pointermove', event => {
    const card = event.target.closest?.('.spotlight-card');
    if (!card || event.pointerType === 'touch' || reduced?.matches) return;
    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (spotlight?.card !== card) {
      spotlight?.card.classList.remove('is-lit');
      spotlight = { card, element: card.querySelector('.search-spotlight'), x, y, targetX: x, targetY: y };
    }
    if (!spotlight.element) return;
    spotlight.targetX = x; spotlight.targetY = y;
    card.classList.add('is-lit');
    if (!frame) frame = view.requestAnimationFrame(followPointer);
  });
  document.addEventListener('pointerout', event => {
    const card = event.target.closest?.('.spotlight-card');
    if (card && !card.contains(event.relatedTarget)) card.classList.remove('is-lit');
  });

  function select(list, index, { scroll = false } = {}) {
    const rows = [...list.querySelectorAll('.search-result')];
    const input = list.closest('.library-search-surface')?.querySelector('[data-library-search]');
    const highlight = list.querySelector('.search-selection');
    const row = rows[index];
    rows.forEach(item => item.setAttribute('aria-selected', String(item === row)));
    if (!row) {
      input?.removeAttribute('aria-activedescendant');
      if (highlight) highlight.hidden = true;
      return;
    }
    input?.setAttribute('aria-activedescendant', row.id);
    if (highlight) {
      highlight.hidden = false;
      highlight.style.height = `${row.offsetHeight}px`;
      highlight.style.transform = `translateY(${row.offsetTop}px)`;
    }
    if (scroll) row.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
  }

  document.addEventListener('pointerover', event => {
    const row = event.target.closest?.('.search-result');
    if (!row || row.contains(event.relatedTarget)) return;
    const list = row.closest('#search-results');
    if (list?.closest('[data-mode=ask]')) return;
    if (list) select(list, [...list.querySelectorAll('.search-result')].indexOf(row));
  });
  document.addEventListener('keydown', event => {
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (document.getElementById('search-dropdown').hidden || !event.target.matches?.('[data-library-search],.search-result')) return;
    if (event.target.dataset.searchMode === 'ask') return;
    const list = document.getElementById('search-results');
    const rows = [...list.querySelectorAll('.search-result')];
    if (!rows.length) return;
    const current = rows.findIndex(row => row.getAttribute('aria-selected') === 'true');
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      select(list, (current + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length, { scroll: true });
    } else if (event.key === 'Enter' && event.target.matches('.search-input')) {
      event.preventDefault();
      rows[Math.max(0, current)].click();
    }
  });

  return { refresh() {
    const list = document.getElementById('search-results');
    if (!list) return;
    list.scrollTop = 0;
    select(list, 0);
  } };
}

/* Warm Tooltip: delay the first hint; moving to a sibling keeps hints instant. */
function setupWarmTooltips(document) {
  const view = document.defaultView;
  const selector = '#menu-button,#settings-button,#resource-upload,.resource-submit,.canvas-history button[aria-label],.canvas-navigation button[aria-label]';
  const tooltip = document.createElement('div');
  tooltip.id = 'charta-warm-tooltip';
  tooltip.className = 'warm-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('popover', 'manual');
  tooltip.hidden = true;
  document.body.append(tooltip);
  let trigger = null, previousDescription = null, previousTitle = null, timer = 0, warmUntil = 0;

  function hide() {
    view.clearTimeout(timer);
    if (!tooltip.hidden) warmUntil = Date.now() + 800;
    if (trigger) {
      if (previousDescription) trigger.setAttribute('aria-describedby', previousDescription);
      else trigger.removeAttribute('aria-describedby');
      if (previousTitle !== null && !trigger.hasAttribute('title')) trigger.setAttribute('title', previousTitle);
    }
    tooltip.hidePopover?.();
    tooltip.hidden = true;
    trigger = null;
  }
  function queue(element, immediate = false) {
    if (trigger === element) return;
    hide();
    trigger = element;
    previousDescription = element.getAttribute('aria-describedby');
    previousTitle = element.getAttribute('title');
    element.removeAttribute('title');
    const warm = immediate || Date.now() < warmUntil;
    timer = view.setTimeout(() => {
      if (!element.isConnected || trigger !== element) return;
      tooltip.textContent = element.getAttribute('aria-label');
      tooltip.dataset.warm = String(warm);
      tooltip.hidden = false;
      element.setAttribute('aria-describedby', [previousDescription, tooltip.id].filter(Boolean).join(' '));
      tooltip.showPopover?.();
      const rect = element.getBoundingClientRect();
      const width = tooltip.offsetWidth, height = tooltip.offsetHeight;
      tooltip.style.left = `${Math.max(8, Math.min(view.innerWidth - width - 8, rect.left + (rect.width - width) / 2))}px`;
      tooltip.style.top = `${rect.bottom + height + 16 < view.innerHeight ? rect.bottom + 8 : rect.top - height - 8}px`;
    }, warm ? 0 : 500);
  }
  document.addEventListener('pointerover', event => {
    const element = event.target.closest?.(selector);
    if (element && event.pointerType !== 'touch') queue(element);
  });
  document.addEventListener('pointerout', event => { if (trigger && !trigger.contains(event.relatedTarget)) hide(); });
  document.addEventListener('focusin', event => {
    if (event.target.matches(selector) && document.documentElement.dataset.motionInput === 'keyboard') queue(event.target, true);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('close', hide, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  document.addEventListener('scroll', hide, true);
  view.addEventListener('resize', hide);
  view.addEventListener('hashchange', hide);
}
