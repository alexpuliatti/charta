import { JSDOM } from 'jsdom';
import { unzipSync } from 'fflate';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { checkedURL } from './arena-download.mjs';
import { validatedAttachments, MAX_RESOURCE_TEXT, MAX_UPLOAD_BYTES, base64FromBytes } from '../shared/uploads.mjs';
import { classifyResource } from '../shared/resource-routing.mjs';
import { semanticResourceDestination } from './resource-models.mjs';

const compact = value => String(value || '').replace(/\s+/g, ' ').trim();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

/** Fetch public HTTPS sources without credentials, executable scripts, or private DNS targets. */
export async function fetchResourceURL(value, { lookup = dnsLookup, request, maxBytes = MAX_UPLOAD_BYTES } = {}) {
  let current = await checkedURL(value, lookup, { allowHTTP: true });
  for (let hop = 0; hop < 5; hop++) {
    const addresses = await lookup(current.hostname, { all: true, verbatim: true });
    // Validate this exact DNS answer, then pin the socket to it to prevent DNS rebinding.
    await checkedURL(current.href, async () => addresses, { allowHTTP: true });
    const response = await new Promise((resolve, reject) => {
      const req = (request || (current.protocol === 'http:' ? httpRequest : httpsRequest))(current, {
        signal: AbortSignal.timeout(15000),
        headers: { Accept: 'text/html,application/pdf,text/plain,*/*;q=0.7', 'User-Agent': 'Charta resource reader' },
        lookup: (host, options, callback) => options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family)
      }, res => {
        const limit = /html/.test(res.headers['content-type'] || '') ? Math.min(maxBytes, 6 * 1024 * 1024) : maxBytes;
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) { res.resume(); resolve({ status: res.statusCode, location: res.headers.location }); return; }
        if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); reject(new Error(`The source returned HTTP ${res.statusCode}.`)); return; }
        if (Number(res.headers['content-length']) > limit) { res.destroy(); reject(new Error('The linked resource is too large to inspect. Upload a smaller file instead.')); return; }
        const chunks = []; let size = 0;
        res.on('data', chunk => { size += chunk.length; if (size > limit) { res.destroy(); reject(new Error('The linked resource is too large to inspect. Upload a smaller file instead.')); } else chunks.push(chunk); });
        res.on('end', () => resolve({ status: res.statusCode, bytes: Buffer.concat(chunks), mimeType: String(res.headers['content-type'] || '').split(';')[0], url: current.href }));
        res.on('error', reject);
      });
      req.setTimeout(15000, () => req.destroy(new Error('The source took too long to respond.')));
      req.on('error', reject); req.end();
    });
    if (!response.location) return response;
    current = await checkedURL(new URL(response.location, current).href, lookup, { allowHTTP: true });
  }
  throw new Error('The source redirected too many times.');
}

export function extractResourceHTML(html, url) {
  const dom = new JSDOM(html, { url });
  try {
    const doc = dom.window.document;
    const metadata = name => doc.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.content || '';
    let title = compact(metadata('og:title') || doc.title || doc.querySelector('h1')?.textContent || new URL(url).hostname).slice(0, 180);
    if (/\/portfolio\/?$/.test(new URL(url).pathname) && !/portfolio/i.test(title)) title = `${title} — Portfolio`;
    const description = compact(metadata('description') || metadata('og:description')).slice(0, 1000);
    doc.querySelectorAll('script,style,noscript,template,iframe,object,svg,nav,footer,form').forEach(node => node.remove());
    const main = doc.querySelector('main,article,[role=main]') || doc.body;
    const body = compact(main?.textContent).slice(0, MAX_RESOURCE_TEXT);
    const pageType = metadata('og:type');
    const author = compact(metadata('author') || metadata('article:author')).slice(0, 160);
    return { title, description, body, pageType, author };
  } finally { dom.window.close(); }
}

export async function extractResourceDocument(bytes, name, mimeType) {
  if (mimeType === 'application/pdf') {
    const { getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes), { isEvalSupported: false, maxImageSize: 16777216, useSystemFonts: false, verbosity: 0 });
    try {
      const metadata = await pdf.getMetadata().catch(() => null);
      const pages = Math.min(pdf.numPages, 80), texts = [];
      let characters = 0;
      for (let pageNumber = 1; pageNumber <= pages && characters < MAX_RESOURCE_TEXT; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const text = (await page.getTextContent()).items.map(item => item.str || '').join(' ');
        texts.push(text); characters += text.length; page.cleanup();
      }
      return { title: compact(metadata?.info?.Title), body: texts.join('\n\n').slice(0, MAX_RESOURCE_TEXT), method: 'pdf-text', partial: pdf.numPages > pages || characters > MAX_RESOURCE_TEXT, pages: pdf.numPages };
    } finally { await pdf.loadingTask.destroy(); }
  }
  if (/\.docx$/i.test(name)) {
    const contents = unzipSync(bytes, { filter: file => {
      if (file.name !== 'word/document.xml' && file.name !== 'docProps/core.xml') return false;
      if (file.originalSize > 4 * 1024 * 1024) throw new Error('The Word document contains too much extracted text.');
      return true;
    } });
    if (!contents['word/document.xml']) throw new Error('This is not a readable Word document.');
    const dom = new JSDOM();
    try {
      const parse = bytes => new dom.window.DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
      const doc = parse(contents['word/document.xml']);
      if (doc.querySelector('parsererror')) throw new Error('The Word document text could not be read.');
      const paragraphs = [...doc.getElementsByTagNameNS('*', 'p')].map(paragraph => [...paragraph.getElementsByTagNameNS('*', 't')].map(node => node.textContent).join(''));
      const body = paragraphs.join('\n\n');
      const title = contents['docProps/core.xml'] ? parse(contents['docProps/core.xml']).getElementsByTagNameNS('*', 'title')[0]?.textContent || '' : '';
      return { title: compact(title), body: body.slice(0, MAX_RESOURCE_TEXT), method: 'docx-text', partial: body.length > MAX_RESOURCE_TEXT };
    } finally { dom.window.close(); }
  }
  if (/\.(?:txt|md|markdown|csv)$/i.test(name) || mimeType.startsWith('text/')) {
    const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { body: body.slice(0, MAX_RESOURCE_TEXT), method: 'plain-text', partial: body.length > MAX_RESOURCE_TEXT };
  }
  return { body: '', method: 'file-metadata', partial: false };
}

export async function inspectResource(input, { catalog, root, fetchURL = fetchResourceURL, semantic = semanticResourceDestination } = {}) {
  const text = String(input.text || '').trim();
  if (text.length > MAX_RESOURCE_TEXT) throw new Error('Keep pasted text below 500,000 characters.');
  const attachments = validatedAttachments(input.files || []);
  const original = attachments.find(file => file.asset.role === 'original');
  if (!text && !original) throw new Error('Paste a link or text, or choose a file.');
  const warnings = [];
  let resource;
  if (original) {
    let extracted = { body: '', method: 'file-metadata' };
    if (!['image', 'video', 'audio'].includes(original.type)) {
      try { extracted = await extractResourceDocument(original.bytes, original.asset.originalName, original.asset.mimeType); }
      catch { warnings.push('Text could not be extracted. The original file will still be saved.'); }
    }
    if (original.asset.mimeType === 'application/pdf' && !extracted.body) warnings.push('This PDF has no readable text layer; classification uses its file details.');
    if (extracted.partial) warnings.push('Only part of the document text was analyzed. The complete original file is preserved.');
    const fileTitle = original.asset.originalName.replace(/\.[a-z0-9]{1,8}$/i, '').replace(/[_-]+/g, ' ');
    resource = { type: original.type, title: (extracted.title || fileTitle || 'Untitled resource').slice(0, 180), originalName: original.asset.originalName, description: text.slice(0, 1000), body: extracted.body || (original.type === 'text' ? text : ''), url: '', extraction: { method: extracted.method, partial: !!extracted.partial, ...(extracted.pages ? { pages: extracted.pages } : {}) } };
  } else if (/^https?:\/\/\S+$/i.test(text)) {
    const response = await fetchURL(text);
    if (response.mimeType && !/html|text/.test(response.mimeType)) {
      const name = decodeURIComponent(new URL(response.url || text).pathname.split('/').at(-1) || 'Linked file');
      const downloadedFiles = [{ name, type: response.mimeType, role: 'original', data: base64FromBytes(response.bytes) }];
      const result = await inspectResource({ files: downloadedFiles }, { catalog, root, semantic });
      result.resource.url = response.url || text;
      return { ...result, downloadedFiles };
    }
    const parsed = extractResourceHTML(new TextDecoder().decode(response.bytes), response.url || text);
    resource = { type: 'link', ...parsed, url: response.url || text, extraction: { method: 'web-page', capturedAt: new Date().toISOString() } };
    if (!resource.body && !resource.description) warnings.push('The page exposes little readable text. Classification uses its title and address.');
  } else {
    resource = { type: 'text', title: text.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').slice(0, 120) || 'Untitled note', description: '', body: text, url: '', extraction: { method: 'pasted-text' } };
  }
  for (const file of attachments) file.asset.sha256 = sha(file.bytes);
  let classification = classifyResource(resource, catalog);
  const image = attachments.find(file => file.type === 'image');
  if (root && classification.confidence < .8) {
    try {
      const inferred = await semantic({ resource, image, catalog, root });
      if (inferred) classification = inferred;
    } catch { warnings.push('Image and text matching was unavailable. Classification used the readable content and file details.'); }
  }
  resource.category = classification.category;
  resource.tags = classification.tags;
  return { resource, classification, files: attachments.map(file => file.asset), warnings };
}
