/* Charta adaptations of React Bits by David Haz: Rubber Segment, Wake Slider,
 * Branched Menu, and Shredder. See vendor/REACT-BITS-NOTICE.md. */
import { setupGlideSelect } from './glide-select.mjs';

const canMove = document => document.documentElement.dataset.motionInput !== 'keyboard' && !document.defaultView.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Feedback for discarding a pending attachment; it never deletes saved resources. */
export function shredAttachment(element) {
  const document = element.ownerDocument, view = document.defaultView;
  if (!canMove(document) || !element.animate || element.hidden) return;
  const bounds = element.getBoundingClientRect(); if (!bounds.width || !bounds.height) return;
  const overlay = document.createElement('div'); overlay.className = 'micro-shred'; overlay.setAttribute('aria-hidden', 'true'); overlay.setAttribute('inert', '');
  Object.assign(overlay.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
  if (overlay.showPopover) overlay.setAttribute('popover', 'manual');
  const template = element.cloneNode(true); template.removeAttribute('id');
  template.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  const originalImage = element.querySelector('img'), cloneImage = template.querySelector('img');
  if (originalImage?.complete && cloneImage) {
    try { const canvas = document.createElement('canvas'); canvas.width = 42; canvas.height = 42; canvas.getContext('2d').drawImage(originalImage, 0, 0, 42, 42); cloneImage.src = canvas.toDataURL(); }
    catch { cloneImage.remove(); }
  }
  (element.closest('dialog[open]') || document.body).append(overlay); overlay.showPopover?.();
  for (let i = 0; i < 9; i++) {
    const strip = document.createElement('div'); strip.className = 'micro-shred-strip';
    strip.style.clipPath = `inset(0 ${100 - (i + 1) * 100 / 9}% 0 ${i * 100 / 9}%)`;
    strip.append(template.cloneNode(true)); overlay.append(strip);
    strip.animate([{ opacity: .9, transform: 'translateY(0) rotateX(0)' }, { opacity: 0, transform: `translateY(65px) rotateX(48deg) rotate(${(i - 4) * 1.2}deg)` }], { duration: 290, delay: i * 9, easing: 'cubic-bezier(.4,0,.8,.6)', fill: 'forwards' });
  }
  view.setTimeout(() => overlay.remove(), 410);
}

export function setupMicroInteractions(document) {
  const view = document.defaultView, events = new view.AbortController();
  const glides = setupGlideSelect(document), slots = new Map(), animations = new WeakMap();
  let frame = 0, alive = true, branch = '';
  const listen = (node, type, handler, options = {}) => node.addEventListener(type, handler, { ...options, signal: events.signal });
  const groups = '.view-toggle,.input-tabs,.network-view-toggle,.search-mode-switch';
  function rubber(group) {
    const buttons = [...group.querySelectorAll(':scope > button')];
    const selected = buttons.find(button => button.matches('.selected,.active,[aria-pressed=true]'));
    if (!selected || !group.offsetWidth) return;
    group.classList.add('micro-segment');
    let thumb = group.querySelector(':scope > .micro-segment-thumb');
    if (!thumb) { thumb = document.createElement('span'); thumb.className = 'micro-segment-thumb'; thumb.setAttribute('aria-hidden', 'true'); group.prepend(thumb); }
    const key = buttons.map(button => button.dataset.action || button.dataset.view || button.textContent).join('|');
    const value = buttons.indexOf(selected), next = { x: selected.offsetLeft, width: selected.offsetWidth, y: selected.offsetTop, height: selected.offsetHeight, value };
    const previous = slots.get(key); slots.set(key, next);
    Object.assign(thumb.style, { top: `${next.y}px`, height: `${next.height}px`, width: `${next.width}px`, transform: `translateX(${next.x}px)` });
    if (previous && previous.value !== value && canMove(document) && thumb.animate) {
      animations.get(group)?.cancel();
      const left = Math.min(previous.x, next.x), right = Math.max(previous.x + previous.width, next.x + next.width);
      animations.set(group, thumb.animate([
        { transform: `translateX(${previous.x}px)`, width: `${previous.width}px`, offset: 0 },
        { transform: `translateX(${left + (next.x - left) * .35}px)`, width: `${(right - left) * .75 + next.width * .25}px`, offset: .42 },
        { transform: `translateX(${next.x}px)`, width: `${next.width}px`, offset: 1 }
      ], { duration: 240, easing: 'cubic-bezier(.23,1,.32,1)' }));
    }
  }
  function wake(input, moving = false) {
    const track = input.closest('.wake-slider'); if (!track) return;
    let bars = track.querySelector('.wake-bars');
    if (!bars) { bars = document.createElement('span'); bars.className = 'wake-bars'; bars.setAttribute('aria-hidden', 'true'); for (let i = 0; i < 28; i++) bars.append(document.createElement('i')); track.prepend(bars); }
    const position = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 27;
    const previous = Number(track.dataset.position || position); track.dataset.position = position;
    for (const [index, bar] of [...bars.children].entries()) {
      bar.dataset.on = String(index <= Math.round(position));
      if (!moving || !canMove(document) || !bar.animate) continue;
      const distance = Math.abs(index - position), speed = Math.min(1, Math.abs(position - previous) / 2);
      const lift = Math.max(0, 1 - distance / (3 + speed * 4)) ** 2 * (1 + speed);
      if (lift < .03) continue;
      bar.getAnimations?.().forEach(animation => animation.cancel());
      bar.animate([{ transform: `scaleY(${1 + lift * 1.8})` }, { transform: 'scaleY(1)' }], { duration: 330, easing: 'cubic-bezier(.23,1,.32,1)' });
    }
  }
  function refresh() {
    frame = 0; if (!alive) return;
    glides.refresh();
    document.querySelectorAll(groups).forEach(rubber);
    document.querySelectorAll('.wake-slider input[type=range]').forEach(input => wake(input));
    if (branch) {
      const toggle = [...document.querySelectorAll('.folder-toggle')].find(item => item.dataset.id === branch);
      const children = toggle?.parentElement.querySelector(':scope > .folder-children');
      if (children && !children.hidden && canMove(document)) children.animate?.([{ opacity: .3, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 190, easing: 'cubic-bezier(.23,1,.32,1)' });
      branch = '';
    }
  }
  function schedule() { if (!frame && alive) frame = view.requestAnimationFrame(refresh); }
  const observer = new view.MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  listen(document, 'click', event => { const toggle = event.target.closest?.('[data-action=toggle-folder]'); if (toggle) branch = toggle.dataset.id; schedule(); }, { capture: true });
  listen(document, 'toggle', schedule, { capture: true });
  listen(document, 'input', event => { if (event.target.matches?.('.wake-slider input')) wake(event.target, true); });
  listen(document, 'keydown', event => {
    const button = event.target.closest?.(`${groups.split(',').map(group => `${group} > button`).join(',')}`);
    if (!button || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const controls = [...button.parentElement.querySelectorAll(':scope > button:not(:disabled)')], index = controls.indexOf(button);
    const next = event.key === 'Home' ? controls[0] : event.key === 'End' ? controls.at(-1) : controls[(index + (event.key === 'ArrowRight' ? 1 : -1) + controls.length) % controls.length];
    event.preventDefault(); next?.click();
    if (next?.isConnected) next.focus();
    else view.requestAnimationFrame(() => {
      const action = next?.dataset.action, targetView = next?.dataset.view;
      [...document.querySelectorAll(groups)].flatMap(group => [...group.querySelectorAll(':scope > button')]).find(control => action ? control.dataset.action === action : targetView && control.dataset.view === targetView)?.focus();
    });
  });
  listen(view, 'resize', schedule); document.fonts?.ready.then(schedule);
  refresh();
  return { refresh, destroy() { alive = false; observer.disconnect(); events.abort(); glides.destroy(); if (frame) view.cancelAnimationFrame(frame); } };
}
