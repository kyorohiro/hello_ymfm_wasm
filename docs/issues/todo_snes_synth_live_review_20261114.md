# S-DSP Files / Code: live editing and actual Monaco review

Follow-up to the Files / Code implementation committed as `8bb38639`.
This work is applied directly to the main checkout for normal Git review.

- [x] Keep Code and a manual key held while editing level, Envelope and Echo.
- [x] Exercise drawn Wave, supplied BRR, Noise, Wave PMON and BRR PMON;
      edit BRR tuning, Noise clock and PMON ratio in their applicable modes.
- [x] Check original note identities and DSP generation survive these live edits.
- [x] Check voice stealing followed by an old manual key-up retains the new owner.
- [x] Verify Cassette keeps both BRR payloads, all edited settings, Code and binary
      assets; restore after reload and after an IndexedDB connection closes.
- [x] Use actual Monaco and its language worker for completion, typed errors,
      mixed JSON / JavaScript editing, source navigation, save / reload and Run.
- [x] Verify actual editor text/layout at 1240 / 390 px and inspect screenshots.
- [x] Run focused Node / package regressions and both packaged browser checks.

## Fix

The S-DSP Code declarations use the app-specific `SnesCodeClient`, but the shared
source viewer had no mapping for it. Its Go to Definition dialog could show the
declaration without offering the actual note / state implementation. Added the
mapping to `synth-snes/code_client.js` for noteOn, noteOff, getState, allNotesOff
and dispose. Existing raw Playground SNES mappings remain in place. A failing
regression first demonstrated the missing target; all five targets now resolve.
Updated the module cache identities along the SNES editor import chain.

## Verification

```sh
node --test --test-concurrency=1 docs/synth-snes/*.test.mjs \
  docs/playground/playground_monaco*.test.mjs \
  docs/synth/synth_code_controls.test.mjs scripts/package_itch_snes_synth.test.mjs
node scripts/check_snes_synth_code_browser.cjs --root EXTRACTED_ZIP --entry /index.html
node scripts/check_snes_synth_code_monaco_browser.cjs --root EXTRACTED_ZIP --entry /index.html
```

- Node / actual WASM / TypeScript / shared source-viewer / package checks:
  216 passed, zero failures or skips.
- Packaged live editing: 13 groups per browser, Chromium and WebKit. Five source
  configurations retain two held owners and the same DSP generation during
  edits. Measured PCM is finite and nonzero. Cassette comparison checks exact
  carrier and modulator BRR strings, all edited settings and an opaque binary.
- Actual packaged Monaco: six groups per browser, Chromium and WebKit. Its real
  JavaScript worker accepts SNES Code and rejects unsupported factories / chips,
  raw DSP methods and lane 8. Go to Definition / View implementation open the
  shared runtime and actual S-DSP performance facade. Editing and reselecting
  JSON applies the new sound without losing the JavaScript file.
- The tests use fresh browser profiles and self-authored BRR. They do not modify
  user presets, browser storage, Tauri repositories or operating-system audio.
- Speaker destinations are intercepted before app scripts and connected through
  gain zero; Chromium also uses --mute-audio. Human listening is not performed.
  Finite PCM and retained owners do not establish subjective sound quality.
- The standalone verification ZIP is under /private/tmp, not the release folder.
  No version, commit, tag, import, push or publication is performed.

Receipt: [verification_snes_synth_live_review_20261114.json](verification_snes_synth_live_review_20261114.json).
