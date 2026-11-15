# Artifact curation

All 1,016 imported records have short titles and thematic memberships. Every saved image and representative video preview was visually reviewed; visible text was extracted with macOS Vision where present. All 15 PDFs have saved full-text extraction, including OCR of the scanned architecture book (1,841,940 characters in total). Video titles describe the saved preview; they do not imply a complete viewing or transcription.

| Section | Materials | Subsections |
| --- | ---: | --- |
| Writing | 66 | Culture, Design, Research, Technology, Tweets |
| Graphic design | 334 | Editorial, Identity, Information design, Motion, Tools, Typography |
| Interface design | 248 | Components, Experiments, Inspiration, Portfolios, Products |
| Companies | 52 | Startups, VC funds, Studios, Nonprofits, Health technology, Organizations; each divided into sector subfolders |
| Architecture | 109 | Buildings, Interiors, Theory |
| Objects | 24 | Furniture, Lighting, Product design |
| Sound | 71 | Instruments, Speakers |
| Technology | 40 | AI, Creative coding, Hardware, Neurotechnology, Research tools |
| Culture | 73 | Archives, Art, Photography |

The table counts primary classifications. Additional collection memberships allow an entry to cross subjects without duplicating its files. Companies with verified nonprofit, startup, or investor status include primary-source evidence in the curation plan. Other organizations retain broader labels.

Companies now has 21 material folders beneath its six company-type folders:

| Parent | Sector subfolders |
| --- | --- |
| Startups | Neurotech startups, Biotech startups, Medtech startups, Space tech startups |
| VC funds | Deep tech funds, Generalist funds, Biotech funds |
| Studios | Creative tech studios, Brand & web studios, Production studios, Strategy & foresight |
| Nonprofits | Neurotech nonprofits, AI nonprofits, Science nonprofits |
| Health technology | Neurotech, Mental health & wellbeing, Biotech |
| Organizations | AI models & data, Agents & automation, Security & intelligence, Mental health directories |

Sector assignments use the saved descriptions, tags, and captured text. The existing company types are retained; a sector folder is created only when matching material is saved. [companies.json](../content/imports/curation/companies.json) records the previous collection lists and all 51 assignments. Every pre-existing company collection ID remains on its first subdivision, so saved material-folder routes still resolve. Material records, assets, and memberships outside Companies are unchanged. The library now has 53 material folders across its nine sections; the Add resource test created Biotech funds and added the Age1 portfolio after the original company reorganization.

The original curation preserved all 78 collection records. After reorganization, the redundant Archive tree was removed from live browsing: all 1,016 materials already belonged to the thematic folders. [retired-collections.json](../content/imports/curation/retired-collections.json) retains the original collection lists, folder records, and 62 external channel links, including the previously removed Inbox metadata. The library's `curation.retiredCollectionsPath` explicitly registers this history for the audit. All 2,459 pre-existing media assets are preserved; two previously previewless videos gained generated stills. Every block keeps its original title, classification and memberships in `curation.original`; imported Are.na attribution is unchanged.

`content/imports/curation/before.json` records the pre-curation metadata and asset digests. `plan.json` records titles, evidence, visual-review scope, taxonomy decisions, and the 17 reading connections. `report.json` records coverage and the nine source-limited entries. Those entries have conservative author/entity titles: their inaccessible X, Instagram, Notion, profile, or dynamic page contents have not been invented.

Reading suggestions are stored separately in `suggestedRelated`, with a reason and `curation-v1` provenance. They appear as Related reading in article and PDF drawers. The text-only Network gives these suggestions their own relation type and filter; images and documents remain outside that graph. CLIP similarities are a separate inferred view in Discover.

## Audit

```sh
node scripts/curate-archive.mjs --check
node scripts/embed-library.mjs --check
```

The curation audit verifies every original collection list against live records or explicitly registered retired history, along with preservation of every original material, asset references/digests, short titles, thematic memberships, and full extracted-text digests. Newly added resources are counted separately and do not invalidate the original import audit. Missing history, changed original lists, and duplicate retired IDs fail the audit. The embedding audit checks model provenance, vector integrity, complete coverage and current input hashes. New edits require embedding regeneration; see [embedding maintenance](embeddings.md).
