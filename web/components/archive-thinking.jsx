import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import Orb from '../vendor/react-bits/Orb.jsx';

const colors = ['#c6c6c6', '#929292', '#515151'];
const motionQuery = '(prefers-reduced-motion: reduce)';
const getReducedMotion = () => window.matchMedia(motionQuery).matches;
const subscribeMotion = callback => {
  const media = window.matchMedia(motionQuery);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
};

function ArchiveThinking() {
  const reduced = useSyncExternalStore(subscribeMotion, getReducedMotion, () => true);
  return <Orb key={String(reduced)} colors={colors} size={0.85} speed={0.65} glow={1.1} wobble={0.65}
    highlight={0.65} trail={0.6} hoverIntensity={0} rotateOnHover={false}
    followCursor={false} clickPulse={false} intro={false} paused={reduced} dpr={1.5} />;
}

/** Keep the React animation's lifetime tied to the native search request. */
export function mountArchiveThinking(container) {
  const root = createRoot(container);
  flushSync(() => root.render(<ArchiveThinking />));
  let alive = true;
  function destroy() {
    if (!alive) return;
    alive = false;
    container.removeEventListener('webglcontextlost', destroy, true);
    root.unmount();
  }
  container.addEventListener('webglcontextlost', destroy, true);
  return { destroy };
}
