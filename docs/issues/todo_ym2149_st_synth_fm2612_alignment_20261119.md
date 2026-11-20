# ST YM2149 Synth — FM2612 interaction alignment

Recorded: 2026-11-19; Code workspace slice implemented 2026-11-21.
After the initial HuC6280 → SPU → DMG → SID group, the user prioritized timed
APIs and Code / Synth workspaces over further highlighting. This ST layout
slice is authorized; missing Files/optional rows below remain separate work.

## Current comparison

| FM2612 reference feature | ST YM2149 status and source evidence |
| --- | --- |
| Working/saved with explicit Save | **Missing.** [code_project.js](../synth-ym2149-st/code_project.js) retains a single filesystem/v1 snapshot. [code_files.js](../synth-ym2149-st/code_files.js) has autosaved local edits and Ctrl/Cmd+S, but no separate accepted version, Auto apply, dirty dots, Save all/Discard, saved-only Run/Apply or dual-version Cassette. |
| Selected instrument file and controls | **Partial.** Readable JSON instruments can be selected/edited in Code. `markSoundDirty()` updates current project settings and clears preset selection; `saveSound()` writes a new preset path rather than maintaining a working version of the selected sound document. |
| Undo files and project replacement | **Partial.** New Project with defaults/examples, cancel/export/rollback and project import exist; successful operations have no FM2612 Files Undo history. Preserve [completed New Project work](todo_ym2149_st_synth_20261116.md). |
| Persistent expanded Code workspace | **Implemented 2026-11-21.** Header Code / Synth controls, persistent Code/YM2149/Mixer/Keyboard tabs, one original Master/editor/transport and retained performances. See [verification](todo_ym2149_st_code_workspace_20261121.md). |
| Live changed-value highlight | **Missing.** Auto update/reference observation exists, but no FM2612-style bounded changed-value flash and On/Off preference are wired in [synth.js](../synth-ym2149-st/synth.js). |
| Shared output mixer channel switches | **Partial.** [index.html](../synth-ym2149-st/index.html) has YM2149 chip gain and Master. It lacks independent output-only CH1–3 switches shared by Keyboard/Code/reference. Hardware Tone/Noise gates and fixed/envelope volume are not substitutes. |
| PCM editor / Start / Loop ranges | **Not applicable to the base hardware.** YM2149 has no PCM sample RAM. The existing volume-register sample example is software-timed register playback, not an absent PCM instrument editor. |
| Looper / Event Rec | **Optional, not implemented as user-facing recorders.** Existing live loops are Code scheduling, not Looper/Event Rec capture. |
| Timed build/schedule/compile/capture | **Present.** [code_audio.js](../synth-ym2149-st/code_audio.js) exposes `build`, `compile`, `captureState`, `schedule` and `clearSchedule`. [code_examples.js](../synth-ym2149-st/code_examples.js) demonstrates buzzer, modulation and volume samples. Preserve this API rather than putting it back on the missing-feature list. |

## Proposed implementation stages

- [ ] Adopt the shared working/saved workspace; migrate v1 projects, presets,
      edited examples, original VGM/YM/SNDH files and metadata without loss.
- [ ] Add default-On Auto apply, filename ●, Save/Save all/Discard and the existing
      Ctrl/Cmd+S route. Link selected-sound controls and JSON Code editing to one
      working file; validate sound JSON before applying it to the instrument.
- [ ] Keep Code running during sound acceptance and source saves. Apply only
      intended register changes; preserve the current R7 Tone/Noise companion
      bits, shared noise/envelope state and per-channel note ownership. Avoid
      an unintended R13 envelope retrigger when its value was not edited.
- [ ] Make explicit Run/Apply consume saved entry/modules/data; Save must never
      execute source or schedule a timer pattern. Keep working text editable.
- [ ] Export normal saved files plus versioned working differences and mode;
      preserve both through storage journals, reload, rename, import/New and
      Files Undo. Storage failure must not erase accepted or working content.
- [x] Add persistent Code/YM2149/Mixer/Keyboard navigation with header Code–Synth
      and visible Master, preserving the currently running reservations and FX.
- [ ] Add bounded changed-value highlighting, default On and switchable Off;
      distinguish this display preference from Auto update and chip operation.

## Optional work requiring its own decision

- [ ] Design output-only CH1–3 switches that retain oscillators, noise and shared
      hardware envelope timing. Decide how the setting follows reference playback
      without calling Tone/Noise gates an output mute.
- [ ] Revisit Looper/Event Rec only after a separate product decision.
- [ ] Preserve the existing timed API, including current/client/reset/reusable
      snapshot compilation, Worklet sample timing, repeated R13 writes, named
      atomic replacement/cancellation and Run/Apply/Stop ownership. New cross-chip
      scheduling features need their own design; do not add a generic PCM editor.

## Required validation when implementation starts

- [ ] Test both-version text/binary Cassette round trips, invalid JSON, compound
      Save all, rename/Undo/New/import, quota/reconnect and journal recovery.
- [ ] Verify ongoing timed reservations, buzzer and volume-sample examples while
      editing/saving files; compare intended R7/R13 writes and note ownership.
      Keep 44.1/48 kHz timing behavior and immediate APIs unchanged.
- [ ] Verify source and readable standalone ZIP in muted Chromium/WebKit, fallback
      and real Monaco, including keyboard shortcuts/focus and settled desktop/
      390px expanded/restored layouts. Record numerical checks separately from
      any future listening or long-duration session.

References: [ST Synth and completed timed examples](todo_ym2149_st_synth_20261116.md),
[FM2612 saving baseline](todo_fm2612_working_saved_20261119.md),
[implemented Code workspace](todo_ym2149_st_code_workspace_20261121.md).
No publication, Tauri import, commit, push or tag is part of this checklist.

## Timed register API follow-up

YM2149 ST already provides the reference API; do not reimplement it.
Follow the [shared timed-API contract](todo_synth_timed_register_api_20261119.md).

- [x] Existing timed API recorded as supported; this is not a new verification run.
- [x] Preserve build/schedule/compile/captureState/clearSchedule during the workspace port. Existing AY timed regression tests passed 91/91; live moving reservations and snapshot compilation were checked through the new views.
- [x] Retain existing R7/R13 resolver semantics and buzzer/volume examples during the layout port; no chip/runtime timing code changed. Future Files migrations must keep these checks.
- [ ] Apply the shared compilation/snapshot, ownership, atomicity, type/example
  and 44.1/48 kHz verification checklist to this chip when the work is authorized.
