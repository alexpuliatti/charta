const EASE = 'cubic-bezier(.22, 1, .36, 1)';

/** Keep frequent keyboard actions instant and pointer motion interruptible. */
export function setupMotion(document) {
  const view = document.defaultView;
  const root = document.documentElement;
  const reduced = view.matchMedia?.('(prefers-reduced-motion: reduce)');
  const animations = new Map();
  const cleanups = [];
  let transition = null;
  root.dataset.motionInput = 'pointer';
  const enabled = () => root.dataset.motionInput !== 'keyboard' && !reduced?.matches;
  const listen = (target, event, handler, options) => {
    target.addEventListener(event, handler, options);
    cleanups.push(() => target.removeEventListener(event, handler, options));
  };
  const stop = () => {
    transition?.skipTransition();
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
  };
  listen(document, 'pointerdown', () => { root.dataset.motionInput = 'pointer'; }, true);
  listen(document, 'keydown', () => { root.dataset.motionInput = 'keyboard'; stop(); }, true);
  if (reduced?.addEventListener) listen(reduced, 'change', () => { if (reduced.matches) stop(); });

  function enterPage(element) {
    const previous = animations.get(element);
    const current = previous ? view.getComputedStyle(element) : null;
    const from = current ? { opacity: current.opacity, transform: current.transform } : { opacity: .35, transform: 'translateY(5px)' };
    previous?.cancel();
    if (!enabled() || !element?.animate) return;
    const animation = element.animate([from, { opacity: 1, transform: 'none' }], { duration: 220, easing: EASE });
    animations.set(element, animation);
    const done = () => { if (animations.get(element) === animation) animations.delete(element); };
    animation.finished.then(done, done);
  }

  function layout(update) {
    transition?.skipTransition();
    if (!enabled() || !document.startViewTransition) { update(); return; }
    let applied = false;
    const commit = () => { if (!applied) { applied = true; update(); } };
    document.body.dataset.layoutTransition = 'sidebar';
    let next;
    try { next = document.startViewTransition(commit); }
    catch { delete document.body.dataset.layoutTransition; commit(); return; }
    transition = next;
    next.ready.catch(() => {});
    next.updateCallbackDone.catch(() => commit());
    const done = () => {
      if (transition !== next) return;
      transition = null;
      delete document.body.dataset.layoutTransition;
    };
    next.finished.then(done, done);
  }

  return { enterPage, layout, destroy() { stop(); for (const cleanup of cleanups) cleanup(); delete root.dataset.motionInput; } };
}
