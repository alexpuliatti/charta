export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_RESOURCE_TEXT = 500000;
const formats = [
  ['png', 'image/png', 'image'], ['jpg', 'image/jpeg', 'image'], ['webp', 'image/webp', 'image'], ['gif', 'image/gif', 'image'], ['avif', 'image/avif', 'image'],
  ['pdf', 'application/pdf', 'file'], ['mp4', 'video/mp4', 'video'], ['mov', 'video/quicktime', 'video'], ['webm', 'video/webm', 'video'],
  ['mp3', 'audio/mpeg', 'audio'], ['m4a', 'audio/mp4', 'audio'], ['ogg', 'audio/ogg', 'audio'], ['wav', 'audio/wav', 'audio'],
  ['txt', 'text/plain', 'text'], ['md', 'text/markdown', 'text'], ['bin', 'application/octet-stream', 'file']
];
const starts = (bytes, signature, offset = 0) => signature.every((byte, index) => bytes[offset + index] === byte);
const ascii = (bytes, start = 0, end = bytes.length) => String.fromCharCode(...bytes.subarray(start, end));

export function bytesFromBase64(value) {
  if (typeof value !== 'string' || value.length % 4 || value.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('The uploaded file is invalid or exceeds 50 MB.');
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('Choose a file smaller than 50 MB.');
  return bytes;
}

export function base64FromBytes(bytes) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) text += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(text);
}

export function detectUpload(bytes, name = '', declaredType = '') {
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('The selected file is empty.');
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('Choose a file smaller than 50 MB.');
  let extension = 'bin';
  const head = ascii(bytes, 0, Math.min(bytes.length, 256));
  if (starts(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) extension = 'png';
  else if (starts(bytes, [255, 216, 255])) extension = 'jpg';
  else if (/^GIF8[79]a/.test(head)) extension = 'gif';
  else if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') extension = 'webp';
  else if (head.startsWith('%PDF-')) extension = 'pdf';
  else if (head.slice(4, 8) === 'ftyp') {
    const brands = head.slice(8, 12) + head.slice(16);
    extension = /avif|avis/.test(brands) ? 'avif' : /qt  /.test(brands) ? 'mov' : /M4A /.test(brands) ? 'm4a' : /isom|iso[2-9]|mp4[12]|avc1|M4V |dash|MSNV/.test(brands) ? 'mp4' : 'bin';
  } else if (starts(bytes, [26, 69, 223, 163]) && head.includes('webm')) extension = 'webm';
  else if (head.startsWith('ID3') || (bytes.length >= 4 && bytes[0] === 255 && (bytes[1] & 224) === 224 && (bytes[1] & 6) !== 0 && (bytes[2] & 240) !== 240)) extension = 'mp3';
  else if (head.startsWith('OggS') && bytes.length >= 27) extension = 'ogg';
  else if (head.startsWith('RIFF') && head.slice(8, 12) === 'WAVE') extension = 'wav';
  else if (/\.(?:txt|md|markdown|csv)$/i.test(name) && !bytes.includes(0)) extension = /\.(?:md|markdown)$/i.test(name) ? 'md' : 'txt';
  const format = formats.find(([ext]) => ext === extension);
  if (extension === 'bin' && /^(?:image|video|audio)\//.test(declaredType) && !/svg/i.test(declaredType)) throw new Error('The file contents do not match its media type.');
  return { extension, mimeType: format[1], type: format[2] };
}

export function validatedAttachments(files = []) {
  if (!Array.isArray(files) || files.length > 2) throw new Error('Add one original file and an optional preview per resource.');
  let total = 0;
  const roles = new Set();
  return files.map(file => {
    const bytes = bytesFromBase64(file.data);
    total += bytes.length;
    if (total > MAX_UPLOAD_BYTES) throw new Error('The resource and its preview must be smaller than 50 MB.');
    const originalName = String(file.name || file.originalName || 'Uploaded file').replace(/[\u0000-\u001f/\\]/g, '-').slice(0, 240);
    const format = detectUpload(bytes, originalName, file.type || file.mimeType || '');
    const role = file.role === 'thumbnail' ? 'thumbnail' : 'original';
    if (roles.has(role) || (role === 'thumbnail' && format.type !== 'image')) throw new Error('The resource preview must be a single image.');
    roles.add(role);
    return { bytes, data: file.data, type: format.type, asset: {
      path: `assets/${role}.${format.extension}`, mimeType: format.mimeType, role, originalName, bytes: bytes.length,
      ...(typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256) ? { sha256: file.sha256 } : {})
    } };
  });
}

export const mutationBytes = entry => entry.encoding === 'base64' ? bytesFromBase64(entry.content) : new TextEncoder().encode(entry.content);
