import { MAX_UPLOAD_BYTES } from './shared/uploads.mjs';

export const readFileBytes = file => file.arrayBuffer ? file.arrayBuffer().then(buffer => new Uint8Array(buffer)) : new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result)); reader.onerror = () => reject(new Error('The file could not be read.')); reader.readAsArrayBuffer(file);
});

/** Compress before persistence so repository, folder, and browser saves all benefit. */
export async function optimizeImageUpload(file, document) {
  const view = document.defaultView;
  if (!view?.createImageBitmap || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return file;
  const header = await readFileBytes(file.slice(0, 65536));
  const isAnimatedWebP = file.type === 'image/webp' && String.fromCharCode(...header.slice(12, 16)) === 'VP8X' && (header[20] & 2);
  const isAnimatedPNG = file.type === 'image/png' && new TextDecoder('latin1').decode(header).includes('acTL');
  if (isAnimatedWebP || isAnimatedPNG) return file;
  let image;
  try {
    image = await view.createImageBitmap(file);
    const scale = Math.min(1, 2560 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const compressed = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .9));
    if (!compressed || compressed.type !== 'image/webp' || compressed.size >= file.size) return file;
    return new view.File([compressed], (file.name || 'Pasted image').replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp', lastModified: file.lastModified });
  } catch { return file; }
  finally { image?.close(); }
}

export function uploadSize(bytes) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function optimizeVideo(file, view, signal, onStatus) {
  signal?.throwIfAborted();
  if (!view?.Worker) return file;
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = new view.Worker(new URL('./video-upload-worker.mjs', import.meta.url), { type: 'module' }); }
    catch { resolve(file); return; }
    const finish = () => { worker.terminate(); signal?.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(signal.reason); };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = () => { finish(); resolve(file); };
    worker.onmessage = ({ data }) => {
      if (data.percent !== undefined) { onStatus(`Optimizing video in your browser… ${data.percent}%`); return; }
      finish();
      resolve(data.file?.size > 0 && data.file.size < file.size ? data.file : file);
    };
    try { worker.postMessage(file); }
    catch { finish(); resolve(file); }
  });
}

export async function optimizeMediaUpload(file, document, { signal, onStatus = () => {} } = {}) {
  let prepared = file;
  if (file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm)$/i.test(file.name)) {
    onStatus('Optimizing video in your browser…');
    prepared = await optimizeVideo(file, document.defaultView, signal, onStatus);
  } else if (file.type.startsWith('image/')) {
    onStatus('Optimizing image in your browser…');
    prepared = await optimizeImageUpload(file, document);
  }
  signal?.throwIfAborted();
  if (prepared.size > MAX_UPLOAD_BYTES) throw new Error('This file still exceeds 50 MiB after browser optimization. Choose a smaller file or a shorter video.');
  return prepared;
}
