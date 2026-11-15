# Third-party notices

Charta's reader uses the same open-source extraction and Markdown engine as
[Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper):
[Defuddle](https://github.com/kepano/defuddle). Charta's capture adapter and reader
interface are independently implemented. No Obsidian extension source code,
icons, logos, or other brand assets are included.

All executable dependencies below are bundled locally and unmodified. The
extension does not download code at runtime.

| Dependency | Version | Purpose | License and retained notice |
| --- | --- | --- | --- |
| [Defuddle](https://github.com/kepano/defuddle/tree/0.19.2) | 0.19.2 | Article extraction and HTML-to-Markdown conversion; matches Obsidian Clipper's pinned version | MIT · [notice](vendor/licenses/defuddle-MIT.txt) |
| [Turndown](https://github.com/mixmark-io/turndown) | 7.2.0 | Included in Defuddle's full browser bundle | MIT · [notice](vendor/licenses/turndown-MIT.txt) |
| [mathml-to-latex](https://github.com/asnunes/mathml-to-latex) | 1.8.0 | Included in Defuddle's full browser bundle | MIT · [notice](vendor/licenses/mathml-to-latex-MIT.txt) |
| [Temml](https://github.com/ronkok/Temml) | 0.13.3 | Included in Defuddle's full browser bundle | MIT · [notice](vendor/licenses/temml-MIT.txt) |
| [xmldom](https://github.com/xmldom/xmldom) | 0.9.10 | Included in Defuddle's full browser bundle | MIT · [notice](vendor/licenses/xmldom-MIT.txt) |
| [Marked](https://github.com/markedjs/marked) | 18.2.0 | Markdown rendering | MIT and bundled Markdown notice · [license](vendor/marked-LICENSE) |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.12 | Sanitizing rendered reader HTML | Apache-2.0 OR MPL-2.0 · [Apache license](vendor/DOMPurify-LICENSE-APACHE), [MPL license](vendor/DOMPurify-LICENSE-MPL) |

The Defuddle artifact, package integrity values, and bundled dependency versions
are recorded in [its provenance file](vendor/defuddle.provenance.json).
Maintainers can reproduce that artifact and its license files with
`node scripts/vendor-clipper.mjs`. Additional bundle notes are in
[Defuddle attribution](vendor/DEFUDDLE-NOTICE.md) and
[reader dependencies](vendor/READER-NOTICE.md).

The software licenses above do not grant rights to material saved in a Charta
archive. Saved articles and media retain their original ownership and licenses.
