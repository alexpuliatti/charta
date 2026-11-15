const IMAGE = /\.(?:png|jpe?g|webp|gif|avif)$/i;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function safeRemoteAssetURL(value) {
  let url;
  try { url = new URL(value); } catch { return ''; }
  return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url.href : '';
}

export function previewAsset(block, large = false) {
  const images = (block.assets || []).filter(asset => asset.mimeType?.startsWith('image/') && IMAGE.test(asset.path));
  if (large) return images.find(asset => asset.role === 'original') || images.find(asset => asset.role === 'preview') || images.find(asset => asset.role === 'optimized') || images.find(asset => asset.role !== 'thumbnail') || images[0];
  return images.find(asset => asset.role === 'thumbnail') || images[0];
}

export function pdfAsset(block) {
  const files = (block.assets || []).filter(asset => asset.mimeType === 'application/pdf' && asset.role !== 'thumbnail');
  return files.find(asset => asset.role === 'optimized') || files.find(asset => asset.role === 'original') || files[0];
}

export function assetURL(block, asset, baseURI) {
  if (!asset || typeof asset.path !== 'string' || !asset.path.startsWith('assets/') || asset.path.split('/').some(part => !part || part === '.' || part === '..') || /[\\?#%\u0000-\u001f]/.test(asset.path)) return '';
  const local = block._assetURLs?.[asset.path];
  if (local?.startsWith('blob:')) return local;
  if (asset.remoteUrl) return safeRemoteAssetURL(asset.remoteUrl);
  const base = block.path?.slice(0, block.path.lastIndexOf('/') + 1);
  if (!base?.startsWith('content/blocks/')) return '';
  return new URL(base + asset.path, baseURI).href;
}

/** Convert known provider URLs into fixed player origins, never saved HTML. */
export function safeEmbedURL(value) {
  let url;
  try { url = new URL(value); } catch { return ''; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return '';
  const hostname = url.hostname.toLowerCase();
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be', 'www.youtu.be'].includes(hostname)) {
    const segments = url.pathname.split('/').filter(Boolean);
    const id = hostname.endsWith('youtu.be') ? segments[0] : url.searchParams.get('v') || (['embed', 'shorts', 'live'].includes(segments[0]) ? segments[1] : '');
    return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? `https://www.youtube-nocookie.com/embed/${id}` : '';
  }
  if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(hostname)) {
    const segments = url.pathname.split('/').filter(Boolean);
    const id = segments.findLast(segment => /^\d{1,15}$/.test(segment));
    if (!id) return '';
    const target = new URL(`https://player.vimeo.com/video/${id}`);
    const hash = url.searchParams.get('h') || segments[segments.indexOf(id) + 1];
    if (/^[A-Za-z0-9]{6,64}$/.test(hash || '')) target.searchParams.set('h', hash);
    target.searchParams.set('dnt', '1');
    return target.href;
  }
  return '';
}

export function mediaPlayer(block, baseURI) {
  const mediaAssets = (block.assets || []).filter(asset => asset.mimeType?.startsWith('video/') || asset.mimeType?.startsWith('audio/'));
  const original = mediaAssets.find(asset => asset.role === 'optimized') || mediaAssets.find(asset => asset.role === 'original') || mediaAssets[0];
  if (original) {
    const src = assetURL(block, original, baseURI);
    if (!src) return '';
    const poster = previewAsset(block);
    const posterURL = poster && assetURL(block, poster, baseURI);
    const kind = original.mimeType.startsWith('video/') ? 'video' : 'audio';
    return `<div class="saved-media"><${kind} controls preload="metadata"${kind === 'video' ? ' playsinline' : ''}${kind === 'video' && posterURL ? ` poster="${escape(posterURL)}"` : ''} aria-label="${escape(block.title)}"><source src="${escape(src)}" type="${escape(original.mimeType)}">Your browser cannot play this file. Use the original download below.</${kind}></div>`;
  }
  const embed = safeEmbedURL(block.source?.embedUrl || block.media?.url || (block.type === 'video' ? block.source?.url : ''));
  if (!embed) return '';
  return `<div class="saved-media embed-media"><iframe src="${escape(embed)}" title="${escape(block.title)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation" allow="fullscreen; picture-in-picture" allowfullscreen></iframe></div><p class="media-origin-note">Playback is provided by the original video host. Its thumbnail is kept in your library.</p>`;
}

export function assetDownloads(block, baseURI) {
  const originals = (block.assets || []).filter(asset => asset.role !== 'thumbnail');
  if (!originals.length) return '';
  return `<section class="detail-section"><h3>Saved files</h3><div class="saved-file-list">${originals.map(asset => {
    const url = assetURL(block, asset, baseURI);
    if (!url) return '';
    const name = asset.originalName || asset.path.split('/').at(-1);
    const bytes = Number(asset.bytes);
    const size = Number.isFinite(bytes) && bytes > 0 ? ` · ${bytes < 1048576 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`}` : '';
    const variant = asset.role === 'original' ? 'Original' : asset.role === 'optimized' ? 'Display copy' : 'Saved file';
    const download = `href="${escape(url)}" download="${escape(name)}" data-action="download-asset"`;
    if (asset.mimeType === 'application/pdf') return `<div class="saved-file-row"><a class="saved-file-link" href="${escape(url)}" data-action="open-pdf" data-id="${escape(block.id)}" data-asset="${escape(asset.path)}"><span>${escape(name)}</span><small>Read PDF · ${variant}${size}</small><span aria-hidden="true">↗</span></a><a class="saved-file-download" ${download} aria-label="Download ${escape(name)}" title="Download PDF"><span aria-hidden="true">↓</span></a></div>`;
    return `<a class="saved-file-link" ${download}><span>${escape(name)}</span><small>${variant} · ${escape(asset.mimeType)}${size}</small><span aria-hidden="true">↓</span></a>`;
  }).join('')}</div></section>`;
}
