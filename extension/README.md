# Charta Chrome extension draft

Read articles and threads, then save clean Markdown directly into a Charta repository. This is an unpacked Manifest V3 extension with bundled extraction/rendering libraries and no remote executable code.

## Install in Chrome

1. Publish the Charta project, including `content/`, to your own GitHub repository.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this `extension/` directory. If using the download from the website, unzip it first and select its extension directory.
3. Pin Charta to the toolbar. Open an ordinary webpage and click Charta.
4. Enter your GitHub owner, repository, and branch in Settings.
5. Create a fine-grained GitHub personal access token limited to that repository with **Contents: read and write**. Paste it into Settings and connect. Do not add workflow permissions.

Tokens are kept only in extension session memory. Reconnect after restarting Chrome or reloading the extension. The website and content scripts never receive the token. Repository settings, captured drafts, and failed saves are kept locally in extension storage and are never synced through Chrome.

## Capture

Click Charta on a webpage, or select text and choose **Save selection to Charta** from the context menu. Choose a category, add one or more comma-separated tags, pick a collection, and save. You can also edit the title or add a note. The activation shortcut is `Alt + Shift + J`; change it in Chrome extension keyboard shortcuts. `Command/Ctrl + Enter` saves from the popup.

Categories and tags are stored on the canonical material. Tags ignore case and extra spacing, and repeated names become one tag. A material accepts up to 20 tags of 48 characters each and a category of up to 80 characters. Shared taxonomy makes connections visible in Charta's network graph. Older pending captures without taxonomy open as **Uncategorized** with an empty tag field; add tags before saving. Retrying a capture that already reached GitHub never overwrites its existing record.

The extension stores a canonical material under `content/blocks/b_<operation-id>/` and adds its ID to the collection’s ordered `items`. Captured text keeps its source URL. The collection and new material are written in one Git commit. The popup reports **saved to GitHub**; GitHub Pages publication occurs afterward through the repository workflow.

When the branch changes during a save, the extension reloads current files and retries without forcing the branch. Retryable operations retain the same ID, so reopening after an interrupted save does not create duplicate material. Failed captures remain in the popup’s waiting list. Different captures of the same URL are currently separate materials.

## Reader mode and Markdown

Choose **Reader mode** in the popup, or right-click an article and choose **Read and clip to Charta**. A new extension tab shows a clean reading view. The **Markdown** tab lets you edit the extracted text before saving. Selecting text on the source page clips that rich selection instead of the full article.

Set title, category, comma-separated tags, optional note, and destination collection. **Save to GitHub** commits `block.json`, a standalone `body.md`, and collection membership atomically. The Markdown includes quoted YAML properties for title, source, author, published/captured dates, category, tags, and thread scope where applicable. **Download Markdown** produces the same file and works without connecting GitHub. Charta's archive renders saved Markdown and offers its original source and download.

The article extractor is [Defuddle 0.19.2](https://github.com/kepano/defuddle), the pinned engine used by [Obsidian Clipper](https://github.com/obsidianmd/obsidian-clipper). It runs against the current page locally. Charta does not use third-party extraction APIs. Scripts, styles, forms, frames, and unsafe URLs are excluded from the reading view. Images and linked videos remain source references; this mode does not download article attachments or bypass access restrictions. Attribution and bundled dependency licenses are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and `vendor/`.

On X/Twitter, Charta gathers the contiguous loaded posts by the thread author, retaining per-post links, dates, text formatting, images, and video links. **Load more posts** scrolls the original source page in a bounded pass and retains observed posts across X's virtualized rendering. It stops at other authors/recommendations, captures at most 200 posts, and always displays a partial-capture notice. Expand any **Show more** text on X, then refresh. A loaded-post capture cannot prove the entire thread has been saved.

Drafts persist in trusted extension storage across reader-tab closure and service worker restarts. Reader refresh protects edited Markdown with a confirmation before replacing it. A source tab that has navigated or closed must be opened and captured again. Completed clips are kept as read-only receipts; a new capture makes a new material.

## Draft limits

- Links, articles, rich selections, and loaded X threads are supported. Files, image downloads, screenshots, new collections, and page-to-extension editing controls will follow.
- Basic link capture keeps up to 30,000 characters. Reader mode supports up to 500,000 Markdown characters / 1.5 MB UTF-8; oversized captures fail with a visible error. It preserves article structure rather than a complete interactive webpage.
- Chrome internal pages cannot be captured. Pages that prohibit scripting can still be saved as links when their URL is accessible.
- The destination repository must already contain version 1 Charta collections. The extension reads current repository files instead of a potentially older deployed catalog.
- The current tree reader rejects GitHub’s truncated tree responses rather than silently omitting collections. Large libraries will need a paginated tree reader.
- Direct commits must be allowed on the configured branch. The token’s repository access cannot be limited to the `content/` folder; the extension itself restricts writes to that folder.
- An existing material created by an interrupted operation is reused without overwriting it. Edit that material in the library rather than changing the capture after its commit succeeded.

## Tests

Run `npm ci`, then `node --test extension/tests/*.test.mjs` from the project root. Tests exercise the real vendored extractor and sanitizer against article, selection, malicious Markdown, and virtualized thread fixtures; mocked Chrome/GitHub tests verify trusted senders, durable drafts, atomic saves, retries, and idempotency. They do not post to a live repository or require a live X account.

Platform references: [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage), [GitHub trees](https://docs.github.com/en/rest/git/trees), [GitHub references](https://docs.github.com/en/rest/git/refs).
