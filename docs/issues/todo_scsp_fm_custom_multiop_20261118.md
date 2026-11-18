# SCSP Synth custom 4/6OP and two-input routing — 2026-11-18

User approved extending Custom routing through 4OP to 6OP.
Base `81f5e7e591e4fdbf6f375ea97061eb6c514f3e97`; worktree was clean.

- [x] Generalize validated custom graphs to 2/4/6 operators, maximum two
  distinct sources per operator, independent outputs and deterministic
  dependency-ordered physical slots; reject cycles/self references atomically.
- [x] Preserve existing single-input behavior; two inputs follow the SCSP
  sound-stack average. Verify against real hardware-core source / WASM output.
- [x] Add compact Input X / Y controls, active-operator choices, output and
  diagram updates, preserving keyboard focus and stale-edit ownership guards.
- [x] Resize implicit custom graphs on mode changes: grow with disconnected
  operators; shrink by removing references to removed operators. Explicit
  mismatched graphs remain errors. Document this software conversion.
- [x] Preserve legacy/default/2OP state and presets; save new 4/6OP custom
  instruments without silent down-conversion. Support Code and Files/project
  restore with appropriate declarations.
- [x] Verify branch/merge/multiple outputs, slot mapping, live source controls,
  DSP sends, allocation/steal/release, Code/manual coexistence, preset/idle
  migration, rejected edits and unchanged legacy PCM.
- [x] Verify muted source/ZIP browsers, narrow layout, source provenance,
  source-preserving standalone packaging and restart records.

Decisions: keep `fm.custom:{inputs:[...],outputs:[...]}`; inputs have the active
operator count, 0..2 unique source IDs each. No self/cyclic feedback in this
milestone. A single source is duplicated into hardware X/Y (unchanged); two
sources are averaged by the chip. Input Y is available after X is selected.
Automatic graph resizing is Synth software; raw physical-CH controls remain
unchanged. Existing global MDL and per-operator ratios remain in use.

No npm publication / package version bump, common-runtime or WASM changes,
parent commit/push/tag, other Synth or Tauri work are requested. Preserve old
JSON evidence and calibration gains; automated browser outputs stay muted.

Completed: 344 Synth/packaging tests, 55 guard tests, 66 exact legacy cases,
six parity recorders and both Mixer generators pass. Source and exact ZIP
pass Chromium/WebKit at 48 kHz with permanent mute. See
[verification](verification_scsp_fm_custom_multiop_20261118.md) and
[machine evidence](verification_scsp_fm_custom_multiop_20261118.json).
Manual listening is still a user check. Individual MDL and cyclic feedback
remain in [the broader FM follow-up](scsp_fm_followup_01.md).
