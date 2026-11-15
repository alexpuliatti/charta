# Are.na import report

Completed on 15 November 2026. Your account content is now the active Charta library under `content/`. The Are.na account was read only; no source content was modified. The temporary API token was not stored in project files.

## Imported content

- 1,016 unique materials, preserving source IDs and original metadata.
- 15 owned channels, with all 1,028 reported material connections preserved.
- 62 external channels kept as references with Open in Are.na links. Their contents were not recursively copied.
- Two unfiled materials originally imported into Inbox, now retained in All materials after removing that collection.
- 771 downloadable original files: 663 images, 93 video attachments, and 15 PDFs.
- 991 source thumbnails archived locally.
- Two YouTube videos retained as source embeds and thumbnails because the API provides no original downloadable video.
- Zero remaining media download failures.

Original titles and channel relationships remain available in the source archive. Two opaque filename-only image titles were replaced with readable editorial descriptions after visual review; their original titles remain in source metadata.

## Organization and tagging

The original channel names were preserved and grouped into five topic folders. External channel references are in a separate Linked channels folder.

| Folder | Original channels |
| --- | --- |
| Knowledge and culture | visualizzare il sapere, utopia, leggi, MH-companies, tweets |
| Interfaces and tools | interfaces, design-tools |
| Sound and hardware | speakers, drea-deva-speaker |
| Spaces and objects | interior, arch, objects |
| Graphic and motion design | materiali-grafici, motion, copertine |

All 1,016 materials have a category and at least three normalized tags. Classification uses titles, descriptions, source domains, media type, and reviewed channel context. Two otherwise metadata-free images were visually reviewed. The process does not claim that every image was visually analyzed or every video watched. Labels remain editable.

The Network view derives its connections from these tags, categories, shared collections, and direct links. It initially shows up to 200 materials and 1,200 edges; filters make the full library explorable.

## Optimized media

- 624 image copies optimized to WebP, with orientation and transparency preserved.
- 73 video copies optimized to H.264/AAC MP4 with fast-start playback.
- 11 animated images preserved as originals.
- 28 images and 20 videos kept in their smaller original form.
- Zero encoding failures.

Image and video browsing payload fell from 1.18 GB to 398.4 MB, a 66.2% reduction. All original bytes remain under `content/`. All 2,459 archived assets were checked against their byte counts and SHA-256 checksums.

The measured Pages bundle is approximately 256.1 MB. It includes local thumbnails and optimized copies. Original downloads use immutable URLs from the same public GitHub repository when published. This local validation used a placeholder repository only for measuring the build; no site was deployed and that temporary build was removed. The normal local `dist/` contains the full archive.

## Source count discrepancies

Every material count matches the API in all 15 owned channels, with no unresolved material references. Are.na reports eight more channel-reference connections than it returns:

- visualizzare il sapere: 43 of 49 channel references returned (6 unreturned).
- speakers: 1 of 2 channel references returned (1 unreturned).
- objects: 6 of 7 channel references returned (1 unreturned).

The API does not establish why those channel references are unreturned. Their missing IDs or links were not fabricated.

## Archive and verification

The source snapshot, classification plan, reviewed overrides, audit, import report, and optimization report are in [content/imports/arena](../content/imports/arena/report.json). Original file rights and source attribution are retained. Imported material is not relicensed under the software's MIT license.

JavaScript and content checks, 80 automated tests, the static build, and isolated file-save/range-request integration checks passed. Actual media encoding and source codec inspection also passed. Browser visual playback remains unverified because the Chrome automation host is unavailable.

Restart `npm run dev` before browsing so the server loads the new media formats.
