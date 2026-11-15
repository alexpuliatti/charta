# Charta app review — 15 November 2026

Reviewed the website, local editing server, shared content model, Chrome extension, import/upload paths, search and AI boundaries, build scripts, dependencies, canonical archive, and GitHub workflows. The source folder initially had no Git history. The repository upload includes the app and its existing archive; generated `dist/` and installed dependencies are excluded.

## Findings fixed

| Severity | Location | Finding and resolution |
| --- | --- | --- |
| High | `scripts/dev.mjs`, `web/store.mjs`, `shared/operations.mjs` | Two tabs using the local server could overwrite the same field or delete a resource edited after the tab loaded. Local saves now send only the relevant original records and use the same field-aware conflict checks as GitHub and connected-folder saves. Conflicting saves retain the client's working snapshot; independent field edits remain supported. |
| Medium | `shared/model.mjs`, `scripts/library.mjs` | Source URLs containing a username or password could enter canonical content, builds, and exports. Both mutation and canonical-file validation now reject embedded credentials, matching the extension and resource-fetch policies. |
| Medium | `.github/workflows/check.yml` | Validation ran only for pull requests. Pushes to `main` now run syntax/content validation, the complete test suite, a build, and the isolated local-server integration check. |
| Medium | `.github/workflows/pages.yml`, `README.md` | Every initial push attempted a Pages deployment even when Pages was unconfigured. Publication is now an explicit manual workflow or enabled with `CHARTA_PUBLISH_PAGES=true`. A repository upload alone does not publish the personal archive. |

The conflict helpers moved into a shared module; existing browser imports remain supported. Tests that assemble minimal module fixtures now include the shared dependency.

## Verification

- `npm run check`: passes JavaScript syntax, vendored component freshness/provenance, and canonical content validation.
- `npm test`: 270 passed, zero failed or skipped. Covers website DOM behavior, the extension, rendering/sanitization, taxonomy, media, PDF state, folders, research, canvas, persistence, and GitHub writes/retries with mocked APIs.
- `npm run test:local`: passes against a temporary library and a real loopback HTTP server. Exercises disk writes, uploads, reloads, memberships, deletions, origin protection, stale-tab edit/delete conflicts, and independent changes. Does not modify the real archive.
- `npm run build`: succeeds with 1,017 materials, 53 collections, and 15 physical folders.
- `npm audit`: zero known vulnerabilities in the lockfile dependency graph at review time.
- Source and archive text scan: no matches for the checked GitHub/OpenAI/AWS token formats or private-key headers. This is a pattern scan, not a guarantee that arbitrary secrets are absent.
- Desktop Chrome: inspected the home screen; exercised search and keyboard opening/dismissal of an image preview, folder navigation, a reading's connection list, and the add-material dialog with Escape dismissal. No real content was added or deleted.
- Packaging: approximately 1.55 GB of source/content files. Two originals exceed 50 MiB; none exceeds GitHub's 100 MiB ordinary-file limit. Originals are preserved.

UI review used the [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). The small React integration was also checked against the installed Vercel React best-practice skill: its runtime is loaded on demand, connection results start with eight entries, and reduced-motion handling is retained. No component rewrite was needed.

## Remaining limits and follow-up work

- The archive is large. `loadLibrary()` reads asset bytes for validation, and each local mutation validates/rebuilds the library. Incremental asset validation and output copying would reduce disk work as the archive grows; this review preserves the existing save/build architecture.
- GitHub-connected media uses public raw URLs. A private repository is suitable for the local app and backup, but private raw media is not a complete remote-reader solution. Pages publication and private-media delivery need a deliberate hosting decision.
- Browser drafts and research history use browser storage. Quotas can prevent saving large drafts; research history remains device-local. The app reports storage failures; connect a folder/repository and export content for durable storage.
- Chrome extension capture/installation, mobile hardware, live provider/model calls, and end-to-end authenticated in-app GitHub editing were not tested live. Their covered paths use automated fixtures and mocks. The new repository push is verified separately from those app integrations.
- The local server serializes its own writes and rejects stale browser edits. It does not provide filesystem locking or crash recovery against another process editing files during an active multi-file save. Reload after editing canonical files externally.
- The pre-existing development-server process needs a restart to load server-code changes. Integration checks started a fresh server from the reviewed source.

No critical issue was identified in the inspected paths. The remaining limits above bound this review; it is not a penetration test or exhaustive assistive-technology/browser certification.

GitHub documents the ordinary-file limits and repository-size guidance in [About large files on GitHub](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github).
