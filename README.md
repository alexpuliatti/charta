# Charta

A small, open source library for links, notes, and things worth keeping. Inspired by Are.na, with real folders and content you own. This is the first working draft.

## Run the draft

Requires Node.js 22.13 or later. The static site and extension run from bundled local assets. `npm ci` installs the build and test dependencies, including React and React DOM for the official React Bits components used in Connections.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:4173** in Chrome. Adding materials, writing notes, editing summaries, and creating folders or collections writes directly to this project's `content/` directory. The server listens only on your computer. Stop it with Ctrl+C. Refresh after changing content files externally; restart the server to rebuild changed website code.

The library contains 1,017 materials, including the 1,016 reorganized Are.na imports and the newly saved Age1 portfolio, organized into nine thematic sections with 53 material folders. Companies has six parent groups with 21 sector subfolders, including neurotech and biotech startups, deep tech funds, and creative tech studios. Original collection lists and external Are.na channel links are retained in the import history; the live browser contains the reorganized folders. Imported materials retain their original rights and attribution; the MIT software license does not relicense them.

## What works

- A minimal home with search and a compact dashboard. Browse the full library from **All materials** in the sidebar; material cards and browse controls stay off the homepage.
- Artefacts open larger in a centered liquid-glass popup. The initial view shows the artefact; use the **+** button to reveal tags, notes, summaries, folders, and file actions. Close with Escape, the close button, or a click outside.
- **Explore** opens a full-width masonry gallery. Browse every resource or a folder and its subfolders, search, filter, and sort without losing your place. Click a resource to open its glass popup; images fit the available screen, and PDFs, video, audio, saved articles, and notes use the same viewer. Use the arrow keys to move between resources; closing the popup preserves your gallery position.
- Full previews use original images or high-resolution saved screenshots. Imported screenshots are compressed to WebP with a 2,560-pixel maximum edge, favoring lossless encoding for crisp screenshots. New pasted/uploaded still images are optimized before saving; smaller existing encodings and animations are preserved.
- **Add resource** accepts links, pasted text/images, dropped files, PDFs, Word documents, images, and video. It detects the type, analyzes available content, selects or creates a folder, saves the original, and confirms the location with **Open resource** and **Change folder** actions. Duplicate URLs, identical originals, and retries reuse the saved resource.
- A folder browser in **Collections**: open main folders, drill into subfolders, and follow breadcrumbs back up. Empty folders are hidden by default and can be shown from **…**. External Are.na references appear as linked sources instead of empty folder cards. New folders inherit the current location, and their edits use the same automatic save flow.
- Minimal collection pages with filters, sorting, grid/list views, editing, and **Explore connections** in the **…** menu.
- Right-click materials, collections, or sidebar folders to rename, edit, remove connections, or delete. Material and collection **…** buttons open the same menus; keyboard users can press Shift+F10 or the Menu key. Removing a membership keeps the material in the library, deleting a collection keeps its materials, and only empty folders can be deleted.
- New saves go to **All materials** unless you choose a collection. There is no required Inbox or default collection.
- Connect GitHub in library settings to commit every website edit directly to your repository, with visible save status and conflict handling.
- Categories and tags on every imported material, with editable fields in the website and Chrome extension. New saves require a category and at least one tag.
- Search across titles, notes, saved text, summaries, categories, tags, and collection descriptions. Press `⌘/Ctrl K` or `/` to search; `N` adds a material.
- **Connections** starts with a reading and shows its strongest explained relationships in a focused map or list. Search the complete reading library, preview a connection, explore from it, and return along your trail. Media remains outside this view.
- **Canvas** is a freeform workspace for notes and library references, with multiple saved boards, movable/resizable cards, labeled connections, image drop/paste/upload, pan/zoom, undo/redo, and AI expansions you can review and add as connected notes.
- **Discover** compares all 1,017 entries using locally generated CLIP visual embeddings and MiniLM text embeddings. Start with any material or choose **Similar** in its detail view. Browsing requires no API key or model download.
- Short, artifact-based titles; larger caption-free image previews; compact article and tweet titles. Original titles and extracted image text remain searchable.
- Writing, Graphic design, Interface design, Companies, Architecture, Objects, Sound, Technology, and Culture; 17 explained reading suggestions connect related articles and PDFs.
- Save links and text notes; edit titles, notes, captured text, and manual summaries.
- Browse archived images, PDFs, and video files, with local thumbnails, optimized viewing copies, and original downloads. PDFs open in Charta’s custom reader with selectable text, search, page and zoom controls, paper themes, contents, highlights, margin notes, and a notebook. Notes on highlighted passages sit beside the document with fine connectors that track scrolling and zoom, including with the notebook open. Narrow readers use numbered markers that open the matching note. Known YouTube/Vimeo sources use safe embedded players.
- Reuse a canonical material across several collections, remove memberships, link collections, and move collections between folders.
- File-backed local editing, Chrome connected-folder editing, and content ZIP export.
- An unpacked Chrome extension with article and thread reader mode, editable Markdown, local downloads, and retryable atomic GitHub saves.
- Optional AI summaries in GitHub Actions, with manual-summary preservation and a per-run limit.
- A portable static build and GitHub Pages workflow.

Taking screenshots automatically, moving folders, drag reordering, and the website-to-extension editing bridge are not implemented yet. Screenshots can be pasted or uploaded through Add resource. The extension captures links, selections, articles, and loaded X threads into existing collections. It reports a successful GitHub commit; it does not verify deployment status.

The Charta rebrand preserves existing browser drafts, GitHub destinations, sidebar preferences, and canonical content IDs. Older `JELLY_PUBLISH` build settings remain supported.

Motion uses short, interruptible transitions for dialogs, drawers, menus, page changes, and sidebar layout. Keyboard actions remain immediate, and reduced-motion preferences are respected. Menus share glass surfaces, grouped icon rows, a sliding selection highlight, and shorter exits. View menus fit above or below their trigger. Native dropdowns receive the same styling and motion in browsers supporting customizable selects, with standard controls elsewhere. The folded-C logo is provided as SVG and PNG assets under `web/assets/`.

Charta adapts the React Bits micro interactions to existing controls: Glide Select for filters, Rubber Segment for view switches, Prompt Bar for Add resource, Warm Tooltip for toolbar hints, Wake Slider for canvas zoom, and Branched Menu for folder paths. Shredder feedback is limited to discarding pending attachments. See [source references and license](web/vendor/REACT-BITS-NOTICE.md).

## Your content

### Add resource

Use **Add resource** on the homepage. Paste a URL or text, paste an image from the clipboard, or choose/drop one file. Originals and optional video previews are limited to 50 MiB together. PDF, DOCX, plain text, and Markdown documents expose readable text for classification. Images and video previews can use the local CLIP model; MiniLM compares text with saved resources when content rules do not find a clear destination. Video analysis represents a still, not the complete motion or soundtrack. Scanned PDFs without a text layer keep the complete original and report the extraction limit.

The local `npm run dev` service reads public web pages and documents and performs local inference. It does not execute source scripts or send uploaded content to an AI provider. Existing model files under `/tmp/jelly-embeddings-runtime` are detected automatically. For another installation, set `CHARTA_MODEL_RUNTIME` to the pinned Transformers.js module, `CHARTA_CLIP_MODEL` to the CLIP directory, and `CHARTA_TEXT_MODEL` to the MiniLM directory before starting the server. See [model preparation](docs/embeddings.md). Readable content and folder vocabulary remain available without models; uncertain resources stay in All materials and can be moved from the receipt.

Repository and connected-folder saves persist exact file bytes. GitHub saves upload binary blobs and commit the original, metadata, and memberships together. Browser drafts retain small originals in browser storage and include them in ZIP exports; browser storage limits may require connecting a folder or GitHub for larger uploads. Static hosting can read cross-origin pages only when the source allows it. Otherwise, the resource is saved using available link/file details and the receipt explains the limitation. Full page/document/image analysis uses the local service.

The first live test saved [Age1’s portfolio](https://age1.com/portfolio) under **Companies → VC funds → Biotech funds**, creating the subfolder automatically. Individual portfolio companies were not imported.

### Search and Ask archive

The search bar has two modes. **Search** combines keyword matches (including folder names, OCR, and complete extracted documents) with local MiniLM embeddings. Keywords appear immediately; meaning matches follow. Without the local service or model files it clearly falls back to keyword search.

**Ask archive** opens a dedicated **Research** workspace with a permanent sidebar entry and question history. Questions, completed answers, source excerpts, and unfinished drafts are saved automatically in this browser. Research keeps running when you navigate elsewhere; return through Research or open any previous question directly. Opening a source and closing its preview returns to the answer. Refreshing during a request preserves the question and offers an explicit retry. It retrieves relevant saved resources and uses your ChatGPT subscription to explain which ones are useful. While waiting, a softly glowing React Bits Orb appears beside the status and Cancel button. It respects reduced motion, stops when the request ends or you leave the view, and falls back to a static ring without WebGL. Answers include reasons, exact saved source excerpts, and additional retrieved matches. Saved dates are not treated as publication dates; gaps in evidence for questions about recent events are stated explicitly.

Run `npm run dev` with the OpenAI Codex CLI installed and signed in using `codex login` → **Sign in with ChatGPT**. `codex login status` should say `Logged in using ChatGPT`. No API key is needed. This mode uses the existing subscription allowance and never falls back to API billing. Set `CHARTA_CODEX_BIN` if the CLI is outside the server's PATH. See [OpenAI authentication documentation](https://learn.chatgpt.com/docs/auth#sign-in-with-chatgpt).

Only submitting a question invokes ChatGPT. The question and a bounded selection of saved excerpts are sent to OpenAI. Each request uses a fresh, temporary, read-only Codex session with user configuration, shell, browser, and connected-app tools disabled. It cannot edit the archive. Cancel stops only the selected request and keeps its question. New questions preserve previous answers. Research history stays in this browser and is not included in library exports. This feature runs through the local server; a static GitHub Pages build cannot access your computer's ChatGPT sign-in.

```text
content/
  library.json
  collections/
    writing/
      folder.json
      design/
        collection.json
    companies/
      folder.json
      startups/
        folder.json
        neurotech/
          collection.json
  blocks/
    b_arena_47700997/
      block.json
      body.md
      summary.json
      assets/
  imports/
    arena/
      source.json
    curation/
      retired-collections.json
```

Each material has one stable ID and one canonical directory. Collection files contain ordered references, so material can belong to many collections without duplication. Folder nesting follows real directories; collection connections form a separate network. The build generates a catalog from these files.

## Categories, tags, and Connections

Materials store their classification in `block.json`, alongside the source:

```json
{
  "category": "Design",
  "tags": ["interfaces", "typography", "personal-web"],
  "related": ["b_arena_47700997"]
}
```

A category is a broad subject; tags describe overlapping ideas. Tags are normalized to lowercase, deduplicated, and entered as comma-separated labels. Categories support up to 80 characters; each material can have up to 20 tags of at most 48 characters. Historical records without classification remain readable as `Uncategorized` with no invented tags.

Open **Connections** in the sidebar to choose a recent reading or search the complete text/link library. Use **Explore connections** from a link or note to start directly from it. Articles, threads, and notes are eligible; images, videos, audio, and files remain in the archive. A link with a thumbnail remains eligible.

The focused map and equivalent list begin with the strongest eight connections, using readable titles and visible reasons. Select a neighbour to preview it, open the original material, or choose **Explore from here** to continue. **Back** returns to the previous reading with its view and selection intact. **Show more connections** expands the current results deliberately. The focused reading, category/tag/collection filters, search, and list/map choice are reflected in a shareable `#/graph/<reading-id>` URL; opening a material and closing it returns to the same connection view.

The results render the actual React Bits **Animated List** component, and Map renders its **Branched Menu**, including the original folding and branch-selection behavior. Their source and CSS are installed under `web/vendor/react-bits/` from the official registry. The React runtime loads when Connections opens, and runs entirely from local bundled assets. `npm run build:components` rebuilds those assets; `npm run check` verifies both their freshness and the upstream source hashes. See [component provenance and license](web/vendor/REACT-BITS-NOTICE.md).

Connections are ranked across the complete library before a display limit is applied: authored direct links first, reviewed reading suggestions next, and shared tags after that. Specific tags carry more weight than common tags, and multiple shared tags improve a match. Categories and collection membership provide filters and supporting context; neither creates a relationship by itself. Every result preserves its actual provenance, rather than inventing a topic explanation. Direct links are edited under **Direct links to other materials** in the material editor. Reviewed suggestions retain their separate labels and reasons. Embedding similarities remain in **Discover**.

The charcoal homepage centers the dashboard in the available workspace, with a compact search surface, recent collections, and a 26-week activity heatmap calculated from saved materials' creation dates. A tapered brand accent, hover underlines, and a small orbital illustration add detail without a background color field. The homepage and header search fields are directly editable, with results in a dropdown below the active field once you type. Search adapts React Bits' Spotlight Card and Prompt Bar patterns; its dropdown uses compact icon rows and a sliding selection inspired by Animated List and Glide Select. Arrow keys navigate results and Enter opens the selection while the input stays focused. Warm Tooltip hints delay the first hover and show adjacent hints immediately. Cards stack on smaller screens. The sidebar button switches between a full menu and an icon rail on desktop, and opens a translucent drawer on small screens. Desktop collapse is remembered on this browser. Gradient line, divider, border, and underline styles adapt [Gradient Components](https://github.com/alexpuliatti/gradient-components); see the [design references and attribution](docs/design-references.md).

Connection browsing is derived from canonical records when opened and does not modify them. Categories, tags, direct links, and reviewed suggestions survive local saves, Chrome extension capture, content export, and GitHub Pages builds. Keyboard users can search, choose readings, preview connections, switch views, and follow the same navigation trail without dragging a diagram.

Read the [curation report](docs/content-curation.md) for the reorganization and source limits, and [embedding maintenance](docs/embeddings.md) to regenerate vectors after new saves.

## Editing modes

There are four editing modes:

| Mode | Where edits go |
| --- | --- |
| `npm run dev` | Directly into this repository's `content/` files |
| Static website | A browser-local draft; export it from library settings to keep canonical files |
| Connect local folder in desktop Chrome | Directly into the selected Charta project's `content/` files; commit and push them separately |
| Connect GitHub in library settings | Each edit becomes an atomic commit on your configured branch; Pages publishes afterward |

To enable automatic repository saves, open **Settings → Connect GitHub**, enter the owner, repository and branch, and use a fine-grained token restricted to that repository with **Contents: read and write**. Connecting loads the branch's current canonical library; export any browser drafts or uncommitted local work you want to keep first. This switches the website to editing GitHub; it does not commit or synchronize a separate local checkout. The token stays only in page memory and is discarded on reload or disconnect. Destination preferences are remembered, and Charta requires reconnection before accepting further edits after a reload.

GitHub saves update all affected content files in one commit and advance the branch without forcing it. Independent concurrent changes are preserved; conflicting edits leave the form open with an error. The local development server uses the same conflict checks for edits from multiple tabs. The header reports **Saving to GitHub**, **Saved to GitHub**, or **Save failed**, and settings link to the last confirmed commit. The branch must allow direct content commits. A confirmed commit does not verify that the Pages deployment has finished. Original asset URLs use the repository's immutable raw URLs, so remote media requires publicly readable originals.

The Chrome extension has its own GitHub connection. Without a website GitHub connection, static browser drafts remain local and are not automatically committed. Export before resetting a browser draft or connecting a different folder.

## Publish on GitHub Pages

1. Put this project in a GitHub repository with a `main` branch. If using another publishing branch, update `.github/workflows/pages.yml`.
2. In **Settings → Pages → Build and deployment**, choose **GitHub Actions**.
3. Run **Publish Charta** from the Actions tab for a manual deployment. To publish automatically on pushes to `main`, add the repository Actions variable `CHARTA_PUBLISH_PAGES` with the value `true`.

Checks run on pushes to `main` and pull requests, including isolated local save checks. Publishing is opt-in: creating or pushing a repository does not enable Pages. The publishing workflow checks the project, optionally summarizes, builds `dist/`, and deploys it. All asset links and hash routes work below a repository URL prefix. Ordinary GitHub Pages publication is public, including content files. There is no public write API, server, or runtime database.

The Pages workflow sets `CHARTA_PUBLISH=1`. It includes thumbnails and optimized copies in the Pages artifact, while original downloads use immutable URLs from the same public GitHub repository. All original files must be committed under `content/`; no separate storage service is needed. GitHub Actions supplies the repository and commit automatically. A normal local build still includes the full archive. This keeps the Pages artifact below the site limit while preserving originals in GitHub.

PDF reading uses a locally vendored Mozilla PDF.js renderer and worker, loaded only when a PDF opens. It renders a bounded set of pages with selectable text and document search. All renderer assets, fonts, and image decoders ship with the archive; no CDN is needed. Run `npm run vendor:pdf` after changing the pinned `pdfjs-dist` package version.

Highlights use normalized page coordinates so they follow zoom changes. Document notes, highlighted passages, and comments save in the material’s `pdfReading` metadata, separately for each attached PDF. Saves check a revision to prevent overwriting notes changed elsewhere. Unsaved edits have session recovery and can be exported from the notebook. Reading position, zoom, and paper theme are device preferences kept in browser storage. Original PDF bytes remain unchanged. Scanned pages still render, but selecting and searching text requires a PDF text layer.

For other static hosts:

```sh
npm run build
```

Upload the contents of `dist/`. On Windows, building the optional extension ZIP requires a `zip` executable; the extension can still be loaded directly from `extension/`.

## Chrome extension

See the [extension setup guide](extension/README.md), or download its ZIP from library settings after building. Load `extension/` as an unpacked extension in Chrome, then connect a fine-grained token limited to your one repository with **Contents: read and write**. The repository must contain Charta's content format and allow direct commits on the configured branch.

The token stays in extension session storage and is cleared on browser restart. Pending captures stay in the extension's local queue. No GitHub or AI credentials are shipped to the website.

Choose **Reader mode** in the popup, or right-click a page and choose **Read and clip to Charta**. It uses Defuddle, the same article extraction engine as Obsidian Clipper, with a minimal Charta reading view. Review or edit Markdown, assign category/tags, and save to a collection. **Download Markdown** works without a GitHub connection. Saved `body.md` files contain YAML frontmatter, title, formatted text, links, and image references; the archive displays them as sanitized articles. X threads show captured post count and per-post links, with an optional **Load more posts** action that scrolls the source tab. Only observed posts are captured; completeness is never assumed. See [reader implementation notes](docs/clipper-research.md).

## Canvas

Open **Canvas** in the sidebar and create a named board. Add notes from the toolbar or double-click empty space. Use **Library** to place an existing image, note, link, or other resource. Drop or paste images into the canvas, or choose **Image** to upload them; originals are saved to the library and cards reference them. Pasted plain text becomes a note.

Drag cards to arrange them and use their lower-right handles to resize. Drag empty space or scroll to pan; use ⌘/Ctrl + scroll or the zoom controls to zoom. **Fit all cards** brings the whole board into view. Select a card to edit its note in the inspector. Use its connection button, then choose another card to link them. Select a connection to label or remove it. Removing a card keeps the original library resource.

Keyboard controls include arrow keys to move the focused card, arrow keys on a resize handle to resize, Shift for larger steps, Enter to edit, N for a new note, Delete/Backspace to remove a selected card/connection, and ⌘/Ctrl Z / Shift Z to undo/redo. Text fields retain native editing shortcuts. Escape cancels connecting and clears selection.

Boards save automatically through the current editing mode (repository, connected folder, GitHub, or browser draft). Layouts, inline notes, authored links, colors, and viewport live in `content/library.json` under `canvases` and are included in content ZIP exports and static builds. Revisions prevent a stale board from overwriting changes from another tab or device. Failed saves keep the working board open with a retry action and a session recovery copy. **Export canvas** downloads a JSON snapshot of the current layout, including unsaved edits and material references; this is a layout backup, not an image bundle or an import format. Library settings export includes original files. Each library supports up to 50 boards, each with 200 cards and 600 connections, within the library metadata size limit.

To expand a topic, select a note (optionally highlight a passage), choose **Expand**, **Questions**, or **Summarize**, or write an instruction, then press **Generate**. The AI draft appears for review; **Add connected note** creates a separate editable note linked to the source. Your original is preserved. Directly connected text can be included or excluded; unrelated library contents and image bytes are never sent. Generation uses the selected provider’s model knowledge without web research.

Connect an OpenAI-compatible chat-completions provider from **AI connection** in the canvas inspector, using its full HTTPS endpoint, model name, and API key. Browser connections require provider CORS support. The key stays in page memory for the session, is cleared by reload, and is excluded from drafts, canonical files, exports, and builds.

For a local server connection, set `CHARTA_AI_API_KEY`, `CHARTA_AI_ENDPOINT`, and `CHARTA_AI_MODEL` in your shell before starting `npm run dev`. Existing `SUMMARY_API_KEY`, `SUMMARY_ENDPOINT`, and `SUMMARY_MODEL` settings are also supported as fallbacks. Server credentials stay on the server; the UI receives only connection availability and model name. Restart an already-running development server after upgrading to add the canvas operations and AI routes. No provider configuration is required for editing boards. AI request and failure handling are tested with mocked providers; a paid live model call has not been verified.

## Optional AI summaries

Add these repository settings for the Pages workflow:

- Actions secret `SUMMARY_API_KEY` — your selected provider's API key.
- Repository variable `SUMMARY_ENDPOINT` — the full HTTPS chat-completions endpoint.
- Repository variable `SUMMARY_MODEL` — a model supporting the request format.

The endpoint must accept OpenAI-compatible chat-completions requests with JSON-object output, `max_completion_tokens`, and `store: false`. Captured text is sent to your selected provider. No credentials means the step skips; provider errors leave the material publishable. Website capture stores URL and notes; the extension also captures page text for summaries.

The workflow writes summary sidecars back under `content/` and deploys that same snapshot. Manually written summaries and sample materials are skipped. At most 10 materials are sent per workflow run; run it again for a larger backlog. The branch must permit the workflow's content commits. If another capture advances the branch during enrichment, a non-forced summary push can fail safely; the newer queued workflow processes the latest branch. Protected branches require a later PR-based publishing mode.

You can also run `node scripts/summarize.mjs` locally with those environment variables. Never put keys in `content/`, frontend code, or tracked files.

## Are.na import

The account has been imported into `content/`. The source snapshot, reviewed classification plan, reconciliation audit, import report, and media optimization report live under `content/imports/arena/`. Source IDs and connection order are preserved. Shared materials have one canonical record. External channels remain references with **Open in Are.na** links; their libraries are not recursively copied.

See the [completed import report](docs/import-report.md) for counts, folder organization, media savings, verification, and source discrepancies. The measured Pages bundle is approximately 256 MB; the full source archive preserves all 771 original files.

All 1,028 material connection rows reported across the 15 channels were returned. Are.na reports eight more channel-reference connections than it returns across three channels; the audit records this difference without guessing its cause. Two created images outside the channels remain accessible in All materials after removing Inbox.

The importer is resumable and uses a separate staging directory. It never writes to your Are.na account. Collecting account metadata requires a temporary token entered through hidden stdin; CDN media downloads use no account token. The exported account profile excludes email. To repeat an import:

```sh
node scripts/collect-arena.mjs /private/tmp/my-arena/snapshot.json
node scripts/tag-arena.mjs /private/tmp/my-arena/snapshot.json /private/tmp/my-arena/classification.json content/imports/arena/reviewed-overrides.json
node scripts/import-arena.mjs /private/tmp/my-arena/snapshot.json /private/tmp/my-arena/classification.json /private/tmp/my-arena/library
```

Inspect and validate the staged `content/` before replacing the active library. The source snapshot is a personal archive; do not publish it unless that is intended.

For optional media optimization, install Pillow and imageio-ffmpeg into a separate tools directory, then run:

```sh
python3 -m pip install --target /private/tmp/jelly-media-tools Pillow==11.3.0 imageio-ffmpeg==0.6.0
node scripts/optimize-arena.mjs /private/tmp/my-arena/library --tools /private/tmp/jelly-media-tools
```

Still images receive WebP viewing copies up to 2,000 pixels on the long edge at quality 84, with transparency and orientation preserved. Animated images remain original. Videos receive H.264/AAC MP4 copies up to 1,280 pixels and 30 fps, with fast-start playback. Smaller originals are retained when re-encoding would increase size; QuickTime files are converted for browser compatibility. The original bytes remain archived alongside these copies.

Classification uses source titles, descriptions, text, domains, and reviewed channel context. Two otherwise metadata-free images were visually reviewed. It does not claim that every image was visually analyzed or every video watched.

## Verification

```sh
npm run check
npm test
npm run build
```

Tests cover canonical references, taxonomy normalization and persistence, reasoned graph edges and limits, unsafe paths and files, folder moves in the data model, shared memberships, export ZIPs, atomic GitHub writes and retries, AI output handling, and static packaging. Initial automated checks use mocked GitHub/model responses. Live authenticated GitHub writes, model calls, and Chrome UI installation have not yet been verified.

`npm run test:local` starts an isolated loopback server and verifies real file saves, nested collections, taxonomy, network data, shared memberships, and catalog rebuilding without modifying your library.

## Research and design

- [Are.na feature research](docs/arena-research.md)
- [Target architecture](docs/architecture.md) — includes features beyond this draft
- [Release plan](docs/implementation-plan.md)

Charta is independent of Are.na. Software and project documentation are available under the [MIT license](LICENSE). Imported content retains its own rights and source attribution.

See the [15 November 2026 app review](docs/app-review.md) for findings, fixes, verification, and remaining limits.
