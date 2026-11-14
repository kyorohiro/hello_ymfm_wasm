# Batch itch packaging with one version

Started: 2026-11-14.

- [x] Define one shared VERSION and canonical products (exclude Game Boy/NES
      compatibility aliases to avoid duplicate output names).
- [x] Add a batch entry point for all products and a clear browser-run variant;
      keep normal vs Playground for_run outputs identifiable and versioned.
- [x] Validate the complete version/output plan before packaging and preserve
      existing release files. Report exactly which command failed if necessary.
- [x] Verify the real batch from an independent working directory and check
      output selection, hashes and failure/duplicate-version handling.
- [x] Document the commands and record the validation results.

Existing audit TODO/verification documents are staged user work. Do not modify
the index or commit/push/publish as part of this implementation.

Completed: 2026-11-14.

- `package_itch_all.sh VERSION` collects ten normal-distribution ZIPs into
  `release/itch_all_VERSION/`; `package_itch_all_for_run.sh VERSION` selects
  ten browser ZIPs into `release/itch_all_VERSION_for_run/`.
- One shared batch builds ten products and records eleven ZIPs. The second
  mode reuses the verified receipt; only the selected Playground ZIP differs.
  Each collection has a manifest, SHA256SUMS and README. Use a new VERSION to
  incorporate source changes.
- Validate version/output collisions before starting any child, retain per-
  product logs, reject concurrent same-version writers, preserve partial
  outputs on failure, and verify all original/collected ZIPs and metadata.
- Added ten focused batch regressions and two demo CLI regressions. The full
  CI packaging test group passes 56/56, with no failures or skips. The workflow
  runs the new tests alongside existing archive, bundling and conversion tests.
- Real executions from /private/tmp passed in both mode orders. Final run
  built ten products once, validated eleven archives and created both sets of
  ten ZIPs; subsequent normal collection reused the batch with no child builds.
- Independent-cwd packaging exposed the existing Playground demo generator
  writing into docs. Node/zlib differences changed only compressed PSF bytes;
  decoded programs were identical. Generate demos in the staged sample folder
  using --out-dir instead. Own generated docs differences were restored; the
  final real batch leaves the tracked source samples unchanged.
- Documented usage in README_RELEASE.md and docs/itch_web_release.md. No
  index changes, commit/push, publication, physical audio or new browser run.

Verification: [verification_itch_batch_packaging_20261114.json](verification_itch_batch_packaging_20261114.json).
Logs: build/itch-batch-packaging-20261114/.
