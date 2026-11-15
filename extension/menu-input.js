// Shared visual input convention; no library or connection state is changed.
(() => {
  const root = document.documentElement;
  root.dataset.motionInput = 'pointer';
  document.addEventListener('pointerdown', () => { root.dataset.motionInput = 'pointer'; }, true);
  document.addEventListener('keydown', () => { root.dataset.motionInput = 'keyboard'; }, true);
})();
