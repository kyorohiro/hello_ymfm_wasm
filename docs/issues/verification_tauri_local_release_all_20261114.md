# Local Tauri release tooling verification — 2026-11-14

Scope: tool implementation only. No real app import, metadata update, release
build, certificate export/upload, commit, tag, push or release publication.
The app version is a user-supplied runtime argument; no actual release version
was requested or chosen by the implementation.

## Automated checks

```sh
python3 -W error::ResourceWarning -m unittest discover -s scripts -p '*tauri*test.py' -v
sh -n scripts/release_tauri_all.sh
git diff --check
```

26 tests passed: 12 local orchestration/resource tests, 6 metadata tests and
8 pre-existing password-helper tests. All Git mutations were restricted to
temporary fixture repositories. Imports, builds, signing/notarization tools
and GitHub CLI were stubbed; no network credentials/services were used.

The existing password-helper failure fixture expected an unprefixed --repo
argument, while its implementation uses github.com/owner/repo. Corrected only
the test predicate/assertion; the helper and its upload behavior are unchanged.

Coverage includes:

- Web source collection 0.99.99 imported into app version 1.2.3; the requested
  app version never selects ZIP filenames.
- Read-only plan and all-repository dirty/tag/source-hash preflight before
  importing any app. Browser-only and unsafe collection entries are rejected.
- Synchronization of all five metadata/lock files, including stale npm root
  versions, while preserving foreign Cargo/npm dependency records.
- Password removal from ordinary child environments, build-only injection,
  redacted output, and absence from argv/state/artifacts.
- Complete-batch failure and tamper detection before final commits/tags.
- Failed commit after staging, and partial tag failure, followed by retry
  without duplicate commits or network Git operations.
- Both real target bundle layouts, app Info.plist versions, signature/ticket/
  architecture command invocation, four collected app ZIP/DMG records and
  rejection of wrong-version apps or old DMGs.
- Playground host architecture selection and pinned audio-resource preparation
  before Cargo, with only approved asset environment variables passed through.

## Read-only real checkout inspection

Metadata, source manifest product IDs and existing artifact paths/names were
inspected for all nine local Tauri repositories. Playground keeps its existing
per-architecture Node/Audify preparation and deploy helper.

```sh
sh scripts/release_tauri_all.sh --plan 1.2.3 --web-dir release/itch_all_0.99.99
```

This intentionally stopped before any writes because existing user changes
were present in:

- DMG: desktop/desktop-interface.js, scripts/check-desktop-browser.cjs,
  scripts/check-desktop-menu-compat.cjs.
- S-DSP: docs/todo_20261106.md, docs/verification_20261106.md.

1.2.3 was a read-only verification value, not a chosen release version.
Actual signature/notarization results and end-to-end signed builds remain to
be checked when the user runs --prepare with their own version and local keys.
GitHub upload/publication and resumable failed build preparation remain TODOs.
