# SPU New Cassette

- [x] Add Menu → New → Cassette with Cancel, Export current & create, and
  Create without export. Explain replacement and unsaved working data.
- [x] Build/validate a fresh default Sine instrument and original starter
  `/index.js` before retiring the current performance. Do not create audio
  or run Code just to open the dialog or create a cold Cassette.
- [x] Backup saved files + working recovery before replacement; reject failed
  exports/preparation without dropping files, sound or performance owners.
  Explain that external PSF/VAB inspector sources are not included unless in Files.
- [x] Explicit creation stops Code/PSF/keyboard, clears old source inspector
  state after success, restores defaults, and keeps global user preferences.
- [x] Keep recoverable previous files/settings on apply/editor failure or
  cancellation; do not automatically restart a retired performance.
- [x] Test defaults, backup/cancel/failure/storage cases, real muted browsers
  and a readable packaged ZIP locally. No publication or remote CI.

## Verification (2026-11-20)

- `npm run test:spu-synth`: 420 passed. New checks cover passive confirmation,
  original starter/default Sine, both file versions and binary backup, cancelled /
  failed exports, preparation/apply/editor failures, cancellation after an
  asynchronous reply, local storage failure, post-commit cleanup warnings,
  modal keyboard handling, and releasing a PSF source without losing a later one.
- `check_spu_working_saved_browser.cjs`: source and final ZIP, muted Chromium
  and WebKit. Cold New creates no AudioContext; modal typing plays no notes.
  Cancel keeps Code; Export current & create yields a parsed Cassette with
  saved + working data and exact binary bytes before retirement. New restores
  nonempty starter Code/Sine without auto-running; the new Sine plays through
  the existing graph when a keyboard note is explicitly pressed. Preferences,
  draft/reload and expanded navigation checks also pass.
- `check_spu_synth_psf_manual_browser.cjs --engines=chromium`: source and ZIP.
  Cancel keeps the same PSF core; creation closes it, clears the source selector
  and inspector, hides transport, and restores Sine. Existing Capture/seek/
  ownership/Code handoff continue to pass.
- `sh scripts/package_itch_spu_synth.sh new-cassette-check`: readable source and
  native provenance checks passed. Inspected the 390 px modal capture; labels
  fit and Cancel receives initial focus. `git diff --check` passed.

Audio outputs were muted before app startup; no listening or real-game hearing
check was performed. No commit, push, remote CI, npm or Tauri publication.
Auto apply, Master and Highlight preferences remain; source CH following resets
to CH1/Live On. External PSF/VAB inspector input is explicitly outside Cassette
backup unless saved in Files. After a late failure the previous documents and
sound can be restored, but retired performances are not automatically rerun.
