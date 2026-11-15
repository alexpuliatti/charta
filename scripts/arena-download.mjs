import { createHash, randomUUID } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { mkdir, readFile, writeFile, rename, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { ASSET_TYPES, MAX_ASSET_BYTES, assetBytesMatch } from './library.mjs';

const raster = ['.png', '.jpg', '.webp', '.gif', '.avif'];
const binaryMedia = [...ASSET_TYPES.keys()].filter(ext => !['.bin', '.txt', '.md', '.jpeg', ...raster].includes(ext));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const safeName = value => String(value || '').replace(/\\/g, '/').split('/').at(-1).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 500) || 'original';
const dedupe = values => [...new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
function error(message, code, status) { return Object.assign(new Error(message), { code, ...(status ? { status } : {}) }); }
function publicSource(value) { try { const url = new URL(value); url.search = ''; url.hash = ''; return url.href; } catch { return ''; } }

/** Only uploaded/original binary media is called an original; webpage previews stay thumbnails. */
export function mediaCandidates(block) {
  const image = block.image || {}, attachment = block.attachment || {}, embed = block.embed || {};
  const thumbnails = dedupe([image.small?.src, image.medium?.src, image.square?.src, image.large?.src, embed.thumbnail_url, image.src]);
  const candidates = [];
  if (block.type === 'Image' && image.src) candidates.push({ url: image.src, role: 'original', expectedMime: image.content_type || '', originalName: safeName(image.filename || 'image'), alt: image.alt_text || block.title || '' });
  if (block.type === 'Attachment' && attachment.url) candidates.push({ url: attachment.url, role: 'original', expectedMime: attachment.content_type || '', originalName: safeName(attachment.filename || 'attachment'), alt: block.title || '' });
  if (block.type !== 'Image' && image.src) candidates.push({ url: image.src, role: 'preview', expectedMime: image.content_type || '', originalName: safeName(image.filename || 'preview'), alt: image.alt_text || block.title || '' });
  if (thumbnails.length) candidates.push({ url: thumbnails[0], fallbackUrls: thumbnails.slice(1), role: 'thumbnail', expectedMime: image.content_type || '', originalName: safeName(image.filename || 'thumbnail'), alt: image.alt_text || block.title || '' });
  return candidates.filter((candidate, index) => !candidates.slice(0, index).some(previous => previous.url === candidate.url));
}

function privateIPv4(ip) {
  const [a, b, c] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && ((b === 0 && [0, 2].includes(c)) || b === 168)) ||
    (a === 198 && ([18, 19].includes(b) || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113);
}
function ipv6Words(address) {
  let value = address.toLowerCase();
  if (value.includes('.')) {
    const index = value.lastIndexOf(':'), octets = value.slice(index + 1).split('.').map(Number);
    value = `${value.slice(0, index)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const [left, right = ''] = value.split('::'), first = left ? left.split(':') : [], last = right ? right.split(':') : [];
  const parts = value.includes('::') ? [...first, ...Array(8 - first.length - last.length).fill('0'), ...last] : first;
  return parts.map(part => Number.parseInt(part, 16));
}
function privateIP(address) {
  const type = isIP(address);
  if (type === 4) return privateIPv4(address);
  if (type !== 6 || address.includes('%')) return true;
  const words = ipv6Words(address);
  if (words.length !== 8) return true;
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) return privateIPv4(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
  return (words[0] & 0xe000) !== 0x2000 || (words[0] === 0x2001 && words[1] === 0xdb8) || words[0] === 0x2002;
}

export async function checkedURL(value, lookup, { allowHTTP = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw error('Media URL is invalid.', 'UNSAFE_URL'); }
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!(url.protocol === 'https:' || (allowHTTP && url.protocol === 'http:')) || url.username || url.password || !host || host === 'localhost' || /\.(?:localhost|local|internal)$/i.test(host)) throw error(allowHTTP ? 'Resource requests require a public HTTP(S) URL without credentials.' : 'Media requests require a public HTTPS URL without credentials.', 'UNSAFE_URL');
  if (isIP(host)) {
    if (privateIP(host)) throw error('Private or reserved media hosts are not allowed.', 'UNSAFE_URL');
  } else {
    let addresses;
    try { addresses = await lookup(host, { all: true, verbatim: true }); }
    catch { throw error('Media hostname could not be resolved.', 'NETWORK'); }
    if (!Array.isArray(addresses)) addresses = [addresses];
    if (!addresses.length || addresses.some(item => privateIP(item.address))) throw error('Private or reserved media hosts are not allowed.', 'UNSAFE_URL');
  }
  url.hash = '';
  return url;
}

async function bytesFrom(response, maxBytes) {
  const length = response.headers.get('content-length');
  if (length !== null && Number.isFinite(Number(length)) && Number(length) > maxBytes) {
    await response.body?.cancel?.().catch(() => {});
    throw error('Media exceeds the per-file size limit.', 'ASSET_TOO_LARGE');
  }
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw error('Media exceeds the per-file size limit.', 'ASSET_TOO_LARGE');
    return bytes;
  }
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw error('Media exceeds the per-file size limit.', 'ASSET_TOO_LARGE'); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally { reader.releaseLock(); }
}

function detectedExtension(bytes, candidate, responseMime) {
  const preferred = path.extname(candidate.originalName || '').toLowerCase();
  const hinted = [...ASSET_TYPES].find(([extension, mime]) => mime === candidate.expectedMime && !['.txt', '.md', '.bin'].includes(extension))?.[0];
  const order = dedupe([...(raster.includes(preferred) || binaryMedia.includes(preferred) ? [preferred] : []), ...(hinted ? [hinted] : []), ...raster, ...binaryMedia]);
  const extension = order.find(ext => assetBytesMatch(bytes, ext));
  if (['thumbnail', 'preview'].includes(candidate.role)) {
    if (!raster.includes(extension)) throw error('Preview response is not a supported raster image.', 'INVALID_MEDIA');
    return extension;
  }
  if (extension) return extension;
  const expected = String(candidate.expectedMime || '').split(';')[0].trim().toLowerCase();
  const actualMime = String(responseMime || '').split(';')[0].trim().toLowerCase();
  const expectedBinary = [...raster, ...binaryMedia].some(ext => ASSET_TYPES.get(ext) === expected || ASSET_TYPES.get(ext) === actualMime || ext === preferred);
  if (expectedBinary) throw error('Original media bytes do not match the expected file type.', 'INVALID_MEDIA');
  if (['text/plain', 'text/markdown'].includes(expected) && !bytes.includes(0)) return expected === 'text/markdown' ? '.md' : '.txt';
  // Active and unsupported originals remain inert, preserving exact bytes.
  return '.bin';
}

async function atomicFile(filename, bytes) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, filename); }
  finally { await rm(temporary, { force: true }); }
}

async function fetchBytes(url, candidate, options) {
  const fetcher = options.fetch || globalThis.fetch, lookup = options.lookup || dnsLookup;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      let current = await checkedURL(url, lookup);
      for (let redirects = 0; redirects <= 4; redirects++) {
        const response = await fetcher(current.href, {
          method: 'GET', redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer',
          headers: { Accept: candidate.role === 'thumbnail' ? 'image/avif,image/webp,image/*' : '*/*' },
          signal: AbortSignal.timeout(options.timeoutMs || 60000),
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel?.().catch(() => {});
          if (redirects === 4) throw error('Media redirect limit exceeded.', 'REDIRECT_LIMIT');
          const location = response.headers.get('location');
          if (!location) throw error('Media redirect had no destination.', 'INVALID_MEDIA');
          current = await checkedURL(new URL(location, current).href, lookup);
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel?.().catch(() => {});
          throw error(`Media host returned HTTP ${response.status}.`, [502, 503, 504, 408].includes(response.status) ? 'TRANSIENT' : 'HTTP_ERROR', response.status);
        }
        const bytes = await bytesFrom(response, options.maxBytes);
        const extension = detectedExtension(bytes, candidate, response.headers.get('content-type'));
        return { bytes, extension, sha256: sha(bytes), sourceUrl: publicSource(current.href) };
      }
    } catch (failure) {
      const transient = !failure.code || ['NETWORK', 'TRANSIENT'].includes(failure.code);
      if (!transient || attempt === 2) {
        if (failure.code) throw failure;
        throw error('Media download failed after retries.', 'NETWORK');
      }
      options.log?.('Retrying a transient media download failure.');
      await new Promise(resolve => setTimeout(resolve, options.retryDelayMs ?? 200 * 2 ** attempt));
    }
  }
}

/** Download one original, source preview, or thumbnail, with no account credentials. */
export async function downloadAsset(candidate, blockDirectory, options = {}) {
  if (!candidate || !['original', 'thumbnail', 'preview'].includes(candidate.role)) throw error('Unknown media role.', 'INVALID_MEDIA');
  const maxBytes = Math.min(MAX_ASSET_BYTES, Number.isFinite(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : MAX_ASSET_BYTES);
  const urls = dedupe([candidate.url, ...(candidate.role === 'thumbnail' ? candidate.fallbackUrls || [] : [])]);
  if (!urls.length) throw error('No media URL is available.', 'INVALID_MEDIA');
  let result, cacheHit = false, lastFailure;
  for (const url of urls) {
    try { await checkedURL(url, options.lookup || dnsLookup); }
    catch (failure) { lastFailure = failure; if (candidate.role !== 'thumbnail') throw failure; continue; }
    const cacheKey = sha(url);
    if (options.cacheDirectory) {
      try {
        const metadata = JSON.parse(await readFile(path.join(options.cacheDirectory, `${cacheKey}.json`), 'utf8'));
        const bytes = await readFile(path.join(options.cacheDirectory, `${cacheKey}.bytes`));
        const extension = detectedExtension(bytes, candidate, '');
        if (bytes.length <= maxBytes && sha(bytes) === metadata.sha256 && extension === metadata.extension) {
          result = { bytes, extension, sha256: metadata.sha256, sourceUrl: publicSource(url) }; cacheHit = true; break;
        }
      } catch { /* An unavailable or damaged cache never replaces the original request. */ }
    }
    try {
      result = await fetchBytes(url, candidate, { ...options, maxBytes });
      if (options.cacheDirectory) {
        await atomicFile(path.join(options.cacheDirectory, `${cacheKey}.bytes`), result.bytes);
        await atomicFile(path.join(options.cacheDirectory, `${cacheKey}.json`), JSON.stringify({ sha256: result.sha256, extension: result.extension, bytes: result.bytes.length, sourceUrl: result.sourceUrl }));
      }
      break;
    } catch (failure) { lastFailure = failure; if (candidate.role !== 'thumbnail') throw failure; }
  }
  if (!result) throw lastFailure || error('No usable thumbnail is available.', 'INVALID_MEDIA');
  const directory = path.resolve(blockDirectory), assetDirectory = path.join(directory, 'assets');
  await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink()) throw error('Media output cannot be a symbolic link.', 'UNSAFE_PATH');
  await mkdir(assetDirectory, { recursive: true });
  if ((await lstat(assetDirectory)).isSymbolicLink()) throw error('Media output cannot be a symbolic link.', 'UNSAFE_PATH');
  const relative = `assets/${candidate.role}-${result.sha256.slice(0, 24)}${result.extension}`;
  await atomicFile(path.join(directory, relative), result.bytes);
  return {
    status: cacheHit ? 'cached' : 'downloaded',
    asset: { path: relative, mimeType: ASSET_TYPES.get(result.extension), alt: String(candidate.alt || ''), role: candidate.role,
      bytes: result.bytes.length, sha256: result.sha256, sourceUrl: result.sourceUrl, originalName: safeName(candidate.originalName) },
  };
}
