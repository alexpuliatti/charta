# Obsidian Web Clipper adaptation notes

Reviewed the official sources on 2026-11-15. Charta uses the same article extraction and Markdown engine as Obsidian Web Clipper, with its own reader interface and GitHub archive flow.

## Reusable extraction pipeline

Obsidian Web Clipper's current source is version 1.7.1. Its package declares Defuddle `^0.19.2`; its lockfile resolves `0.19.2`. Defuddle's full browser bundle provides both extraction and Markdown conversion. Clipper extracts HTML and metadata, then calls `createMarkdownContent(content, sourceUrl)`. Charta must preserve absolute link and media destinations when archiving content away from its source page.

- [Clipper package](https://github.com/obsidianmd/obsidian-clipper/blob/main/package.json)
- [Clipper dependency lock](https://github.com/obsidianmd/obsidian-clipper/blob/main/package-lock.json#L2236)
- [Clipper extraction and conversion](https://github.com/obsidianmd/obsidian-clipper/blob/main/src/content.ts#L158)
- [Defuddle full bundle](https://github.com/kepano/defuddle/blob/0.19.2/src/index.full.ts)

Clipper's default Markdown template has title, source, author, published, created, description, and tags properties. These properties are assembled separately from the Markdown body. Charta can retain that portable provenance while using its own category, tags, and material metadata.

- [Default template](https://github.com/obsidianmd/obsidian-clipper/blob/main/src/managers/template-manager.ts#L112)

## Reader mode

Clipper displays the extracted title, author, publication date, linked domain, article, and word count. It preserves the article's original extracted HTML before adding reader transformations. Saving in reader mode reparses that preserved content, so reader controls do not enter the saved article.

- [Reader UI and original article preservation](https://github.com/obsidianmd/obsidian-clipper/blob/main/src/utils/reader.ts#L2538)
- [Reader-aware clipping](https://github.com/obsidianmd/obsidian-clipper/blob/main/src/utils/clip-utils.ts)

Charta should keep a single captured draft for preview, editing, and saving. The reader should work before repository setup; GitHub credentials are needed only for repository operations.

## X and Twitter threads

Defuddle's pinned Twitter extractor works with the current document. It collects conversation cells, treats the first tweet as the main post, and joins consecutive same-author replies until a different author appears. Later posts become replies. The extractor does not scroll, expand, or paginate the timeline.

Consequently, this engine alone cannot guarantee a complete long thread: X can unload earlier posts or leave later posts unrendered. A capture should identify its loaded-post scope and retain post permalinks. Collecting and deduplicating snapshots while the user scrolls can retain more posts, but does not prove completeness.

The upstream extractor also replaces links inside tweet text with their displayed labels. A Charta thread adapter can preserve those destinations and per-post attribution explicitly.

- [Pinned Twitter extractor](https://github.com/kepano/defuddle/blob/0.19.2/src/extractors/twitter.ts)

Defuddle's async extraction can use third-party APIs when local content is unavailable, including FxTwitter for X Articles. Local page capture should disable that fallback unless a separate service integration is deliberately offered.

- [Defuddle async fallback documentation](https://github.com/kepano/defuddle#third-party-services)

## Permissions and licensing

Clipper's full extension requests persistent content scripts, broad host access, side panels, clipboard access, and other features. User-invoked Charta extraction can use `activeTab` and local packaged scripts without inheriting all those permissions.

Clipper and Defuddle source code are MIT licensed. Retain the applicable copyright and license notices when redistributing code. Clipper's README excludes Obsidian trademarks, icons, marketing copy, and other branding assets; Charta uses its own branding.

- [Clipper Chrome manifest](https://github.com/obsidianmd/obsidian-clipper/blob/main/src/manifest.chrome.json)
- [Clipper license](https://github.com/obsidianmd/obsidian-clipper/blob/main/LICENSE)
- [Clipper license scope](https://github.com/obsidianmd/obsidian-clipper#license)
- [Defuddle license](https://github.com/kepano/defuddle/blob/0.19.2/LICENSE)
