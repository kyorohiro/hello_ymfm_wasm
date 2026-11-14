# S-DSP Synth: Files and Code performance

Implemented in an isolated checkout based on `a92e13f31c1f4126fef1491448941e3ad8331492`.
The user's main checkout, release directories, Tauri repositories, versions,
Git index, commits and tags are untouched.

- [x] Add Files with named portable presets, JavaScript / text editing, binary
      assets, folders, rename / duplicate / delete and Cassette ZIP roundtrips.
- [x] Save complete sound and Code projects locally using the common reconnecting
      project store. Preserve unread / invalid drafts and newer asynchronous edits.
- [x] Add Keyboard / Code views, Run / Apply / Stop, expandable Code and typed
      Synth-only declarations, using the existing shared editor and runtime.
- [x] Borrow the current S-DSP, samples, Noise, PMON, Echo and Master. Code lanes
      allocate through the existing instrument; stopping Code releases only its
      identities and leaves manual keyboard owners and authored settings intact.
- [x] Use beat-based music in the starter; enable manual keyboard in Code view
      outside text editing, Files and dialogs, retaining key-up and blur cleanup.
- [x] Include readable Code dependencies, Native FX WASM / rebuild kit, type
      declarations and dependency licenses in standalone packages.
- [x] Verify real WASM, declarations, project failures, packaged browser behavior
      and wide / narrow screenshots with every speaker connection muted.

## Scope

The app-specific `useSoundChip('snes')` handle has `noteOn(lane,note)`,
`noteOff(lane)`, `getState()`, `allNotesOff()` and `dispose()`. Lanes 0–7 are
software note identities, not physical DSP channel numbers; PMON uses adjacent
hardware pairs and keeps four-note total capacity. This avoids constructing a
second synth or bypassing the editor's PMON / Noise allocation. The existing
Copy JavaScript action still targets Playground's raw SnesSynth API.

The existing v1–v5 portable sound readers are unchanged. Current project settings
use their normalized sound; editable JSON Files retain their supplied bytes.
Project storage uses `tetorica-snes-synth-files` (schema 1), with the independent
fallback key `tetorica-snes-synth-project-v1` and a separate Code recovery journal.
The 16 MiB project budget reserves 256 KiB for the full sound / manifest.
Looper, Event Rec and SPC song playback are outside this step.

## Verification

```sh
node --test --test-concurrency=1 docs/synth-snes/*.test.mjs \
  docs/synth/synth_project_store.test.mjs docs/synth/synth_draft_store.test.mjs \
  scripts/package_itch_snes_synth.test.mjs
node scripts/check_snes_synth_browser.cjs
node scripts/package_itch_snes_synth.mjs REVIEW_VERSION
node scripts/check_snes_synth_code_browser.cjs --root EXTRACTED_ZIP --entry /index.html
```

- Node / real WASM / TypeScript / package checks: 164 pass, zero failures or skips.
- Existing instrument browser regression: Chromium + WebKit, 25 groups each.
- Packaged Files / Code: Chromium + WebKit, 8 groups each; real S-DSP output,
  liveFx, Run / Apply context, Code + keyboard, focus protection, BRR-authoring
  presets, Noise / PMON / Echo, save / reload, Cassette roundtrip and recovery
  after forcibly closing IndexedDB connections. No audio is started on restore.
- Browser tests block external URLs to exercise the textarea fallback. The
  selected declarations pass real TypeScript checks; downloaded Monaco itself
  is not exercised by these browser runs.
- Output is redirected through gain 0 before app scripts, with Chromium mute
  enabled. No human listening, desktop app or OS sound-setting changes.
- Standalone archive is built only inside the isolated checkout's release folder.
  Main release files are not replaced. No commit, push, tag, import or publication.

See [receipt](verification_snes_synth_files_code_20261114.json).
