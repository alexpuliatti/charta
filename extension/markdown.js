// Shared by the extension's download/save flow and the static archive.
export const MAX_CAPTURE_BODY = 500000;
export const MAX_CAPTURE_BYTES = 1500000;

const quote = value => JSON.stringify(String(value));

export function stripFrontmatter(markdown = '') {
  return String(markdown).replace(/^\uFEFF?---\r?\n[\s\S]{0,32000}?\r?\n---(?:\r?\n|$)/, '').trim();
}

export function serializeMarkdown(capture) {
  const article = capture.article || {};
  const extraction = capture.extraction || {};
  const properties = {
    title: capture.title,
    source: capture.url,
    author: article.author,
    published: article.published,
    created: capture.capturedAt,
    description: capture.description || article.description,
    category: capture.category || 'Uncategorized'
  };
  const lines = ['---'];
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined && value !== null && String(value).trim()) lines.push(`${key}: ${quote(value)}`);
  }
  lines.push(`tags: ${JSON.stringify(capture.tags || [])}`);
  if (extraction.kind) lines.push(`capture_kind: ${quote(extraction.kind)}`);
  if (Number.isInteger(extraction.loadedPostCount)) lines.push(`captured_posts: ${extraction.loadedPostCount}`);
  if (extraction.warning) lines.push(`capture_note: ${quote(extraction.warning)}`);
  lines.push('---', '');
  const title = String(capture.title || '').replace(/\s+/g, ' ').trim().replace(/[\\`*_{}[\]<>#!|]/g, '\\$&');
  const body = String(capture.body || '').trim();
  const firstHeading = body.match(/^#\s+([^\n]+)(?:\n|$)/)?.[1]?.trim();
  if (title && firstHeading !== title) lines.push(`# ${title}`, '');
  lines.push(body, '');
  return lines.join('\n');
}
