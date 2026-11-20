import { validateCanvases } from '../shared/canvas.mjs';
import { readFile, readdir, mkdir, cp, rm, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizeTaxonomy } from '../shared/taxonomy.mjs';
import { canonicalContentPaths, validateExtraFiles } from '../shared/model.mjs';
import { validatePDFReadings } from '../shared/pdf-reading.mjs';

const exec = promisify(execFile);
const ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,100}$/;
export const ASSET_TYPES = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'], ['.gif', 'image/gif'], ['.avif', 'image/avif'],
  ['.pdf', 'application/pdf'], ['.txt', 'text/plain'], ['.md', 'text/markdown'],
  ['.mp4', 'video/mp4'], ['.m4v', 'video/x-m4v'], ['.webm', 'video/webm'],
  ['.mov', 'video/quicktime'],
  ['.mp3', 'audio/mpeg'], ['.m4a', 'audio/mp4'], ['.ogg', 'audio/ogg'], ['.wav', 'audio/wav'],
  ['.bin', 'application/octet-stream'],
]);
const MAX_RECORD_BYTES = 2 * 1024 * 1024;
export const MAX_ASSET_BYTES = 95 * 1024 * 1024;

function isSafePath(value, prefix = '') {
  return typeof value === 'string' && value.length > 0 && !value.includes('\\') &&
    !/[\u0000-\u001f\u007f?#%]/.test(value) && !path.posix.isAbsolute(value) &&
    value.split('/').every(part => part !== '.' && part !== '..' && part !== '') &&
    (!prefix || value.startsWith(prefix));
}

async function exists(target) {
  try { return await lstat(target); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function walk(directory, { skipGenerated = false } = {}) {
  const stat = await exists(directory);
  if (!stat) return [];
  if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in content: ${directory}`);
  const output = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in content: ${target}`);
    if (entry.name === '.DS_Store' || (skipGenerated && entry.name === '_generated')) continue;
    if (entry.isDirectory()) output.push(...await walk(target, { skipGenerated }));
    else if (entry.isFile()) output.push(target);
  }
  return output;
}

async function jsonFile(file) {
  const stat = await lstat(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Expected a regular JSON file: ${file}`);
  if (stat.size > MAX_RECORD_BYTES) throw new Error(`Record exceeds 2 MiB: ${file}`);
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { throw new Error(`Cannot read JSON at ${file}: ${error.message}`); }
}

export function assetBytesMatch(data, extension) {
  data = Buffer.isBuffer(data) ? data : Buffer.from(data);
  extension = String(extension).toLowerCase();
  if (extension === '.png') return data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (extension === '.jpg' || extension === '.jpeg') return data[0] === 255 && data[1] === 216 && data[2] === 255;
  if (extension === '.gif') return /^GIF8[79]a$/.test(data.subarray(0, 6).toString());
  if (extension === '.webp') return data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP';
  if (extension === '.avif') return data.subarray(4, 8).toString() === 'ftyp' && /avif|avis/.test(data.subarray(8, 32).toString());
  if (extension === '.pdf') return data.subarray(0, 5).toString() === '%PDF-';
  if (['.mp4', '.m4v', '.m4a', '.mov'].includes(extension)) {
    if (data.length < 16 || data.subarray(4, 8).toString() !== 'ftyp') return false;
    const size = data.readUInt32BE(0);
    if (size < 16 || size > data.length) return false;
    const brands = [data.subarray(8, 12).toString()];
    for (let offset = 16; offset + 4 <= Math.min(size, 256); offset += 4) brands.push(data.subarray(offset, offset + 4).toString());
    return extension === '.mov' ? brands.includes('qt  ') : brands.some(brand => /^(?:isom|iso[2-9]|mp4[12]|avc1|M4V |M4A |dash|MSNV|3gp[4-9])$/.test(brand));
  }
  if (extension === '.webm') return data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) && data.subarray(4, 256).includes(Buffer.from('webm'));
  if (extension === '.mp3') return data.subarray(0, 3).toString() === 'ID3' || (data.length >= 4 && data[0] === 255 && (data[1] & 0xe0) === 0xe0 && (data[1] & 0x06) !== 0 && (data[2] & 0xf0) !== 0xf0);
  if (extension === '.ogg') return data.length >= 27 && data.subarray(0, 4).toString() === 'OggS' && data[4] === 0;
  if (extension === '.wav') return data.length >= 12 && data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WAVE';
  // Unknown originals are preserved as inert downloads, including empty files.
  if (extension === '.bin') return true;
  return extension === '.txt' || extension === '.md';
}

/** Validate a hydrated catalog. Returns it unchanged or throws one actionable error. */
export function validateLibrary(catalog) {
  for (const block of catalog.blocks || []) validatePDFReadings(block);
  validateCanvases(catalog.library, catalog.blocks || []);
  const errors = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  const version = (record, label) => check(record?.schemaVersion === 1, `${label}: unsupported schemaVersion; expected 1`);
  const title = (record, label) => check(typeof record?.title === 'string' && record.title.trim().length > 0, `${label}: title is required`);
  const id = (record, label) => check(typeof record?.id === 'string' && ID.test(record.id), `${label}: invalid stable ID`);
  const folders = Array.isArray(catalog?.folders) ? catalog.folders : [];
  const collections = Array.isArray(catalog?.collections) ? catalog.collections : [];
  const blocks = Array.isArray(catalog?.blocks) ? catalog.blocks : [];
  version(catalog, 'catalog');
  version(catalog?.library, 'library.json');
  title(catalog?.library, 'library.json');
  check(Array.isArray(catalog?.folders) && Array.isArray(catalog?.collections) && Array.isArray(catalog?.blocks), 'catalog: folders, collections, and blocks must be arrays');

  const allIDs = new Set();
  const directoryKinds = new Map();
  for (const [kind, records] of [['folder', folders], ['collection', collections], ['block', blocks]]) {
    for (const record of records) {
      const label = record?.path || `${kind} ${record?.id || '(unknown)'}`;
      version(record, label); title(record, label); id(record, label);
      check(!allIDs.has(record.id), `${label}: duplicate ID ${record.id}`);
      allIDs.add(record.id);
      const prefix = kind === 'block' ? 'content/blocks/' : 'content/collections/';
      check(isSafePath(record.path, prefix), `${label}: unsafe record path`);
      check(record.path?.endsWith(`/${kind}.json`), `${label}: expected ${kind}.json`);
      if (kind === 'block') check(record.path === `content/blocks/${record.id}/block.json`, `${label}: block folder must match its ID`);
      else {
        const directory = path.posix.dirname(record.path || '');
        check(!directoryKinds.has(directory), `${label}: a directory cannot represent both a folder and a collection`);
        directoryKinds.set(directory, kind);
      }
    }
  }
  const folderIDs = new Set(folders.map(record => record.id));
  const collectionIDs = new Set(collections.map(record => record.id));
  const blockIDs = new Set(blocks.map(record => record.id));
  check(catalog?.library?.inboxCollectionId == null || collectionIDs.has(catalog.library.inboxCollectionId), 'library.json: legacy inboxCollectionId must refer to an existing collection');
  for (const record of [...folders, ...collections]) {
    check(record.parentId === null || folderIDs.has(record.parentId), `${record.path}: missing parent folder ${record.parentId}`);
    const parentPath = path.posix.dirname(path.posix.dirname(record.path || ''));
    const parent = folders.find(folder => folder.id === record.parentId);
    check(record.parentId === null ? parentPath === 'content/collections' : parent && path.posix.dirname(parent.path) === parentPath,
      `${record.path}: parentId must match its physical folder`);
  }
  for (const collection of collections) {
    check(Array.isArray(collection.items), `${collection.path}: items must be an array`);
    const seen = new Set();
    for (const item of Array.isArray(collection.items) ? collection.items : []) {
      const key = `${item?.kind}:${item?.id}`;
      check(!seen.has(key), `${collection.path}: duplicate membership ${key}`);
      seen.add(key);
      check(item?.kind === 'block' || item?.kind === 'collection', `${collection.path}: invalid reference kind ${item?.kind}`);
      check((item?.kind === 'block' ? blockIDs : collectionIDs).has(item?.id), `${collection.path}: missing ${key}`);
      check(!(item?.kind === 'collection' && item.id === collection.id), `${collection.path}: cannot connect a collection to itself`);
    }
  }
  for (const block of blocks) {
    try { normalizeTaxonomy(block); }
    catch (error) { errors.push(`${block.path}: ${error.message}`); }
    check(['link', 'text', 'image', 'file', 'video', 'audio'].includes(block.type), `${block.path}: unsupported material type ${block.type}`);
    if (block.source?.url) {
      try {
        const source = new URL(block.source.url);
        check(['http:', 'https:'].includes(source.protocol) && !source.username && !source.password, `${block.path}: source URL must use HTTP or HTTPS without embedded credentials`);
      }
      catch { errors.push(`${block.path}: invalid source URL`); }
    }
    if (block.bodyPath) check(isSafePath(block.bodyPath) && ['.md', '.txt'].includes(path.posix.extname(block.bodyPath).toLowerCase()), `${block.path}: unsafe bodyPath`);
    check(Array.isArray(block.assets), `${block.path}: assets must be an array`);
    for (const asset of Array.isArray(block.assets) ? block.assets : []) {
      const extension = path.posix.extname(asset?.path || '').toLowerCase();
      check(isSafePath(asset?.path, 'assets/') && ASSET_TYPES.has(extension), `${block.path}: unsafe or unsupported asset ${asset?.path}`);
      check(ASSET_TYPES.get(extension) === asset?.mimeType, `${block.path}: asset MIME type does not match ${asset?.path}`);
    }
    check(Array.isArray(block.related), `${block.path}: related must be an array`);
    const relatedSeen = new Set();
    for (const reference of Array.isArray(block.related) ? block.related : []) {
      const referenceID = typeof reference === 'string' ? reference : reference?.id;
      check(blockIDs.has(referenceID) && referenceID !== block.id, `${block.path}: invalid related material ${referenceID}`);
      check(!relatedSeen.has(referenceID), `${block.path}: duplicate related material ${referenceID}`);
      relatedSeen.add(referenceID);
    }
  }
  try { validateExtraFiles(catalog); } catch (error) { errors.push(error.message); }
  if (errors.length) throw new Error(`Invalid library:\n${errors.map(message => `- ${message}`).join('\n')}`);
  return catalog;
}

/** Read canonical content and resolve folder parents without trusting generated indexes. */
export async function loadLibrary(root) {
  root = path.resolve(root);
  const contentRoot = path.join(root, 'content');
  const files = await walk(contentRoot, { skipGenerated: true });
  for (const file of files) {
    const extension = path.extname(file).toLowerCase();
    if (!['.json', '.md', '.txt', ...ASSET_TYPES.keys()].includes(extension)) {
      throw new Error(`Unsupported file in content: ${path.relative(root, file)}`);
    }
    if (ASSET_TYPES.has(extension) && !['.md', '.txt'].includes(extension)) {
      const stat = await lstat(file);
      if (stat.size > MAX_ASSET_BYTES) throw new Error(`Asset exceeds 95 MiB: ${path.relative(root, file)}`);
      if (!assetBytesMatch(await readFile(file), extension)) throw new Error(`Asset bytes do not match file type: ${path.relative(root, file)}`);
    }
  }
  const library = await jsonFile(path.join(contentRoot, 'library.json'));
  const folderFiles = files.filter(file => file.endsWith('/folder.json'));
  const collectionFiles = files.filter(file => file.endsWith('/collection.json'));
  const blockFiles = files.filter(file => file.endsWith('/block.json'));
  const readRecord = async file => ({ ...await jsonFile(file), path: path.relative(root, file).split(path.sep).join('/') });
  const folders = await Promise.all(folderFiles.map(readRecord));
  const collections = await Promise.all(collectionFiles.map(readRecord));
  const blocks = await Promise.all(blockFiles.map(async file => {
    const record = await readRecord(file);
    if (record.bodyPath && !isSafePath(record.bodyPath)) throw new Error(`${record.path}: unsafe bodyPath`);
    const directory = path.dirname(file);
    const bodyFile = record.bodyPath ? path.join(directory, record.bodyPath) : null;
    const bodyStat = bodyFile ? await exists(bodyFile) : null;
    if (bodyFile && !bodyStat) throw new Error(`${record.path}: body file not found: ${record.bodyPath}`);
    if (bodyStat?.size > MAX_RECORD_BYTES) throw new Error(`${record.path}: body exceeds 2 MiB`);
    const summaryFile = path.join(directory, 'summary.json');
    const summary = await exists(summaryFile) ? await jsonFile(summaryFile) : null;
    return { ...record, ...normalizeTaxonomy(record), body: bodyFile ? await readFile(bodyFile, 'utf8') : '', summary };
  }));
  const byDirectory = new Map(folders.map(folder => [path.posix.dirname(folder.path), folder.id]));
  for (const record of [...folders, ...collections]) {
    record.parentId = byDirectory.get(path.posix.dirname(path.posix.dirname(record.path))) || null;
  }
  let sourceCommit = 'local';
  try { sourceCommit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim(); } catch { /* Untracked local drafts are supported. */ }
  const catalog = { schemaVersion: 1, library, folders, collections, blocks, sourceCommit };
  const canonical = canonicalContentPaths(catalog);
  catalog.extraFiles = files.map(file => path.relative(root, file).split(path.sep).join('/')).filter(file => !canonical.has(file));
  validateLibrary(catalog);
  for (const block of blocks) {
    block.collectionIds = collections.filter(collection => collection.items.some(item => item.kind === 'block' && item.id === block.id)).map(collection => collection.id);
    for (const asset of block.assets) {
      const file = path.join(root, path.posix.dirname(block.path), asset.path);
      const stat = await exists(file);
      if (!stat?.isFile()) throw new Error(`${block.path}: missing asset ${asset.path}`);
      if (stat.size > MAX_ASSET_BYTES) throw new Error(`${block.path}: asset exceeds 95 MiB: ${asset.path}`);
      if (!assetBytesMatch(await readFile(file), path.extname(file).toLowerCase())) throw new Error(`${block.path}: asset bytes do not match file type: ${asset.path}`);
    }
  }
  for (const collection of collections) {
    collection.collectionIds = collections.filter(parent => parent.items.some(item => item.kind === 'collection' && item.id === collection.id)).map(parent => parent.id);
  }
  return catalog;
}

/** Build a portable static tree with a deterministic generated catalog. */
export async function buildLibrary(root, out = path.join(root, 'dist'), options = {}) {
  root = path.resolve(root); out = path.resolve(out);
  const relative = path.relative(root, out);
  if (!relative || relative.startsWith('..') || ['content', 'web', 'shared', 'scripts'].some(dir => relative === dir || relative.startsWith(`${dir}${path.sep}`))) {
    throw new Error('Build output must be a separate directory inside the project root.');
  }
  const catalog = await loadLibrary(root);
  const env = options.env || process.env;
  const publish = options.publish ?? (env.CHARTA_PUBLISH === '1' || env.JELLY_PUBLISH === '1');
  const excluded = new Set();
  if (publish) {
    const originals = catalog.blocks.flatMap(block => block.assets.filter(asset => asset.role === 'original').map(asset => ({ block, asset })));
    if (originals.length) {
      const repository = options.repository || env.GITHUB_REPOSITORY;
      const commit = options.commit || (/^[a-f0-9]{40}$/i.test(catalog.sourceCommit) ? catalog.sourceCommit : env.GITHUB_SHA);
      if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]+$/.test(repository || '') || ['.', '..'].includes(repository?.split('/')[1]) || !/^[a-f0-9]{40}$/i.test(commit || '')) {
        throw new Error('Publishing originals separately requires GITHUB_REPOSITORY and a full immutable source commit (Git HEAD or GITHUB_SHA).');
      }
      catalog.sourceCommit = commit;
      for (const { block, asset } of originals) {
        const canonical = path.posix.join(path.posix.dirname(block.path), asset.path);
        excluded.add(path.resolve(root, canonical));
        asset.remoteUrl = `https://raw.githubusercontent.com/${repository.split('/').map(encodeURIComponent).join('/')}/${commit}/${canonical.split('/').map(encodeURIComponent).join('/')}`;
      }
      catalog.publication = { originals: 'github-raw', originalCount: originals.length, repository, commit };
    }
  }
  if (!await exists(path.join(root, 'web', 'index.html'))) throw new Error('Missing web/index.html');
  // No deployment tree may contain a symlink to files outside the validated sources.
  for (const source of ['web', 'shared', 'extension']) await walk(path.join(root, source));
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(path.join(root, 'web'), out, { recursive: true });
  const mediaPackage = new URL('../node_modules/mediabunny/', import.meta.url);
  await mkdir(path.join(out, 'vendor'), { recursive: true });
  await cp(new URL('dist/bundles/mediabunny.min.mjs', mediaPackage), path.join(out, 'vendor/mediabunny.mjs'));
  await cp(new URL('LICENSE', mediaPackage), path.join(out, 'vendor/mediabunny-LICENSE'));
  if (await exists(path.join(root, 'shared'))) await cp(path.join(root, 'shared'), path.join(out, 'shared'), { recursive: true });
  await cp(path.join(root, 'content'), path.join(out, 'content'), { recursive: true, filter: file => !file.includes(`${path.sep}_generated`) && !file.endsWith('.DS_Store') && !excluded.has(path.resolve(file)) });
  await mkdir(path.join(out, 'content', '_generated'), { recursive: true });
  await writeFile(path.join(out, 'content', '_generated', 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  await writeFile(path.join(out, '.nojekyll'), '');
  if (await exists(path.join(root, 'extension', 'manifest.json'))) {
    try { await exec('zip', ['-q', '-r', path.join(out, 'extension.zip'), '.', '-x', '*.DS_Store'], { cwd: path.join(root, 'extension') }); }
    catch (error) { console.warn(`Extension ZIP unavailable: ${error.message}`); }
  }
  return catalog;
}
