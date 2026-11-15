import { base64FromBytes, bytesFromBase64, detectUpload, MAX_UPLOAD_BYTES, MAX_RESOURCE_TEXT, validatedAttachments } from './shared/uploads.mjs';
import { classifyResource, resourceImportOperation, resourceFolderPath } from './shared/resource-routing.mjs';
import { shredAttachment } from './micro.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');

async function browserInspection(input, catalog, signal) {
  const files = validatedAttachments(input.files), original = files.find(file => file.asset.role === 'original');
  let body = String(input.text || '').trim(), url = '', title, description = '', type = original?.type || 'text';
  const warnings = [];
  if (original) {
    title = original.asset.originalName.replace(/\.[a-z0-9]{1,8}$/i, '').replace(/[_-]+/g, ' ');
    description = body;
    body = original.type === 'text' ? new TextDecoder().decode(original.bytes).slice(0, MAX_RESOURCE_TEXT) : '';
    if (original.type !== 'text') warnings.push('This browser could not analyze the file contents. The original is saved using its file details; you can change its folder.');
  } else if (/^https?:\/\/\S+$/i.test(body)) {
    url = body; type = 'link'; title = new URL(url).hostname; body = '';
    try {
      const response = await fetch(url, { credentials: 'omit', signal, redirect: 'follow' });
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error();
      const doc = new DOMParser().parseFromString((await response.text()).slice(0, 2000000), 'text/html');
      title = doc.querySelector('meta[property="og:title"]')?.content || doc.title || title;
      description = doc.querySelector('meta[name=description]')?.content || '';
      doc.querySelectorAll('script,style,nav,footer,noscript,template,svg,iframe').forEach(node => node.remove());
      body = doc.body.textContent.replace(/\s+/g, ' ').trim().slice(0, MAX_RESOURCE_TEXT);
    } catch (error) {
      if (signal?.aborted) throw error;
      warnings.push('This browser could not read the page. Its link is saved using the available details; you can change its folder.');
    }
  } else title = body.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').slice(0, 120) || 'Untitled note';
  const resource = { type, title, description, body, url, originalName: original?.asset.originalName };
  const classification = classifyResource(resource, catalog);
  resource.category = classification.category; resource.tags = classification.tags;
  return { resource, classification, files: await Promise.all(files.map(async file => ({ ...file.asset, sha256: await digest(file.bytes) }))), warnings };
}

export async function inspectResourceInput(input, catalog, { signal } = {}) {
  let response;
  try { response = await fetch(new URL('api/resource/inspect', document.baseURI), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal }); }
  catch (error) { if (signal?.aborted) throw error; return browserInspection(input, catalog, signal); }
  if (response.status === 404 || response.status === 405) return browserInspection(input, catalog, signal);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'This resource could not be read. Try again.');
  return result;
}

const readFileBytes = file => file.arrayBuffer ? file.arrayBuffer().then(buffer => new Uint8Array(buffer)) : new Promise((resolve, reject) => {
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

async function videoPreview(file, document) {
  const video = document.createElement('video'), url = URL.createObjectURL(file);
  video.muted = true; video.preload = 'auto'; video.src = url;
  try {
    return await new Promise(resolve => {
      const finish = value => { clearTimeout(timeout); video.onloadeddata = null; video.onerror = null; resolve(value); };
      const timeout = setTimeout(() => finish(null), 10000);
      video.onerror = () => finish(null);
      video.onloadeddata = () => {
        const canvas = document.createElement('canvas'), scale = Math.min(1, 1000 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
        if (!canvas.width || !canvas.height) { finish(null); return; }
        const context = canvas.getContext('2d');
        if (!context) { finish(null); return; }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => finish(blob), 'image/jpeg', .8);
      };
    });
  } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}

export function openResourceComposer({ document, dialog, showModal, store, onSaved, icon }) {
  let selectedFile = null, operationId = '', busy = false, saving = false, previewURL = '', disposed = false;
  const controller = new AbortController();
  showModal(`<div class="dialog-header"><div><span class="resource-eyebrow">${icon('spark')}A little help filing things</span><h2>Add resource</h2></div><button type="button" class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></div><form id="resource-form" class="resource-composer"><label class="sr-only" for="resource-input">Paste a link or text</label><div class="resource-dropzone" id="resource-dropzone"><textarea id="resource-input" placeholder="Paste a link, some text, or an image…" maxlength="${MAX_RESOURCE_TEXT}"></textarea><div id="resource-file" class="resource-file" hidden></div><div class="resource-input-tools"><button type="button" id="resource-upload">${icon('plus')}Choose a file</button><span>or drop it here</span><input id="resource-file-input" type="file" accept="image/*,video/*,audio/*,.pdf,.docx,.txt,.md,.markdown,.csv" hidden></div></div><p id="resource-error" class="form-error" role="alert" hidden></p><div class="resource-progress" role="status" id="resource-progress" hidden></div><button class="button primary resource-submit" type="submit">${icon('spark')}Add resource</button></form><div id="resource-receipt" class="resource-receipt" hidden></div>`, '#resource-input');
  dialog.classList.add('resource-modal');
  dialog.querySelector('h2').id = 'resource-heading';
  dialog.setAttribute('aria-labelledby', 'resource-heading');
  const $ = selector => dialog.querySelector(selector);
  const form = $('#resource-form'), input = $('#resource-input'), fileInput = $('#resource-file-input'), filePill = $('#resource-file'), error = $('#resource-error'), progress = $('#resource-progress');
  const submit = $('.resource-submit');
  $('.resource-input-tools').append(submit);
  submit.classList.add('prompt-send'); submit.setAttribute('aria-label', 'Add resource');
  submit.title = 'Add resource · ⌘ / Ctrl Enter';
  $('#resource-upload').setAttribute('aria-label', 'Attach a document, image, or video');
  const refreshComposer = () => {
    submit.disabled = busy || (!selectedFile && !input.value.trim());
    input.style.height = 'auto'; input.style.height = `${Math.min(240, Math.max(104, input.scrollHeight))}px`;
  };
  const setError = message => { error.textContent = message; error.hidden = !message; };
  const setBusy = (value, message = '') => {
    busy = value; input.disabled = value;
    for (const button of form.querySelectorAll('button')) button.disabled = value;
    progress.hidden = !value; progress.textContent = message;
    form.setAttribute('aria-busy', String(value));
    if (!value) refreshComposer();
  };
  const resetFile = () => { if (previewURL) URL.revokeObjectURL(previewURL); previewURL = ''; selectedFile = null; fileInput.value = ''; filePill.replaceChildren(); filePill.hidden = true; refreshComposer(); };
  const chooseFile = file => {
    if (busy || !file) return;
    if (file.size > MAX_UPLOAD_BYTES) { setError('Choose a file smaller than 50 MB.'); return; }
    resetFile(); selectedFile = file; operationId = ''; setError('');
    const pill = $('#resource-file'); pill.hidden = false;
    if (file.type.startsWith('image/') && !file.type.includes('svg')) { previewURL = URL.createObjectURL(file); const image = document.createElement('img'); image.src = previewURL; image.alt = ''; pill.append(image); }
    else pill.insertAdjacentHTML('beforeend', icon(file.type.startsWith('video/') ? 'video' : 'file'));
    const label = document.createElement('span'); label.textContent = file.name || 'Pasted image'; pill.append(label);
    const remove = document.createElement('button'); remove.type = 'button'; remove.setAttribute('aria-label', 'Remove selected file'); remove.innerHTML = icon('close'); remove.addEventListener('click', () => { shredAttachment(pill); resetFile(); }); pill.append(remove);
    refreshComposer();
  };
  $('#resource-upload').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => chooseFile(fileInput.files[0]));
  input.addEventListener('input', () => { operationId = ''; setError(''); refreshComposer(); });
  input.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !busy && !submit.disabled) { event.preventDefault(); form.requestSubmit(); } });
  refreshComposer();
  form.addEventListener('paste', event => {
    const image = [...(event.clipboardData?.items || [])].find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile();
    if (image) { event.preventDefault(); chooseFile(image); }
  });
  const zone = $('#resource-dropzone');
  zone.addEventListener('dragover', event => { event.preventDefault(); if (!busy) zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', event => { if (!zone.contains(event.relatedTarget)) zone.classList.remove('drag-over'); });
  zone.addEventListener('drop', event => { event.preventDefault(); zone.classList.remove('drag-over'); chooseFile(event.dataTransfer?.files[0]); });
  const cancel = event => { if (saving) event.preventDefault(); };
  const outsideClick = event => { if (saving && event.target === dialog) { event.preventDefault(); event.stopImmediatePropagation(); } };
  const dispose = () => {
    if (disposed) return;
    disposed = true; controller.abort(); resetFile(); dialog.classList.remove('resource-modal'); dialog.removeAttribute('aria-labelledby');
    dialog.removeEventListener('cancel', cancel); dialog.removeEventListener('click', outsideClick, true); dialog.removeEventListener('close', dispose); dialog.removeEventListener('resource-dispose', dispose);
  };
  dialog.addEventListener('cancel', cancel);
  dialog.addEventListener('click', outsideClick, true);
  dialog.addEventListener('close', dispose, { once: true });
  dialog.addEventListener('resource-dispose', dispose, { once: true });
  form.addEventListener('submit', async event => {
    event.preventDefault(); event.stopPropagation();
    if (busy) return;
    if (!selectedFile && !input.value.trim()) { setError('Paste a link or text, or choose a file.'); input.focus(); return; }
    setError(''); setBusy(true, 'Understanding your resource…');
    try {
      const files = [];
      if (selectedFile) {
        const file = await optimizeImageUpload(selectedFile, document);
        const bytes = await readFileBytes(file);
        const format = detectUpload(bytes, file.name, file.type);
        files.push({ name: file.name || 'Pasted image.png', type: file.type, data: base64FromBytes(bytes), role: 'original' });
        if (format.type === 'video') {
          const thumbnail = await videoPreview(selectedFile, document);
          if (thumbnail) files.push({ name: 'Video preview.jpg', type: 'image/jpeg', data: base64FromBytes(await readFileBytes(thumbnail)), role: 'thumbnail' });
        }
      }
      const inspection = await inspectResourceInput({ text: input.value, files }, store.catalog, { signal: controller.signal });
      if (disposed) return;
      operationId ||= `b_res_${crypto.randomUUID().replaceAll('-', '')}`;
      setBusy(true, 'Saving it in your library…'); saving = true;
      for (const button of dialog.querySelectorAll('[data-action=close-modal]')) button.disabled = true;
      const result = await store.apply(resourceImportOperation(inspection, { id: operationId, files }));
      const block = store.catalog.blocks.find(block => block.id === result.entityId);
      const destinationId = result.destinationId || store.catalog.collections.find(collection => collection.items.some(item => item.kind === 'block' && item.id === result.entityId))?.id || '';
      const path = resourceFolderPath(store.catalog, destinationId);
      onSaved?.(result);
      if (disposed) return;
      form.hidden = true;
      const receipt = $('#resource-receipt'); receipt.hidden = false;
      receipt.innerHTML = `<span class="resource-success-mark">${icon('check')}</span><p class="resource-receipt-status">${result.alreadySaved ? 'Already in your library' : 'Found a home for it'}</p><h3>${escape(block.title)}</h3><a class="resource-destination" href="${destinationId ? `#/collection/${escape(destinationId)}` : '#/materials'}">${icon('folder')}<span>${escape(path.join(' / ') || 'All materials')}</span>${icon('arrow')}</a><p class="resource-reason">${escape(result.alreadySaved ? 'Your existing resource is kept without creating a duplicate.' : inspection.classification.reason)}</p>${inspection.warnings.length ? `<p class="resource-warning">${inspection.warnings.map(escape).join(' ')}</p>` : ''}<div class="resource-receipt-actions"><button class="button primary" data-action="open-block" data-id="${escape(block.id)}">Open resource</button><button class="button quiet" data-action="connect-block" data-id="${escape(block.id)}">Change folder</button></div><button class="resource-another" type="button">${icon('plus')}Add another</button>`;
      receipt.querySelector('.resource-destination').addEventListener('click', () => dialog.close());
      receipt.querySelector('[data-action=connect-block]').addEventListener('click', () => { resetFile(); });
      receipt.querySelector('.resource-another').addEventListener('click', () => { resetFile(); input.value = ''; operationId = ''; receipt.hidden = true; form.hidden = false; setBusy(false); input.focus(); });
      receipt.querySelector('[data-action=open-block]').focus({ preventScroll: true });
    } catch (failure) { if (!disposed && failure.name !== 'AbortError') setError(failure.message || 'The resource could not be saved. Your input is still here.'); }
    finally { saving = false; if (!disposed) { setBusy(false); for (const button of dialog.querySelectorAll('[data-action=close-modal]')) button.disabled = false; } }
  });
}
