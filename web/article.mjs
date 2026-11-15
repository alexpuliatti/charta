import { stripFrontmatter } from './shared/clip-markdown.mjs';
import { renderMarkdown } from './reader-render.mjs';

export function renderSavedArticle(block, target) {
  const document = target.ownerDocument;
  target.replaceChildren();
  const metadata = document.createElement('p');
  metadata.className = 'article-byline';
  metadata.textContent = [block.article?.author, block.article?.published].filter(Boolean).join(' · ');
  if (metadata.textContent) target.append(metadata);
  if (block.capture?.warning) {
    const warning = document.createElement('p');
    warning.className = 'article-warning';
    warning.textContent = block.capture.warning;
    target.append(warning);
  }
  const body = document.createElement('div');
  body.className = 'article-body';
  try { renderMarkdown(stripFrontmatter(block.body), body, { baseUrl: block.source?.url }); }
  catch {
    const raw = document.createElement('pre');
    raw.textContent = stripFrontmatter(block.body);
    body.append(raw);
  }
  // The material's title is already displayed above the saved article.
  if (body.firstElementChild?.tagName === 'H1' && body.firstElementChild.textContent.trim() === block.title.trim()) body.firstElementChild.remove();
  target.append(body);
  const details = document.createElement('details');
  details.className = 'article-markdown';
  const summary = document.createElement('summary');
  summary.textContent = 'View Markdown';
  const source = document.createElement('pre');
  source.textContent = block.body;
  details.append(summary, source);
  target.append(details);
  const button = document.createElement('button');
  button.className = 'text-button article-download';
  button.textContent = 'Download Markdown ↓';
  button.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([block.body], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = (block.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 100) || 'charta-article') + '.md';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  target.append(button);
}
