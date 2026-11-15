# Charta first release plan

The first release should prove one complete path: save a webpage through Chrome, commit it under `content/`, publish it on GitHub Pages, and find it again through folders, search, and connections. AI adds a short summary when configured. This plan follows the [architecture](architecture.md) and [Are.na research](arena-research.md).

## First working slice

Build a small static reader using a handful of openly licensed example materials. Implement the canonical content records and validation before extension capture, so the library has one durable format from the start.

The slice is complete when a collection shows its materials, each material shows its source and memberships, one material appears in two collections without duplication, and a linked collection can be opened. Search and direct hash-route reloads must work below a project URL such as `/Charta/`.

## Release scope

| Step | Deliverable | Acceptance check |
| --- | --- | --- |
| 1. Content contract | Versioned schemas, example library, ID resolver, validator, catalog builder | Duplicate IDs, invalid paths, and missing references produce actionable errors; rebuilding the catalog is deterministic |
| 2. Reader | Folder sidebar, collection grid, detail panel, search, backlinks | Keyboard and mobile navigation work; folder renames preserve ID links; collection cycles cannot hang the page |
| 3. Chrome capture | Manifest V3 popup, repository connection, page and selection capture, destination search | Saving creates one atomic commit containing the material and membership; text keeps its source URL |
| 4. Organization | Create and rename folders/collections; move collections; edit material; connect existing items; reorder | Two collections share one canonical block; removing a connection leaves the material available; moving a collection preserves incoming links |
| 5. Files and images | Raster image, PDF, and plain text upload; stored assets, thumbnails, source metadata | Saved asset bytes live under `content/`; unavailable remote images remain visibly labeled references; active file formats are rejected |
| 6. Publication | Coordinated validation, catalog generation, and Pages workflow | A capture becomes visible after a successful deployment; failed saves remain retryable; latest deployment identifies its source snapshot |
| 7. AI enrichment | Provider adapter, Actions secret setup, summary records, editable output | Useful text gets a short summary; missing text is identified; provider failure does not prevent publication; owner edits survive regeneration |
| 8. Open source template | Setup guide, license, contributor notes, extension package | A fresh repository can be configured from the guide without editing application code or exposing secrets |

Folder and collection editing can start in extension-owned screens opened from the library. The website remains readable for anyone without the extension. A GitHub file-edit link is a useful fallback during development.

## Verification that matters

Use focused integration checks for the data and persistence behavior:

- Save two materials concurrently and verify that both survive, including their memberships.
- Interrupt a save after a commit and retry it; the operation must not create duplicates.
- Move a folder containing a collection and verify cross-links and asset paths.
- Remove one membership from a shared material and verify the other collection still works.
- Test missing credentials, expired token, offline capture, rejected branch update, and a GitHub rate-limit response.
- Test absent AI credentials, provider failure, changed source text, and a manually edited summary.
- Trigger a summary commit using `GITHUB_TOKEN` and verify the same workflow publishes it.
- Save at commit A, publish its summary at child commit B, and verify the extension recognizes the capture as published.
- Load the reader at both the domain root and a repository subpath, including a bookmarked detail route.

Browser checks should use Chrome when available. Include capture from a normal article, selected text, an image on another host, a page with no readable text, and a restricted Chrome page. Check that external text and uploaded files cannot run scripts in the reader.

## Later additions

Categories, tags, and a reasoned material network are now part of the draft. Add screenshots, richer PDF extraction and OCR, a polished reader view, optional table view, and AI-related-material suggestions after the capture-to-publication path is reliable. Social feeds, public collaborative editing, and private channels remain outside the first release.

Smoother GitHub login needs an authentication spike before choosing OAuth, a GitHub App, or device flow. The initial one-repository token setup makes the self-hosted path concrete. An Are.na import tool can follow separately using its current developer API or an owner-provided export; it is not a dependency for Charta.

## Decisions carried into implementation

Use Charta as a working name, build the reader with simple web modules, keep every saved item under `content/`, and publish a public personal library. Choose the model provider while implementing enrichment. Choose an explicit open source software license before distributing code, and document that saved third-party material retains its own rights and attribution.
