// A static, procedural ribbon field. No media requests or animation loop.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = (a, b, value) => {
  const t = clamp((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * clamp(t);
const ribbon = (distance, width) => Math.exp(-(distance * distance) / (width * width));

function noise(x, y, seed) {
  let value = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ seed;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function paint(canvas, context, width, height, seed) {
  canvas.width = width;
  canvas.height = height;
  context.imageSmoothingEnabled = false;
  const frame = context.createImageData(width, height);
  const pixels = frame.data;
  for (let py = 0; py < height; py++) {
    const y = py / Math.max(1, height - 1);
    for (let px = 0; px < width; px++) {
      const x = px / Math.max(1, width - 1);
      const grain = noise(px, py, seed);
      const ordered = (BAYER[(py & 3) * 4 + (px & 3)] + 0.5) / 16;
      const weave = Math.sin(x * 115 + y * 28) * 0.006;
      const coolCenter = 0.045 + x * 0.12 + Math.sin(x * 5.1) * 0.025;
      const warmCenter = 0.17 + x * 0.42 + Math.sin(x * 4.4) * 0.03;
      const cool = ribbon(y - coolCenter + weave, 0.15 + x * 0.1)
        * smooth(0.015, 0.64, x);
      const warm = ribbon(y - warmCenter - weave, 0.035 + x * 0.035)
        * (0.48 + smooth(0.05, 0.72, x) * 0.52);
      const wisps = ribbon(y - warmCenter - 0.035, 0.105) * 0.13
        + ribbon(y - coolCenter - 0.07, 0.19) * x * 0.1;
      const strength = clamp(Math.max(cool, warm) + wisps)
        * (1 - smooth(0.58, 0.83, y));
      // Ordered stippling supplies a visible pixel grain; hash noise breaks up
      // its regularity, leaving transparent black gaps within the ribbons.
      if (strength < 0.012 || grain * 0.57 + ordered * 0.43 > strength * 0.82) {
        // A few neutral grains carry the texture into the otherwise quiet black.
        if (y > 0.48 && noise(px, py, seed ^ 98471) < 0.006) {
          const index = (py * width + px) * 4;
          const gray = 72 + Math.round(grain * 28);
          pixels[index] = gray; pixels[index + 1] = gray; pixels[index + 2] = gray;
          pixels[index + 3] = Math.round(30 + grain * 35);
        }
        continue;
      }
      const warmShare = warm / Math.max(0.001, cool + warm);
      const teal = smooth(0.4, 0.95, x);
      const coolColor = [mix(50, 57, teal), mix(112, 169, teal), mix(222, 170, teal)];
      const warmColor = [mix(245, 255, x), mix(164, 98, x), mix(65, 28, x)];
      const light = 0.82 + grain * 0.43;
      const index = (py * width + px) * 4;
      pixels[index] = Math.round(mix(coolColor[0], warmColor[0], warmShare) * light);
      pixels[index + 1] = Math.round(mix(coolColor[1], warmColor[1], warmShare) * light);
      pixels[index + 2] = Math.round(mix(coolColor[2], warmColor[2], warmShare) * light);
      pixels[index + 3] = Math.round(255 * Math.min(0.98, strength * (0.68 + grain * 0.36)));
    }
  }
  context.putImageData(frame, 0, 0);
}

/** Mount behind a hero's content. The host supplies position:relative and clipping. */
export function mountAmbient(element, { seed = 29, opacity = 0.9 } = {}) {
  if (!element?.ownerDocument) return { destroy() {} };
  const view = element.ownerDocument.defaultView || globalThis;
  const canvas = element.ownerDocument.createElement('canvas');
  canvas.className = 'jelly-ambient';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.opacity = String(clamp(Number.isFinite(opacity) ? opacity : 0.9));
  element.prepend(canvas);
  let context;
  try { context = canvas.getContext('2d', { alpha: true }); } catch { /* Static CSS remains the fallback. */ }
  let observer;
  let scheduled = 0;
  let destroyed = false;
  let lastWidth = 0;
  let lastHeight = 0;
  const draw = () => {
    scheduled = 0;
    if (destroyed || !context) return;
    const rect = element.getBoundingClientRect();
    // Intentionally ignore devicePixelRatio: the coarse pixels are the effect.
    const width = Math.max(1, Math.min(700, Math.ceil((rect.width || 700) / 2)));
    const height = Math.max(1, Math.min(350, Math.ceil((rect.height || 350) / 2)));
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width; lastHeight = height;
    paint(canvas, context, width, height, Number.isFinite(seed) ? seed | 0 : 29);
  };
  const resize = () => {
    if (destroyed || scheduled || !context) return;
    if (typeof view.requestAnimationFrame === 'function') scheduled = view.requestAnimationFrame(draw);
    else draw();
  };
  draw();
  if (context) {
    if (typeof view.ResizeObserver === 'function') {
      observer = new view.ResizeObserver(resize);
      observer.observe(element);
    } else view.addEventListener?.('resize', resize, { passive: true });
  }
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer?.disconnect();
      view.removeEventListener?.('resize', resize);
      if (scheduled) view.cancelAnimationFrame?.(scheduled);
      canvas.remove();
    }
  };
}
