// Markdown is untrusted page content. Keep the parser and sanitizer bundled locally.
const TAGS = ['a', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'del', 's', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub', 'kbd', 'input'];
const ATTRIBUTES = ['href', 'src', 'alt', 'title', 'start', 'reversed', 'colspan', 'rowspan', 'scope', 'type', 'checked', 'disabled'];

export function safeReaderUrl(value, baseUrl = '', { image = false } = {}) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = baseUrl ? new URL(value, baseUrl) : new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    // SVGs can carry active content; an archive preview only needs ordinary images.
    if (image && /\.svg(?:$|[?#])/i.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

/** Render into a detached fragment before placing anything from a page in the DOM. */
export function renderMarkdown(markdown, target, { baseUrl = '', parser = globalThis.marked, sanitizer = globalThis.DOMPurify } = {}) {
  if (!target?.ownerDocument) throw new Error('The reading surface is unavailable.');
  if (!parser?.parse || !sanitizer?.sanitize) throw new Error('The bundled Markdown reader could not load. You can still edit and download the Markdown.');
  const html = parser.parse(String(markdown ?? ''), { async: false, gfm: true, breaks: false });
  const fragment = sanitizer.sanitize(html, {
    ALLOWED_TAGS: TAGS,
    ALLOWED_ATTR: ATTRIBUTES,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    FORBID_TAGS: ['script', 'style', 'svg', 'math', 'iframe', 'object', 'embed', 'form', 'video', 'audio', 'source'],
    RETURN_DOM_FRAGMENT: true,
    SANITIZE_NAMED_PROPS: true
  });
  for (const link of fragment.querySelectorAll('a')) {
    const href = safeReaderUrl(link.getAttribute('href'), baseUrl);
    if (!href) link.removeAttribute('href');
    else {
      link.setAttribute('href', href);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      link.setAttribute('referrerpolicy', 'no-referrer');
    }
  }
  for (const image of fragment.querySelectorAll('img')) {
    const src = safeReaderUrl(image.getAttribute('src'), baseUrl, { image: true });
    if (!src) {
      const fallback = target.ownerDocument.createElement('span');
      fallback.className = 'blocked-image';
      fallback.textContent = image.getAttribute('alt') ? `[Image: ${image.getAttribute('alt')}]` : '[Image unavailable]';
      image.replaceWith(fallback);
      continue;
    }
    image.setAttribute('src', src);
    image.setAttribute('loading', 'lazy');
    image.setAttribute('decoding', 'async');
    image.setAttribute('referrerpolicy', 'no-referrer');
  }
  for (const input of fragment.querySelectorAll('input')) {
    if (input.getAttribute('type') !== 'checkbox') input.remove();
    else input.setAttribute('disabled', '');
  }
  target.replaceChildren(fragment);
  return target;
}
