# HuC6280 persistent Code workspace — 2026-11-19

Authorized next slice of the
[HuC6280 alignment](todo_huc6280_synth_fm2612_alignment_20261119.md).
The [working/saved slice](todo_huc6280_working_saved_20261119.md) is complete.

- [x] Add header Code / Synth buttons beside Files, using the existing editor
  and Code controls rather than creating another model or runtime.
- [x] In expanded Code layout, offer Code / HuC6280 / MSM5205 / CD-DA / Mixer /
  Keyboard tabs. Preserve expansion while switching views, and restore the
  ordinary Synth layout explicitly with Synth or the restore button.
- [x] Keep Master accessible in Code, chip, Mixer and Keyboard views. Preserve
  the same gain control and source graph, including >100% boost indication.
- [x] Tab/layout changes must not stop Code or VGM, change the selected CH,
  unify channel settings, reload media or accept working files. Preserve the
  existing keyboard-focus and media-key release rules.
- [x] Restore editor size/focus, tab selection and DOM ownership after layout
  changes. Support keyboard tab navigation and settled 390px / desktop sizes.
- [x] Test source and the exact readable ZIP with fallback and actual Monaco in
  Chromium / WebKit. Use physically muted output and record numeric checks;
  do not claim human listening or long-duration testing.
- [x] Update README, alignment progress and the verification receipt.

No Live highlighting, shared CH mixer expansion, new PCM editing, recording,
timed-register APIs, npm publication, Tauri import, commit or release is part of
this slice. The existing saving behavior, raw chip APIs, source calibration and
Code / VGM mutual exclusion remain unchanged.

## Implementation

- Reuse `setupSynthExpandedTabs()` with a narrow editor/chip-tab override;
  FM2612 keeps its default DOM IDs, tab order and optional Master relocation.
  No second Code model, runtime, audio context or source player is created.
- HuC6280 keeps its original Master in the header. A mounted main column holds
  the expanded tab/transport slot, existing instrument wrapper and existing input
  section. Restoration anchors return the same controls to their original places.
- Set the existing Code host's `persistentExpanded` option and forward its view /
  expansion notifications. Existing chip selection remains responsible for
  hardware view, keyboard routing and media-key cleanup; layout is independent.
- Shared controller tests pass 10/10, including the original FM cases and HuC
  overrides/navigation/restoration. Full HuC + shared controls/expanded tests pass
  **727/727** with `node --test --test-concurrency=4`.
- The initial unconstrained parallel run exposed an existing producer/heard-state
  timing-sensitive assertion in `song_manual_preview.test.mjs` (frame-zero volume
  0 rather than 31). Its focused nine tests and the bounded complete suite pass;
  no song player, test assertion, DSP, WASM or gain calibration was changed.

## Verification

[Recorded source / exact-ZIP verification](verification_huc6280_code_workspace_20261119.json).
Chromium/WebKit × fallback/real Monaco × source/extracted ZIP pass **8 cases,
64 scenario groups and 224 settled layout screenshots**. All use one frozen
checker hash. The same editor/model, Code context/livePrepare values, loops,
selected CH, native registers, wave RAM and shared source graph survive switching
all six tabs. Unsaved source and saving mode survive the layout changes; Save
shortcuts work without executing Code.

- Code PCM remains finite/nonzero and stable across tabs; the same Master input
  accepts 175% and shows its existing boosted color while changing actual output.
- MSM5205/CD-DA keyboard triggers borrow their existing players; subsequent tab
  switches do not load media or create contexts/Worklets. Normal media-key cleanup
  rules remain intact.
- VGM stays playing with positive PCM across the tab cycle. Pause retains its
  exact frame and selected CH through Code/chip/Mixer/Keyboard and restoration.
- All views fit settled 390px/1360px layouts with Files open/closed; actual Monaco
  remains sized and editable after moving/restoring. Visual review also removed
  the inherited redundant border/top gap below the expanded transport.
- No unexpected console/page errors, promise rejections, missing assets or
  unexpected external requests. Raw console errors are retained; only pinned
  Monaco loader requests deliberately aborted for fallback are permitted.
  Real Monaco has zero raw console errors and failed CDN requests.
- Physical output is muted before app startup. These are numerical audio checks,
  not human listening or long-duration verification.

Readable verification archive:
`release/tetorica_huc6280_synth_code_workspace_check_20261119_2_itch.zip`
(204 files, 2,170,307 bytes), SHA-256
`a82c800a2555d81ed889d203f0397750222430f56bffb88199b9f18f53b40c51`.
Its builder records no minification/bundling, and the changed UI/host/controller
modules match source byte-for-byte. Tauri import and publication were not run.
