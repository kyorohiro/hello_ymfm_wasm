# SID Code workspace alignment — 2026-11-21

Authorized after working/saved Files. Reuse the existing shared Code controls
and expanded-tabs helper, as in FM2612 / DMG. Do not add another editor, audio
runtime, MIDI/recording facility, renderer, mixer policy or timed SID API.

- [x] Add Code / Synth layout controls beside Files.
- [x] Expanded tabs are Code / SID / Keyboard. Preserve expansion across view
  changes; only Synth or Restore returns to the normal layout.
- [x] Move the original Master into the expanded workspace and back, keeping
  one slider, transport, editor/model and audio output route.
- [x] Preserve Files selection, working/saved content, dirty markers, Code
  context/loops/FX, manual Gate ownership and SID Play/Pause position. Showing
  another view must not run Code or stop a performance.
- [x] Preserve keyboard playing outside text fields and use shared tab/focus/
  ARIA behavior without duplicate Run/Apply shortcuts.
- [x] Verify normal/expanded/restored desktop and narrow layouts, source and
  actual readable ZIP, Chromium/WebKit and Monaco/fallback with all physical
  output muted before startup.
- [x] Record checks and update alignment. No publication, npm update, Tauri
  import, commit/push/tag or remote CI is requested.

Reference: [SID alignment](todo_sid_synth_fm2612_alignment_20261119.md),
[Files rollout](todo_sid_working_saved_20261120.md),
[DMG workspace](todo_dmg_code_workspace_20261120.md).

## Implementation

The Code button beside Files opens the existing editor in an expanded workspace.
Its tab order is Code / SID / Keyboard. All three views retain expansion and
share the original Master and Run / Apply / Stop transport. Synth or Restore
returns to the normal layout without changing the input mode or performance.

The SID host enables the existing persistentExpanded control policy and forwards
view/layout events to setupSynthExpandedTabs. The SID-specific element overrides
refer to the original editor wrapper, chip tab and attached Master label. Existing
DOM nodes move between anchors; the same Monaco model or textarea, transport,
slider bindings and audio graph remain. A dedicated input-heading wrapper keeps
keyboard/Code panels visible when their old heading is hidden. Teardown restores
the nodes before disposing Code controls. No project schema, core, shared runtime,
mixer policy or timing API changed.

## Local checks — 2026-11-21

- `node --test docs/synth-sid/*.test.mjs docs/synth/synth_expanded_tabs.test.mjs scripts/package_itch_sid_synth.test.mjs`:
  **336/336** passed. New SID workspace tests use the actual SID HTML hierarchy
  and real shared expanded-tabs helper, and check order, focus/ARIA, one original
  Master/transport/editor/Files tree, restore/disposal and host event forwarding.
  Existing audio/ownership assertions remain intact; only the new layout dependency
  was supplied to their isolated VM fixture.
- Existing shared Code controls tests: **39/39** passed separately.
- Readable ZIP built and passed dependency/source-provenance checks:
  `build/sid-code-workspace-20261121/package/tetorica_sid_synth_code-workspace-20261121_itch.zip`,
  **346 files**, SHA-256
  `56c97ab2048d770f18137fbd058d7d19f2b10428359675adee296ff781a6ef6c`.
  All regular entries were safely extracted for actual ZIP verification.
- `scripts/check_sid_code_workspace_browser.cjs`: **8/8 cases, 56 stage checks**
  passed for source/extracted ZIP × Chromium/WebKit × real Monaco/fallback.
  Final evidence is `build/sid-code-workspace-20261121/final/browser-matrix.json`
  and its four explicit `*-final.json` reports. Provisional reports are excluded
  from signoff. Checker SHA-256:
  `fbf313151de524ffc88be1aacebe4bc54930e8d826bd5cd1d350d69ad5f2e7ff`.
- Verified Code / SID / Keyboard tab order, ARIA and arrows/Home/End/focus,
  persistent expansion and restoration, single execution shortcut, one original
  Master/editor/model/transport, Files selection/dots and both versions, keyboard
  playing outside typing fields, unchanged native model/registers/Gate/frequency
  and retained Code client/context/loops/preparations/FX. Master 70→140% produced
  PCM ratios **1.9953–2.0075**, with one gain route. SID Pause positions
  **16128–24832 frames** remained exact; ongoing Play also continued through
  layout/view changes with no autorun.
- 1360px and 390px normal/expanded/restored screenshots fit in Monaco and fallback.
  Final source and ZIP served 19 byte-identical SID application JavaScript modules.
  Physical speaker paths were muted before startup. No external network, missing
  resources, unexpected console/page errors or unhandled rejections occurred.
  Desktop Code and narrow SID screenshots were also visually inspected.
- `git diff --check` passed. All actual browser speaker connections are muted
  before startup; numeric output checks do not replace human listening.

## Next separate work

SID build / compile / schedule / captureState remains the next chip-level API
slice. Output-only channel switches and Live highlighting remain on the alignment
backlog. Looper / Event Rec remain explicitly deferred. No public release, npm
publication, Tauri import, remote CI, commit/push or tag was performed.
