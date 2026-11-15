# Defuddle attribution

Jelly packages the unchanged `dist/index.full.js` browser bundle from
[Defuddle 0.19.2](https://github.com/kepano/defuddle/tree/0.19.2), the extraction
and Markdown engine used by [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper).
This version matches Obsidian Clipper's pinned dependency when the integration
was implemented. Jelly's capture adapter and reader interface are its own code;
no Obsidian icons, logos, or brand assets are included.

The full bundle includes Defuddle, Turndown, mathml-to-latex, Temml, and xmldom.
Their MIT notices are preserved in `licenses/`. Versions, package sources,
tarball integrity values, and the original bundle checksum are recorded in
`defuddle.provenance.json`.

Maintainers can reproduce these files with:

```sh
node scripts/vendor-clipper.mjs
```

That maintainer command downloads pinned npm tarballs. Using Jelly requires no
build, package installation, or runtime script downloads. Capture runs against
the user's active page with Defuddle's synchronous parser and `useAsync: false`;
third-party extraction APIs are disabled. Thread capture observes loaded X DOM
posts and explicitly warns that unloaded content may be missing.
