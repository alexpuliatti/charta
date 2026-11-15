import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeMarkdown, stripFrontmatter } from '../shared/clip-markdown.mjs';
import { summaryInput } from '../scripts/summarize.mjs';

const capture = {
  title: 'A useful article', url: 'https://example.com/article', capturedAt: '2026-11-15T10:00:00Z',
  category: 'Design', tags: ['interfaces', 'research'], description: 'Worth keeping.',
  article: { author: 'Ada', published: '2026-11-14' },
  body: '## The idea\n\nKeep **formatting** and [sources](https://example.com/reference).',
  extraction: { kind: 'article' }
};

test('a downloaded clip is standalone Markdown with safely quoted provenance and taxonomy', () => {
  const result = serializeMarkdown(capture);
  assert.match(result, /^---\ntitle: "A useful article"\nsource: "https:\/\/example.com\/article"/);
  assert.match(result, /author: "Ada"\npublished: "2026-11-14"/);
  assert.match(result, /tags: \["interfaces","research"\]/);
  assert.equal(stripFrontmatter(result), '# A useful article\n\n' + capture.body);
  assert.match(result, /\*\*formatting\*\*/);
  assert.equal(serializeMarkdown({ ...capture, body: '# A useful article\n\nText' }).match(/^# A useful article$/gm).length, 1);
});

test('multiline metadata cannot inject YAML properties and thread scope survives export', () => {
  const result = serializeMarkdown({ ...capture, title: 'Title\nunsafe: value', article: { author: 'A "quoted" author' }, extraction: { kind: 'thread', loadedPostCount: 12, warning: 'Loaded posts only.\nReview gaps.' } });
  assert.match(result, /title: "Title\\nunsafe: value"/);
  assert.doesNotMatch(result, /^unsafe:/m);
  assert.match(result, /author: "A \\"quoted\\" author"/);
  assert.match(result, /captured_posts: 12/);
  assert.match(result, /capture_note: "Loaded posts only.\\nReview gaps."/);
});

test('AI article input uses the article text rather than YAML archive properties', () => {
  const input = summaryInput({ title: capture.title, source: { url: capture.url }, contentFormat: 'markdown', body: serializeMarkdown(capture) });
  assert.equal(input.capturedText, '# A useful article\n\n' + capture.body);
  assert.doesNotMatch(input.capturedText, /tags:|created:|category:/);
});
