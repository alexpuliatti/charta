import { canvasAIConfig, expandCanvasNote } from './canvas-ai.mjs';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildLibrary, loadLibrary, validateLibrary } from './library.mjs';
import { buildComponents } from './build-components.mjs';
import { applyOperation, safeContentPath } from '../shared/model.mjs';
import { assertNoExternalConflict } from '../shared/operations.mjs';
import { mutationBytes } from '../shared/uploads.mjs';
import { inspectResource } from './resources.mjs';
import { indexImportedResource } from './resource-models.mjs';
import { createArchiveSearch } from './archive-search.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = path.join(root, 'dist');
const port = Number(process.env.PORT || 4173);
const host = '127.0.0.1';
await buildComponents();
await buildLibrary(root, output);
let mutation = Promise.resolve();
const archiveSearch = createArchiveSearch({ root, loadCatalog: () => loadLibrary(root) });
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.zip': 'application/zip', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.m4v': 'video/x-m4v', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
const send = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };

async function writeMutation(op) {
  const current = await loadLibrary(root);
  if (op.baseCatalog) assertNoExternalConflict(op.baseCatalog, current, op);
  const next = applyOperation(current, op);
  validateLibrary(next.catalog);
  if (op.type === 'update-collection') {
    const source = current.collections.find(c => c.id === op.id);
    const destination = next.catalog.collections.find(c => c.id === op.id);
    if (source && source.path !== destination?.path) {
      const sourceFiles = await fs.readdir(path.join(root, path.dirname(source.path)));
      if (sourceFiles.some(name => name !== 'collection.json')) throw new Error('This collection has additional files. Moving currently supports collections containing only collection.json; its other files have been left untouched.');
      let destinationFiles = [];
      try { destinationFiles = await fs.readdir(path.join(root, path.dirname(destination.path))); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (destinationFiles.length) throw new Error('The destination directory already contains files. Choose another folder.');
    }
  }
  const backups = [];
  try {
    for (const entry of next.writes) {
      safeContentPath(entry.path);
      const filename = path.join(root, entry.path);
      // Reject symlinks in every existing ancestor before touching repository files.
      let probe = root;
      for (const component of entry.path.split('/')) {
        probe = path.join(probe, component);
        try { if ((await fs.lstat(probe)).isSymbolicLink()) throw new Error('Content paths cannot contain symbolic links.'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      let previous;
      try { previous = await fs.readFile(filename); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      backups.push({ filename, previous });
      await fs.mkdir(path.dirname(filename), { recursive: true });
      if (entry.content === null) { await fs.rm(filename, { force: true }); continue; }
      const temporary = `${filename}.jelly-tmp`;
      try {
        await fs.writeFile(temporary, entry.encoding === 'base64' ? mutationBytes(entry) : entry.content);
        await fs.rename(temporary, filename);
      } finally { await fs.rm(temporary, { force: true }); }
    }
    const catalog = validateLibrary(await loadLibrary(root));
    await buildLibrary(root, output);
    let indexing = '';
    if (op.type === 'import-resource' && !next.alreadySaved) {
      try {
        await indexImportedResource(root, catalog.blocks.find(block => block.id === next.entityId), catalog.blocks.length);
        for (const file of ['vectors.bin', 'text-vectors.bin', 'index.json']) await fs.copyFile(path.join(root, 'content/embeddings', file), path.join(output, 'content/embeddings', file));
        indexing = 'ready';
      }
      catch { indexing = 'pending'; }
    }
    archiveSearch.invalidate();
    return { catalog, entityId: next.entityId, ...(indexing ? { indexing } : {}), ...('destinationId' in next ? { destinationId: next.destinationId, alreadySaved: next.alreadySaved } : {}) };
  } catch (error) {
    const restored = await Promise.allSettled(backups.reverse().map(async ({ filename, previous }) => previous ? fs.writeFile(filename, previous) : fs.rm(filename, { force: true })));
    await buildLibrary(root, output).catch(() => {});
    if (restored.some(result => result.status === 'rejected')) throw new Error('Saving failed and content rollback was incomplete. Check your content files.');
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const authority = req.headers.host;
    if (![`${host}:${port}`, `localhost:${port}`].includes(authority)) return send(res, 403, { error: 'Unrecognized local host.' });
    const url = new URL(req.url, `http://${authority}`);
    if (url.pathname === '/api/search/status' && req.method === 'GET') return send(res, 200, await archiveSearch.status());
    if (['/api/search/hybrid', '/api/search/ask'].includes(url.pathname)) {
      if (req.method !== 'POST') return send(res, 405, { error: 'Use POST to search.' });
      if (req.headers.origin !== `http://${authority}` || !req.headers['content-type']?.startsWith('application/json')) return send(res, 403, { error: 'Search requires the same-origin application.' });
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 16000) return send(res, 413, { error: 'Search request is too large.' }); chunks.push(chunk); }
      let query;
      try { query = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))).query; }
      catch { return send(res, 400, { error: 'Invalid search request.' }); }
      const controller = new AbortController();
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      try {
        await mutation;
        const value = await archiveSearch[url.pathname.endsWith('/ask') ? 'ask' : 'hybrid'](query, { signal: controller.signal });
        if (!controller.signal.aborted) return send(res, 200, value);
      } catch (error) { if (!controller.signal.aborted) return send(res, 400, { error: error.message }); }
      return;
    }
    if (url.pathname === '/api/canvas/ai' && req.method === 'GET') { const config = canvasAIConfig(); return send(res, 200, { configured: Boolean(config), model: config?.model || '' }); }
    if (url.pathname === '/api/library' && req.method === 'GET') { await mutation; return send(res, 200, await loadLibrary(root)); }
    if (url.pathname === '/api/mutate' || url.pathname === '/api/resource/inspect' || url.pathname === '/api/canvas/ai') {
      if (req.method !== 'POST') return send(res, 405, { error: 'Use POST to save a change.' });
      if (req.headers.origin !== `http://${authority}` || !req.headers['content-type']?.startsWith('application/json')) return send(res, 403, { error: 'Local writes require the same-origin application.' });
      const chunks = [];
      let bytes = 0;
      // Base64 expands a 50 MiB original and preview; reject larger requests before decoding.
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > (url.pathname === '/api/canvas/ai' ? 64000 : 76 * 1024 * 1024)) return send(res, 413, { error: 'Choose a resource smaller than 50 MB.' });
        chunks.push(chunk);
      }
      let operation;
      try { operation = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { return send(res, 400, { error: 'Invalid JSON request.' }); }
      if (url.pathname === '/api/canvas/ai') {
        try { return send(res, 200, await expandCanvasNote(operation)); }
        catch (error) { return send(res, 400, { error: error.message }); }
      }
      if (url.pathname === '/api/resource/inspect') {
        try { await mutation; return send(res, 200, await inspectResource(operation, { catalog: await loadLibrary(root), root })); }
        catch (error) { return send(res, 400, { error: error.message }); }
      }
      const queued = mutation.then(() => writeMutation(operation));
      mutation = queued.catch(() => {});
      try { return send(res, 200, await queued); } catch (error) { return send(res, 400, { error: error.message }); }
    }
    if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: 'Method not allowed.' });
    await mutation;
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const filename = path.resolve(output, relative);
    if (!filename.startsWith(`${output}${path.sep}`) && filename !== output) return send(res, 403, { error: 'Invalid path.' });
    const stat = await fs.stat(filename);
    if (!stat.isFile()) return send(res, 404, { error: 'Not found.' });
    const headers = { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' };
    let start = 0, end = Math.max(0, stat.size - 1), partial = false;
    if (req.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!range || (!range[1] && !range[2]) || !stat.size) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` }); res.end(); return;
      }
      if (!range[1]) start = Math.max(0, stat.size - Number(range[2]));
      else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size || (range[1] === '' && Number(range[2]) === 0)) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` }); res.end(); return;
      }
      partial = true;
      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }
    const length = stat.size === 0 ? 0 : end - start + 1;
    headers['Content-Length'] = length;
    res.writeHead(partial ? 206 : 200, headers);
    if (req.method === 'HEAD' || !length) { res.end(); return; }
    const stream = createReadStream(filename, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch (error) { send(res, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? 'Not found.' : error.message }); }
});
server.on('error', error => { console.error(`Charta could not start at http://${host}:${port}: ${error.message}`); process.exitCode = 1; });
server.listen(port, host, () => console.log(`Charta is ready at http://${host}:${port}\nLocal changes save directly into content/. Press Ctrl+C to stop.`));
