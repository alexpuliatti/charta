import { menuIcon } from './menu-icons.mjs';

export function createContextMenu({ document, itemsFor, titleFor }) {
  const view = document.defaultView;
  const reduced = view.matchMedia?.('(prefers-reduced-motion: reduce)');
  const retired = new Set();
  const cleanups = [];
  let menu = null, trigger = null, entrance = null;
  const canAnimate = element => typeof element.animate === 'function' && element.dataset.instant !== 'true' && document.documentElement.dataset.motionInput !== 'keyboard' && !reduced?.matches;
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };
  function clearRetired() {
    for (const item of [...retired]) item.finish();
  }
  function close({ restoreFocus = false, immediate = false } = {}) {
    const surface = menu, previousTrigger = trigger;
    menu = null; trigger = null;
    if (previousTrigger?.hasAttribute('aria-haspopup')) previousTrigger.setAttribute('aria-expanded', 'false');
    if (immediate) clearRetired();
    if (surface) {
      const style = view.getComputedStyle(surface);
      const from = { opacity: style.opacity || 1, transform: style.transform || 'none' };
      entrance?.cancel(); entrance = null;
      surface.classList.remove('context-menu');
      surface.classList.add('menu-exit');
      surface.removeAttribute('role');
      surface.setAttribute('aria-hidden', 'true');
      surface.setAttribute('inert', '');
      surface.style.pointerEvents = 'none';
      if (immediate || !canAnimate(surface)) surface.remove();
      else {
        const direction = surface.dataset.side === 'above' ? -3 : 3;
        const animation = surface.animate([from, { opacity: 0, transform: `translateY(${direction}px) scale(.975)` }], { duration: 120, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
        let timer, finished = false;
        const item = { finish() { if (finished) return; finished = true; view.clearTimeout(timer); retired.delete(item); surface.remove(); animation.cancel(); } };
        retired.add(item);
        animation.finished.then(item.finish, item.finish);
        timer = view.setTimeout(item.finish, 220);
      }
    }
    if (restoreFocus && previousTrigger?.isConnected) previousTrigger.focus({ preventScroll: true });
  }
  function open(target, { x, y, keyboard = false, anchor = target, instant = false } = {}) {
    const items = itemsFor(target);
    if (!items?.length) return false;
    close({ immediate: true });
    trigger = anchor.matches('button,a') ? anchor : target.contains(document.activeElement) ? document.activeElement : target.matches('button,a') ? target : target.querySelector('button,a');
    menu = document.createElement('div');
    menu.className = 'context-menu menu-surface';
    menu.dataset.instant = String(instant || document.documentElement.dataset.motionInput === 'keyboard');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Item actions');
    if (trigger?.hasAttribute('aria-haspopup')) trigger.setAttribute('aria-expanded', 'true');
    const title = titleFor?.(target);
    if (title) {
      const header = document.createElement('div');
      header.className = 'menu-heading'; header.textContent = title;
      header.setAttribute('aria-hidden', 'true'); menu.append(header);
    }
    const highlight = document.createElement('div');
    highlight.className = 'menu-highlight'; highlight.setAttribute('aria-hidden', 'true'); menu.append(highlight);
    const highlightRow = row => {
      if (!row || row.disabled) return;
      highlight.style.height = `${row.offsetHeight || 36}px`;
      highlight.style.transform = `translateY(${row.offsetTop}px)`;
      highlight.dataset.danger = String(row.classList.contains('danger'));
      highlight.classList.add('visible');
    };
    for (const item of items) {
      const button = document.createElement(item.href ? 'a' : 'button');
      if (!item.href) button.type = 'button';
      button.setAttribute('role', 'menuitem'); button.tabIndex = -1;
      if (item.separator) {
        const divider = document.createElement('div'); divider.className = 'menu-separator'; divider.setAttribute('role', 'separator'); menu.append(divider);
      }
      const label = document.createElement('span'); label.className = 'menu-label'; label.textContent = item.label;
      button.classList.add('menu-row');
      button.append(menuIcon(document, item), label);
      if (item.danger) button.classList.add('danger');
      if (item.disabled) { button.disabled = true; button.setAttribute('aria-disabled', 'true'); }
      if (item.href) { button.href = item.href; button.target = '_blank'; button.rel = 'noopener noreferrer'; }
      for (const [key, value] of Object.entries(item.data || {})) button.dataset[key] = value;
      menu.append(button);
    }
    const dialog = target.closest('dialog[open]');
    const topLayer = typeof menu.showPopover === 'function';
    if (topLayer) menu.setAttribute('popover', 'manual');
    (dialog || document.body).append(menu);
    // Popovers escape the dialog's blur containing block and overflow clipping.
    if (topLayer) menu.showPopover();
    const rect = anchor.getBoundingClientRect();
    const left = keyboard || x === undefined ? rect.left : x;
    const top = keyboard || y === undefined ? rect.bottom + 7 : y;
    const bounds = menu.getBoundingClientRect();
    const width = menu.offsetWidth || bounds.width, height = menu.offsetHeight || bounds.height;
    let menuLeft = Math.max(8, Math.min(left, view.innerWidth - width - 8));
    const anchored = keyboard || y === undefined;
    const above = anchored && top + height > view.innerHeight - 8 && rect.top > height + 8;
    let menuTop = Math.max(8, Math.min(above ? rect.top - height - 7 : top, view.innerHeight - height - 8));
    menu.dataset.side = above ? 'above' : 'below';
    menu.style.setProperty('--menu-origin', `${Math.max(0, Math.min(width, left - menuLeft))}px ${above ? height : Math.max(0, Math.min(height, top - menuTop))}px`);
    if (dialog && !topLayer) {
      const parent = dialog.getBoundingClientRect();
      menu.style.position = 'absolute';
      menuLeft = Math.max(8, Math.min(menuLeft - parent.left, parent.width - width - 8)) + dialog.scrollLeft;
      menuTop = Math.max(8, Math.min(menuTop - parent.top, parent.height - height - 8)) + dialog.scrollTop;
    }
    menu.style.left = `${menuLeft}px`;
    menu.style.top = `${menuTop}px`;
    menu.addEventListener('focusin', event => highlightRow(event.target.closest('[role=menuitem]')));
    menu.addEventListener('pointerover', event => {
      const row = event.target.closest('[role=menuitem]');
      if (row && !row.disabled && event.pointerType !== 'touch') { highlightRow(row); row.focus({ preventScroll: true }); }
    });
    if (canAnimate(menu)) {
      const direction = above ? -5 : 5;
      entrance = menu.animate([{ opacity: 0, transform: `translateY(${direction}px) scale(.96)` }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.16,1,.3,1)' });
      entrance.finished.catch(() => {});
    }
    menu.querySelector('[role=menuitem]:not([disabled])')?.focus({ preventScroll: true });
    menu.addEventListener('click', event => { if (event.target.closest('[role=menuitem]:not([disabled])')) close(); });
    return true;
  }
  const targetFor = element => element?.closest?.('[data-context-kind][data-context-id]');
  listen(document, 'contextmenu', event => {
    if (event.target.closest('input,textarea,select,[contenteditable=true]')) { close(); return; }
    const target = targetFor(event.target);
    if (target && open(target, { x: event.clientX, y: event.clientY })) event.preventDefault();
    else close();
  });
  listen(document, 'keydown', event => {
    clearRetired();
    entrance?.cancel(); entrance = null;
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      const target = targetFor(event.target);
      if (target && open(target, { keyboard: true, anchor: event.target, instant: true })) { event.preventDefault(); event.stopImmediatePropagation(); }
      return;
    }
    if (!menu) return;
    const items = [...menu.querySelectorAll('[role=menuitem]:not([disabled])')];
    const index = items.indexOf(document.activeElement);
    if (event.key === 'Escape' || event.key === 'Tab') { close({ restoreFocus: true, immediate: true }); if (event.key === 'Escape') event.preventDefault(); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key.length === 1 && event.key !== ' ' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const match = [...items.slice(index + 1), ...items.slice(0, index + 1)].find(item => item.textContent.toLowerCase().startsWith(event.key.toLowerCase()));
      match?.focus(); event.preventDefault();
    }
    event.stopImmediatePropagation();
  }, true);
  listen(document, 'pointerdown', event => { if (menu && !menu.contains(event.target)) close(); });
  listen(document, 'scroll', event => { if (menu && !menu.contains(event.target)) close({ immediate: true }); }, true);
  listen(view, 'resize', () => close({ immediate: true }));
  listen(view, 'hashchange', () => close({ immediate: true }));
  if (reduced?.addEventListener) listen(reduced, 'change', () => { if (reduced.matches) { entrance?.cancel(); entrance = null; clearRetired(); } });
  return { open, close, destroy() { close({ immediate: true }); for (const cleanup of cleanups) cleanup(); } };
}
