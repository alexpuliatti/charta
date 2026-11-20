import { base64FromBytes, detectUpload, MAX_UPLOAD_BYTES, MAX_RESOURCE_TEXT, validatedAttachments } from './shared/uploads.mjs';
import { classifyResource, resourceImportOperation, resourceFolderPath } from './shared/resource-routing.mjs';
import { optimizeMediaUpload, readFileBytes, uploadSize } from './media-upload.mjs';
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
    if (original.type !== 'text') warnings.push('This browser used the file details to classify your upload.');
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

export function openResourceComposer({ document, dialog, showModal, store, onSaved, icon, draft = null }) {
  let selectedFile = null, preparedFile = null, operationId = '', busy = false, saving = false, previewURL = '', disposed = false;
  const controller = new AbortController();
  const heading = draft ? 'Upload file' : 'Add resource';
  const prompt = draft ? 'Add an optional note…' : 'Paste a link, some text, or an image…';
  const destination = draft ? resourceFolderPath(store.catalog, draft.collection).join(' / ') || 'All materials' : '';
  showModal(`<div class="dialog-header"><div><span class="resource-eyebrow">${draft ? escape(destination) : icon('spark') + 'A little help filing things'}</span><h2>${heading}</h2></div><button type="button" class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></div><form id="resource-form" class="resource-composer"><label class="sr-only" for="resource-input">${draft ? 'Optional note' : 'Paste a link or text'}</label><div class="resource-dropzone" id="resource-dropzone"><textarea id="resource-input" placeholder="${prompt}" maxlength="${MAX_RESOURCE_TEXT}">${escape(draft?.description || draft?.body || '')}</textarea><div id="resource-file" class="resource-file" hidden></div><div class="resource-input-tools"><button type="button" id="resource-upload">${icon('plus')}Choose a file</button><span>or drop it here</span><input id="resource-file-input" type="file" accept="image/*,video/*,audio/*,.pdf,.docx,.txt,.md,.markdown,.csv" hidden></div></div><p id="resource-error" class="form-error" role="alert" hidden></p><div class="resource-progress" role="status" id="resource-progress" hidden></div><button class="button primary resource-submit" type="submit">${icon('spark')}${heading}</button></form><div id="resource-receipt" class="resource-receipt" hidden></div>`, draft ? '#resource-upload' : '#resource-input');
  dialog.classList.add('resource-modal');
  dialog.querySelector('h2').id = 'resource-heading';
  dialog.setAttribute('aria-labelledby', 'resource-heading');
  const $ = selector => dialog.querySelector(selector);
  const form = $('#resource-form'), input = $('#resource-input'), fileInput = $('#resource-file-input'), filePill = $('#resource-file'), error = $('#resource-error'), progress = $('#resource-progress');
  const submit = $('.resource-submit');
  $('.resource-input-tools').append(submit);
  submit.classList.add('prompt-send'); submit.setAttribute('aria-label', heading);
  submit.title = `${heading} · ⌘ / Ctrl Enter`;
  $('#resource-upload').setAttribute('aria-label', 'Attach a document, image, or video');
  const refreshComposer = () => {
    submit.disabled = busy || (!selectedFile && (draft || !input.value.trim()));
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
  const resetFile = () => { if (previewURL) URL.revokeObjectURL(previewURL); previewURL = ''; selectedFile = null; preparedFile = null; fileInput.value = ''; filePill.replaceChildren(); filePill.hidden = true; refreshComposer(); };
  const chooseFile = file => {
    if (busy || !file) return;
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
    const file = [...(event.clipboardData?.items || [])].find(item => item.kind === 'file')?.getAsFile();
    if (file) { event.preventDefault(); chooseFile(file); }
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
    if (!selectedFile && (draft || !input.value.trim())) { setError(draft ? 'Choose a file to upload.' : 'Paste a link or text, or choose a file.'); (draft ? $('#resource-upload') : input).focus(); return; }
    setError(''); setBusy(true, 'Understanding your resource…');
    try {
      const files = [];
      let optimization = '';
      if (selectedFile) {
        preparedFile ||= await optimizeMediaUpload(selectedFile, document, { signal: controller.signal, onStatus: message => { progress.textContent = message; } });
        const file = preparedFile;
        const bytes = await readFileBytes(file);
        const format = detectUpload(bytes, file.name, file.type);
        if (['image', 'video'].includes(format.type)) optimization = file.size < selectedFile.size
          ? `Optimized in your browser from ${uploadSize(selectedFile.size)} to ${uploadSize(file.size)}.`
          : `Kept the original file (${uploadSize(file.size)}).`;
        files.push({ name: file.name || 'Pasted image.png', type: file.type, data: base64FromBytes(bytes), role: 'original' });
        if (format.type === 'video') {
          const thumbnail = await videoPreview(file, document);
          if (thumbnail && file.size + thumbnail.size <= MAX_UPLOAD_BYTES) files.push({ name: 'Video preview.jpg', type: 'image/jpeg', data: base64FromBytes(await readFileBytes(thumbnail)), role: 'thumbnail' });
        }
      }
      if (disposed) return;
      progress.textContent = 'Understanding your resource…';
      const payload = { text: input.value, files };
      const inspection = store.hasLocalService
        ? await inspectResourceInput(payload, store.catalog, { signal: controller.signal })
        : await browserInspection(payload, store.catalog, controller.signal);
      if (disposed) return;
      operationId ||= `b_res_${crypto.randomUUID().replaceAll('-', '')}`;
      setBusy(true, 'Saving it in your library…'); saving = true;
      for (const button of dialog.querySelectorAll('[data-action=close-modal]')) button.disabled = true;
      const operation = resourceImportOperation(inspection, { id: operationId, files });
      if (draft) {
        operation.destinationId = draft.collection;
        operation.classification = { method: 'manual', confidence: 1, reason: 'Saved to your chosen destination.' };
        if (draft.title?.trim()) operation.block.title = draft.title.trim();
        if (draft.category?.trim()) operation.block.category = draft.category.trim();
        if (draft.tags?.trim()) operation.block.tags = draft.tags.split(',');
      }
      const result = await store.apply(operation);
      const block = store.catalog.blocks.find(block => block.id === result.entityId);
      const destinationId = result.destinationId ?? store.catalog.collections.find(collection => collection.items.some(item => item.kind === 'block' && item.id === result.entityId))?.id ?? '';
      const path = resourceFolderPath(store.catalog, destinationId);
      onSaved?.(result);
      if (disposed) return;
      form.hidden = true;
      const receipt = $('#resource-receipt'); receipt.hidden = false;
      receipt.innerHTML = `<span class="resource-success-mark">${icon('check')}</span><p class="resource-receipt-status">${result.alreadySaved ? 'Already in your library' : 'Found a home for it'}</p><h3>${escape(block.title)}</h3><a class="resource-destination" href="${destinationId ? `#/collection/${escape(destinationId)}` : '#/materials'}">${icon('folder')}<span>${escape(path.join(' / ') || 'All materials')}</span>${icon('arrow')}</a><p class="resource-reason">${escape(result.alreadySaved ? 'Your existing resource is kept without creating a duplicate.' : operation.classification.reason)}</p>${optimization && !result.alreadySaved ? `<p class="resource-reason">${escape(optimization)}</p>` : ''}${inspection.warnings.length ? `<p class="resource-warning">${inspection.warnings.map(escape).join(' ')}</p>` : ''}<div class="resource-receipt-actions"><button class="button primary" data-action="open-block" data-id="${escape(block.id)}">Open resource</button><button class="button quiet" data-action="connect-block" data-id="${escape(block.id)}">Change folder</button></div><button class="resource-another" type="button">${icon('plus')}Add another</button>`;
      receipt.querySelector('.resource-destination').addEventListener('click', () => dialog.close());
      receipt.querySelector('[data-action=connect-block]').addEventListener('click', () => { resetFile(); });
      receipt.querySelector('.resource-another').addEventListener('click', () => {
        resetFile(); input.value = ''; operationId = '';
        if (draft) draft = { collection: draft.collection };
        receipt.hidden = true; form.hidden = false; setBusy(false); (draft ? $('#resource-upload') : input).focus();
      });
      receipt.querySelector('[data-action=open-block]').focus({ preventScroll: true });
    } catch (failure) { if (!disposed && failure.name !== 'AbortError') setError(failure.message || 'The resource could not be saved. Your input is still here.'); }
    finally { saving = false; if (!disposed) { setBusy(false); for (const button of dialog.querySelectorAll('[data-action=close-modal]')) button.disabled = false; } }
  });
}
