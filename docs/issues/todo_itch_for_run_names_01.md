# Distinct browser-upload ZIP names

Started: 2026-11-14.

Reapplied after the user's hard reset and explicit request for the collection
folder only. Individual builders, release/ root ZIP names and Tauri work are
unchanged.

- [x] Give every browser collection ZIP a single _for_run.zip suffix while
      retaining the common version and unchanged normal-download filenames.
- [x] Copy the existing validated archives under their browser names and record
      sourceName in the browser manifest; do not rebuild or recompress Synths.
- [x] Handle existing completed browser collections: verify their bytes and
      metadata, migrate names and keep the old folder as a backup. Corrupted
      or edited collections must remain untouched.
- [x] Update focused regressions/docs and validate a real existing batch.

Scope: the aggregate packaging commands and their collected ZIP filenames.
Playground continues to use its actual browser-specific archive. Individual
builders and raw source archives in release/ retain their existing names.
Do not modify Tauri release work, user TODOs, index, commits or publishing.

Completed: 2026-11-14.
- All ten browser filenames carry version and _for_run.zip exactly once.
  Nine products reuse the same ZIP bytes; Playground uses its actual run ZIP.
- Browser manifest schema2 maps output names to verified sourceName values;
  receipt extensions cannot supply copy paths. Normal metadata stays compatible.
- Existing valid schema1 browser collections migrate with a complete backup;
  edited ZIPs/checksums/guides refuse migration. Repeat runs reuse schema2.
- Reapplied change: 13/13 targeted batch regressions passed, no failures/skips,
  covering suffixes, byte identity, migration and unsafe metadata.
- Actual 0.99.99 collection was migrated. Verified ten renamed ZIPs and CRCs,
  exact original ZIP bytes, complete old-folder backup, unchanged eleven root
  archives/receipt/logs and normal collection. No child rebuilds were needed.
- Updated README_RELEASE.md and docs/itch_web_release.md. No audio, browser,
  commits/pushes, publishing or Tauri changes were performed.

Verification: [verification_itch_for_run_names_20261114.json](verification_itch_for_run_names_20261114.json).
Logs: build/itch-for-run-folder-20261114/.
