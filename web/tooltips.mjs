let nextTooltip = 0;

/** React Bits Warm Tooltip's grouped delay, adapted for native artefact dialogs. */
export function setupWarmTooltips(document) {
  const view = document.defaultView, events = new view.AbortController();
  let active = null, timer = 0, warmDialog = null, warmUntil = 0, keyboard = false;
  const now = () => view.performance.now();
  const listen = (target, type, callback, options = {}) => target.addEventListener(type, callback, { ...options, signal: events.signal });
  function dismiss() {
    view.clearTimeout(timer); timer = 0;
    if (!active) return;
    const { button, title, tooltip, dialog } = active;
    if (!button.hasAttribute('title')) button.setAttribute('title', title);
    if (tooltip) {
      const ids = (button.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== tooltip.id);
      if (ids.length) button.setAttribute('aria-describedby', ids.join(' ')); else button.removeAttribute('aria-describedby');
      tooltip.remove(); warmDialog = dialog; warmUntil = now() + 500;
    }
    active = null;
  }
  function position() {
    if (!active?.tooltip) return;
    const { button, dialog, tooltip } = active;
    const bounds = dialog.getBoundingClientRect(), anchor = button.getBoundingClientRect(), label = tooltip.getBoundingClientRect();
    const width = dialog.clientWidth || bounds.width, height = dialog.clientHeight || bounds.height;
    const left = Math.max(12, Math.min(anchor.left - bounds.left + (anchor.width - label.width) / 2, width - label.width - 12));
    const below = anchor.bottom - bounds.top + 8;
    const top = below + label.height <= height - 12 ? below : Math.max(12, anchor.top - bounds.top - label.height - 8);
    tooltip.style.left = `${left}px`; tooltip.style.top = `${top}px`;
  }
  function show() {
    timer = 0;
    if (!active?.button.isConnected || !active.dialog.open) { dismiss(); return; }
    const tooltip = document.createElement('div');
    tooltip.className = 'warm-tooltip'; tooltip.id = `warm-tooltip-${++nextTooltip}`;
    tooltip.setAttribute('role', 'tooltip'); tooltip.textContent = active.title;
    active.tooltip = tooltip; active.dialog.append(tooltip);
    active.button.setAttribute('aria-describedby', [active.button.getAttribute('aria-describedby'), tooltip.id].filter(Boolean).join(' '));
    position();
  }
  function enter(event, immediate = false) {
    if (!immediate && (event.pointerType === 'touch' || view.matchMedia?.('(hover: none)').matches)) return;
    const button = event.target.closest?.('.artefact-dialog button');
    const dialog = button?.closest('dialog.artefact-dialog[open]');
    if (!dialog || button.disabled) return;
    if (active?.button === button) {
      if (immediate && !active.tooltip) { view.clearTimeout(timer); show(); }
      return;
    }
    if (!button.getAttribute('title')) return;
    dismiss();
    active = { button, dialog, title: button.getAttribute('title'), tooltip: null };
    button.removeAttribute('title');
    if (immediate || warmDialog === dialog && now() < warmUntil) show();
    else timer = view.setTimeout(show, 500);
  }
  function leave(event) {
    if (active?.button.contains(event.target) && !active.button.contains(event.relatedTarget)) dismiss();
  }
  listen(document, 'pointerover', event => enter(event));
  listen(document, 'pointerout', leave);
  listen(document, 'focusin', event => { if (keyboard) enter(event, true); });
  listen(document, 'focusout', leave);
  listen(document, 'pointerdown', () => { keyboard = false; dismiss(); }, { capture: true });
  listen(document, 'keydown', event => { keyboard = true; if (event.key === 'Escape') dismiss(); }, { capture: true });
  listen(document, 'close', event => { if (event.target === active?.dialog) dismiss(); }, { capture: true });
  listen(view, 'resize', position);
  listen(document, 'scroll', position, { capture: true, passive: true });
  const observer = new view.MutationObserver(() => {
    if (!active) return;
    if (!active.button.isConnected || !active.dialog.open) { dismiss(); return; }
    const updated = active.button.getAttribute('title');
    if (updated !== null) {
      active.title = updated; active.button.removeAttribute('title');
      if (active.tooltip) { active.tooltip.textContent = updated; position(); }
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'title'] });
  return { destroy() { observer.disconnect(); events.abort(); dismiss(); } };
}
