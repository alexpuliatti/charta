# Jelly reader dependencies

These files are bundled locally. The extension does not download executable code.

| File | Version | Source | License |
| --- | --- | --- | --- |
| `marked.umd.js` | 18.2.0 | https://github.com/markedjs/marked | MIT and bundled Markdown notice; see `marked-LICENSE` |
| `purify.min.js` | 3.4.12 | https://github.com/cure53/DOMPurify | Apache-2.0 OR MPL-2.0; see `DOMPurify-LICENSE-APACHE` and `DOMPurify-LICENSE-MPL` |

The bundles are unmodified files from the corresponding pinned npm packages.
`reader-render.js` is Jelly's integration: Markdown parsing is followed by an explicit HTML allowlist, URL checks, and safe link/image attributes.
