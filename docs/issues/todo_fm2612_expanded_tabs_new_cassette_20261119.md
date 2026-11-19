# FM2612 Synth expanded navigation and New Cassette — 2026-11-19

User requests a single navigation row while Code is maximized, ordered Code /
YM2612 / PSG / RF5C164 / 32X PWM / Mixer / Keyboard. Moving between these tabs
must retain maximized mode and running Code. Menu should offer New / Cassette
before Import.

- [x] Make maximized layout independent from the active content tab; reuse
  existing chip/Code/Keyboard controls and restore their normal placement.
- [x] Keep Code playing across tab changes, with correct focus, one selected
  tab, keyboard navigation, editor resizing and a usable Restore button.
- [x] Add New → Cassette · ZIP with fresh files/starter code and default sound;
  reuse existing workspace replacement, stopping, recovery and Undo behavior.
- [x] Preserve default shared Code controls behavior in other Synths.
- [x] Verify relevant unit tests, source/browser layouts, playback continuity,
  fresh workspace persistence and the readable standalone package.

No commit, push, signing or publication is requested.

## Verification

- `node --test docs/synth/*.test.mjs`: 712 tests passed. Shared controls keep
  their existing defaults; persistent expansion is enabled only for FM2612.
- `scripts/check_synth_expanded_tabs_browser.cjs`: Chromium and WebKit passed
  with the source textarea fallback, actual Monaco editor, and extracted itch
  ZIP. Checked seven-tab order, focus, desktop/mobile layout, live Code and PCM,
  Keyboard, Files, restore, New/Cancel/Undo, VGM stop and draft reload.
- Existing `scripts/check_synth_code_browser.cjs --checks=all` and
  `--checks=mixer`: both browsers passed. All browser checks used physically
  muted output; no listening was performed.
- Export remains available when IndexedDB is unavailable or a save fails;
  current Code and tone edits are included without requiring a durable draft.
- `sh scripts/package_itch_synth.sh expanded-tabs-cassette-20261119` created
  the readable standalone stage and ZIP, including `synth_expanded_tabs.js`.
  Its 478 local asset references passed validation. Final ZIP runtime bytes
  match the browser-tested extracted files; only `CODE.md` was updated afterward.

Local receipts: `/private/tmp/fm2612-expanded-source-fallback.json`,
`/private/tmp/fm2612-expanded-source-monaco.json`,
`/private/tmp/fm2612-expanded-zip-fallback.json`,
`/private/tmp/fm2612-expanded-legacy-code.json`, and
`/private/tmp/fm2612-expanded-legacy-mixer.json`.

## Follow-up: workspace switch, fresh Code and Master volume

- [x] Add Code / Synth layout switching beside Files; preserve running Code
  while entering or leaving the expanded workspace.
- [x] Keep the same Master volume control available in expanded Code and restore
  its normal placement when returning to Synth.
- [x] Reproduce and fix the empty `index.js` seen after New Cassette, including
  first-open behavior with actual Monaco and saved starter content.
- [x] Check what the Code / Save code / Revert file controls actually do and
  correct any misleading or disconnected behavior.
- [x] Verify source and standalone ZIP with muted browser audio, plus relevant
  shared-controls and Files regressions.

The empty starter was reproduced with real Monaco: New wrote the correct file,
but opening the same path reused its cleared, cached editor model. Explicit file
opens now reconcile that model with the authoritative file source, before a
Save or Run can write an empty editor back over the starter. Existing authored
files are retained. The regression also covers same-path Cassette import.

`Code` is a document status label. Save code flushes the current source; it does
not execute or Apply a performance. It now shows transient `✓ Saved` feedback,
and a failed local save does not report success or discard the recovery journal.
Revert uses instrument checkpoints and is hidden during Code editing; no new
Code checkpoint feature was added. Header Synth restores focus to its header
button instead of scrolling down to the embedded Code editor.

Follow-up verification: all 720 Synth unit tests passed. Source fallback, real
Monaco and final extracted ZIP each passed 10 browser scenarios in Chromium and
WebKit. Master 100 → 50 → 0 → 100 changed actual PCM levels while the loop kept
advancing; first New/open/save and same-path Cassette import retained their full
source. Header focus and viewport, Save feedback, mobile layout and original
slider restoration passed with zero browser errors or missing assets. All
physical speaker routes were muted.

Final package: `release/hello_ymfm_wasm_workspace-switch-cassette-20261119_itch_synth.zip`;
all 304 files matched its browser-tested extraction. Receipts:
`/private/tmp/fm2612-layout-v2-source-fallback.json`,
`/private/tmp/fm2612-layout-v2-source-monaco.json`, and
`/private/tmp/fm2612-layout-v2-zip-fallback.json`.
