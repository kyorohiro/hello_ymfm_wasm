# Per-app import version option — 2026-11-14

User-requested entry point: run the existing `npm run import:release` within
each independent Tauri checkout, optionally passing `ZIP --version X.Y.Z`.
The app version is independent of the ZIP filename and Web release version.

All nine repositories now include a standalone `scripts/app_version.py`.
No parent checkout or shared installed package is needed. The optional flag
updates package.json, package-lock.json (including packages['']), Cargo.toml,
the local app crate in Cargo.lock, and tauri.conf.json. Foreign dependency
records are preserved; numeric out-of-sync existing app fields are repaired.

Preparation validates every proposed metadata file before any import writes.
ZIP identity, original source and native receipts keep their existing checks.
The app update is applied after valid extraction, with metadata/import rollback
on failure. The receipt's original Web provenance remains independent.
ZIP-only imports and check/local-edit commands retain their original purposes.
The version flag is rejected with --check or --record-local-changes.

## Verification

Executed `python3 -m unittest discover -s tests` in each checkout:

| Repository | Passing tests |
| --- | ---: |
| tetorica-2a03-synth-tauri | 35 |
| tetorica-dmg-synth-tauri | 31 |
| tetorica-fm2612-playground-tauri | 51 |
| tetorica-fm2612-synth-tauri | 28 |
| tetorica-fm2612-vgm-analyzer-tauri | 21 |
| tetorica-huc6280-synth-tauri | 35 |
| tetorica-sdsp-synth-tauri | 39 |
| tetorica-sid-synth-tauri | 39 |
| tetorica-spu-synth-tauri | 28 |
| Total | 307 |

New fixtures exercise valid CLI imports, all five metadata files and foreign
dependency preservation, differing ZIP/app versions, legacy no-flag imports,
invalid version/metadata/archive rejection, incompatible CLI flags, changed
metadata guards and replacement failure rollback. Existing source/receipt/
local-edit import tests also passed.

All nine `npm run import:release -- --help` calls pass and advertise --version.
All nine helper copies have SHA-256
ac1f5e796e9579efa392e7a8fbf2cad6994d36ae03f72e4367e787101d3307b3.
`git diff HEAD --name-only` for the five app metadata files, dist and
release.lock.json is empty in every checkout. Existing user edits in DMG
desktop checks and S-DSP documents were retained. Diff whitespace checks pass.

No actual Web ZIP import, app version bump, app build, signing, commit, tag,
push or publication was executed. Import/version mutations in tests used
temporary fixtures only.
