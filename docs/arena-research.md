# Are.na research for Charta

Research date: **15 November 2026**. Charta is a working name for an open source, GitHub-hosted collection tool. This document records the initial discovery and proposed behavior. See the [README](../README.md) for the current implemented draft.

The research uses Are.na’s official help and developer documentation. Chrome inspection was unavailable in this session, so the interface recommendations below are proposals informed by documented interactions, not a verified visual audit of the current application. We should validate the eventual prototype in Chrome. Product behavior can be studied without copying Are.na’s branding, proprietary text, or visual assets.

## What makes Are.na useful

Are.na combines reusable pieces of material, curated collections, and navigable connections. Its important distinction from a conventional bookmark manager is that one piece of material can accumulate context through several collections. Channels can also be connected to channels. A useful alternative should preserve this many-to-many model. [Blocks](https://help.are.na/docs/getting-started/blocks), [Connections](https://help.are.na/docs/getting-started/connections)

Real folders are a deliberate Charta addition. Are.na’s taxonomy guide describes organization through channels, blocks, connections, naming conventions, and groups, rather than a strict folder hierarchy. Nested channel connections should therefore not be mistaken for filesystem folders. [Creating personal taxonomies](https://help.are.na/docs/guides/creating-personal-taxonomies)

## Feature comparison

| Capability | Documented Are.na behavior | Charta proposal |
| --- | --- | --- |
| Materials / blocks | Files, URLs including media links, and raw text; available metadata is extracted when saved. | Canonical material records with stable IDs, source information, editable metadata, captured text, and optional assets. [Blocks](https://help.are.na/docs/getting-started/blocks) |
| Collections | Channels contain blocks and other channels; users can reorder their contents. | Ordered, typed references to blocks or other collections, with reusable memberships. [Channels](https://help.are.na/docs/getting-started/channels) |
| Connections | Blocks and channels can connect to channels, and users can follow those relationships. | Add existing material to another collection; derive backlinks and show connected collections. [Connections](https://help.are.na/docs/getting-started/connections) |
| Folders | No conventional folder system; users develop lightweight personal taxonomies. | Explicit filesystem-backed folder tree, independent of collection-to-collection connections. [Personal taxonomies](https://help.are.na/docs/guides/creating-personal-taxonomies) |
| Adding content | File drag-and-drop, Markdown text, pasted URLs, and extension capture. | Begin with links, text, images, and PDFs; retain provenance for each capture. [Adding blocks](https://help.are.na/docs/getting-started/blocks/adding-blocks) |
| Editing | Block titles and descriptions are editable in the full lightbox view. | A material detail panel with title, source, notes, summary, and collection memberships. [Editing blocks](https://help.are.na/docs/getting-started/blocks/editing-blocks) |
| Removal | Removing material from a channel removes its connection. | Separate removing a collection membership from deleting the canonical material. [Deleting blocks](https://help.are.na/docs/getting-started/blocks/deleting-blocks) |
| Search and reading | Premium features include extracted reader text, full-text search, table view, custom thumbnails, and pinned blocks. | Search stored titles, descriptions, notes, and captured text first; richer reading and viewing tools later. [Premium features](https://help.are.na/docs/getting-started/premium-features) |
| Collaboration | Individual/group ownership, invited collaborators, and open, closed, or private channels. | Personal publishing first; GitHub repository permissions and pull requests can support initial collaboration. Are.na-style access controls are outside the first release. [Channels](https://help.are.na/docs/getting-started/channels), [Groups](https://help.are.na/docs/getting-started/groups) |
| Portability | Channels can be downloaded. | Human-readable files are the authoritative archive; generated indexes remain rebuildable. [Settings and export](https://help.are.na/docs/getting-started/channels/settings-and-export) |

## Reference capture flow

Are.na’s extension saves the current page into a recent or searched channel. It also captures selected text or images through a context menu, retaining the originating page as context. Before saving, users can edit the title and description or create a destination channel. Chrome and Firefox support a page screenshot option. Keyboard controls cover activation, choosing a destination, editing, saving, and dismissal. [Browser extension](https://help.are.na/docs/getting-started/browser-extension)

The equivalent Charta interaction should be:

1. Open the extension on a page, or invoke a context-menu action on selected text or an image.
2. Review the captured title, URL, selection, and available preview. Edit the title or add a note.
3. Search collections, choose a recent destination, or create a collection within a folder.
4. Save the canonical block and its collection membership to the configured repository.
5. Show distinct pending, committed, and failed states; retry safely without duplicating the material.

Capturing and saving should succeed without AI. Summarization can follow asynchronously, with its status visible. The capture should preserve what the user selected and where it came from, even if enrichment fails. Screenshots can follow the basic capture workflow.

## Minimal interface proposal

A narrow sidebar contains Inbox, All materials, and the folder tree. The main area shows a collection title, breadcrumb, short description, and a plain card grid. Search and Add remain easy to reach. Cards prioritize useful titles, small previews, and material type; avoid a dashboard full of statistics.

Opening a material reveals its source, stored content, editable notes, optional AI summary, and collection memberships. Backlinks expose where it appears. Related collections use ordinary links or cards; a graph visualization is unnecessary initially. A compact list view can follow when the archive grows.

Source attribution and image alt text deserve explicit fields. Are.na’s own guidance emphasizes contextual metadata and preserving sources, and describes the collection list on a block as a way to understand its changing context. [Handling blocks with care](https://help.are.na/docs/guides/handling-blocks-with-care)

## Parity, additions, and priorities

**Preserve:** reusable materials, ordered collections, collection connections, source attribution, editable descriptions, search, and quick browser capture.

**Add:** real folders, GitHub-owned content files, optional AI summaries, and proposed related-material connections. AI suggestions should remain distinguishable from the user’s own notes and accepted links. The reviewed Are.na documentation describes metadata extraction and human connections; it does not establish an equivalent native AI-summary workflow.

For Charta’s storage model, canonical blocks live under `content/blocks/<id>/`. The human folder tree lives under `content/collections/`, using `folder.json` for folders and `collection.json` for collection leaf directories. Ordered `collection.items` contain typed ID references. Collection-to-collection graph links remain separate from filesystem nesting. The architecture document defines the full contract.

**First release:** static browsing, folders, collections, material details, search, backlinks, Chrome capture, reliable GitHub persistence, and optional short summaries. **Later:** extracted reader mode, PDF/image enrichment, screenshots, pins, drag reorder, alternative views, import helpers, and richer collaboration.

If a later milestone imports a user’s Are.na content, use the current developer portal and v3 API documentation. The older `dev.are.na` portal is deprecated. Import is separate from building an independent archive. [Developers](https://www.are.na/developers), [API explorer](https://www.are.na/developers/explore)
