// Retained across the Charta rebrand for existing sidebar preferences.
export const SIDEBAR_STORAGE_KEY = 'jelly-sidebar-collapsed';

/** Desktop icon rail and mobile drawer share one toggle, with separate state. */
export function setupSidebar({ body, sidebar, toggle, scrim, storage, matchMedia, animateLayout = update => update() } = {}) {
  const document = body?.ownerDocument;
  if (!document || !sidebar || !toggle || !scrim) throw new Error('The sidebar needs its body, navigation, toggle, and scrim.');
  const view = document.defaultView;
  if (storage === undefined) {
    try { storage = globalThis.localStorage ?? view?.localStorage; } catch { storage = null; }
  }
  if (matchMedia === undefined) matchMedia = typeof view?.matchMedia === 'function' ? view.matchMedia.bind(view) : undefined;
  const media = typeof matchMedia === 'function' ? matchMedia('(min-width: 801px)') : null;
  let desktop = media ? media.matches : (view?.innerWidth ?? 1024) >= 801;
  let desktopCollapsed = false;
  let mobileOpen = false;
  let destroyed = false;
  const cleanups = [];
  try { desktopCollapsed = storage?.getItem(SIDEBAR_STORAGE_KEY) === 'true'; } catch { /* Private browsing can deny storage. */ }

  const listen = (target, type, handler) => {
    target.addEventListener(type, handler);
    cleanups.push(() => target.removeEventListener(type, handler));
  };
  const getState = () => ({ desktop, collapsed: desktop && desktopCollapsed, desktopCollapsed, mobileOpen, expanded: desktop ? !desktopCollapsed : mobileOpen });

  function apply() {
    const expanded = desktop ? !desktopCollapsed : mobileOpen;
    body.classList.toggle('sidebar-collapsed', desktop && desktopCollapsed);
    sidebar.classList.toggle('open', !desktop && mobileOpen);
    // A translated, closed mobile drawer must also leave the keyboard/AX tree.
    sidebar.toggleAttribute('inert', !desktop && !mobileOpen);
    sidebar.setAttribute('aria-hidden', String(!desktop && !mobileOpen));
    scrim.hidden = desktop || !mobileOpen;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', expanded ? 'Close sidebar' : 'Open sidebar');
    if (sidebar.id) toggle.setAttribute('aria-controls', sidebar.id);
  }

  function focusToggle() {
    if (toggle.isConnected) toggle.focus({ preventScroll: true });
  }

  function closeMobile({ restoreFocus = false } = {}) {
    if (destroyed || desktop || !mobileOpen) return;
    const focusedInside = sidebar.contains(document.activeElement);
    mobileOpen = false;
    apply();
    if (restoreFocus || focusedInside) focusToggle();
  }

  function focusableLinks() {
    return [...sidebar.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter(element => !element.closest('[hidden], [inert]') && element.getAttribute('aria-hidden') !== 'true');
  }

  listen(toggle, 'click', () => {
    if (desktop) {
      desktopCollapsed = !desktopCollapsed;
      try { storage?.setItem(SIDEBAR_STORAGE_KEY, String(desktopCollapsed)); } catch { /* Keep the control usable without persistence. */ }
      animateLayout(apply);
    } else if (mobileOpen) closeMobile({ restoreFocus: true });
    else {
      mobileOpen = true;
      apply();
      focusableLinks()[0]?.focus({ preventScroll: true });
    }
  });
  listen(scrim, 'click', () => closeMobile({ restoreFocus: true }));
  listen(document, 'keydown', event => {
    if (desktop || !mobileOpen || event.defaultPrevented || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMobile({ restoreFocus: true });
    } else if (event.key === 'Tab') {
      const controls = [toggle, ...focusableLinks()];
      const current = controls.indexOf(document.activeElement);
      const next = event.shiftKey ? current <= 0 ? controls.at(-1) : controls[current - 1] : current < 0 || current === controls.length - 1 ? controls[0] : controls[current + 1];
      event.preventDefault();
      next?.focus({ preventScroll: true });
    }
  });

  function updateBreakpoint(event) {
    const next = typeof event?.matches === 'boolean' ? event.matches : media ? media.matches : (view?.innerWidth ?? 1024) >= 801;
    if (next === desktop) return;
    const focusedInside = sidebar.contains(document.activeElement);
    desktop = next;
    mobileOpen = false;
    apply();
    if (!desktop && focusedInside) focusToggle();
  }
  if (typeof media?.addEventListener === 'function') listen(media, 'change', updateBreakpoint);
  else if (typeof media?.addListener === 'function') {
    media.addListener(updateBreakpoint);
    cleanups.push(() => media.removeListener(updateBreakpoint));
  } else if (view) listen(view, 'resize', updateBreakpoint);

  apply();
  return {
    closeMobile,
    getState,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const cleanup of cleanups.splice(0)) cleanup();
    }
  };
}
