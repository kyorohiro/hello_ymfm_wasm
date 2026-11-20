# DMG Code workspace alignment — 2026-11-20

Authorized after the working/saved Files rollout. Reuse FM2612/SPU's shared
expanded tabs and existing Code controls; do not add a separate runtime or
change the APU, mixer policy, saving semantics or timed-operation APIs.

- [x] Add a Code / Synth layout switch beside Files.
- [x] Expanded navigation uses Code / DMG APU / Keyboard. Keep expansion when
  selecting another view; only Restore or Synth returns to the normal layout.
- [x] Keep the existing Master accessible in expanded views, with one control
  and one audio gain route. Restore it to the header on returning to Synth.
- [x] Keep the existing editor/model, transport, Files selection, dirty edits,
  active Code context/loops/FX, Gate ownership and VGM Play/Pause position when
  switching layout or views. Merely showing Code never runs it.
- [x] Preserve keyboard playing outside text fields; use shared tab keyboard
  navigation and correct focus/ARIA state without swallowing shortcuts twice.
- [x] Verify normal/expanded/restored layouts at desktop and narrow widths,
  Monaco and fallback, source and a readable ZIP, Chromium and WebKit. Mute all
  physical audio output before application startup.
- [x] Record checks and update the DMG alignment checklist. Publication, remote
  CI, Tauri import and npm updates are outside this task.

Related: [Files rollout](todo_dmg_working_saved_20261120.md) and
[alignment backlog](todo_dmg_synth_fm2612_alignment_20261119.md).

## Implementation

The Files-adjacent **Code** button opens the expanded workspace. Its tabs are
**Code / DMG APU / Keyboard**, and all three keep the shared Run/Apply/Stop
transport and the same Master control available. **Synth** or **Restore Code**
returns to the normal layout, keeping the current input mode and performance.
This is a layout preference, not a second instrument or a new Code execution.

`code_host.js` opts into existing `persistentExpanded` controls and forwards
the view/layout notifications. `synth.js` reuses `setupSynthExpandedTabs` with
DMG element overrides, including the attached Master label. The original DOM
nodes move between their anchors; no editor, transport, slider or audio bus
is cloned. Page teardown restores the nodes before disposing Code controls.

## Completed validation

- `node --test docs/synth-dmg/*.test.mjs docs/synth/synth_expanded_tabs.test.mjs scripts/package_itch_dmg_synth.test.mjs`
  — **329/329 passed**. The separate existing shared controls/expanded-tabs
  suites also passed 50/50 in the read-only review (overlapping coverage).
- Readable package: `build/dmg-code-workspace-20261120/package/tetorica_dmg_synth_code_workspace_20261120_itch.zip`
  — 137 files, 88 readable modules; all 121 original source receipts match.
  SHA-256: `a6015e2946857068c0ae5096a25d0577574c829742f2ea9c8e09c4f7acbf06b7`.
  All safely extracted bytes match the packaged stage.
- `scripts/check_dmg_code_workspace_browser.cjs`: **8/8 cases, 56 stage checks
  passed**, source/extracted readable ZIP × Chromium/WebKit × real Monaco /
  fallback. Final evidence is `build/dmg-code-workspace-20261120/final/browser-matrix.json`
  with four detailed receipts and normal/expanded/restored screenshots at
  1360px and 390px. Monaco uses the existing pinned 0.52.2 local fixture.
- Verified three-tab order, arrows/Home/End/focus, persistent expansion,
  single Run shortcut, one original Master/transport/editor/model, Files dots
  and JSON/text working/saved versions, keyboard playing outside typing fields,
  unchanged native Gate/frequency/Wave RAM and Code client/context/loops/FX.
  Held output AC RMS stays approximately 0.008942 across views, and changing
  Master from 70% to 140% yields approximately 0.017884 without a second route.
  Paused VGM positions of 13,671–19,080 frames remain exactly unchanged.
- Every speaker connection was muted before startup. No physical listening,
  network access, missing/external resources, unexpected console/page errors
  or unhandled rejections. All browser processes ended after validation.
- `git diff --check` passed; no shared runtime, APU or project schema changed.
