# Synth / Code physical slot allocation view - 2026-11-18

Base `e74d3a23`; initially clean worktree. Extend the existing 32-slot selector
and selected-route area from SSF observation to the authored Synth machine.

- [x] Read the existing detached `voiceGroups`, `manualVoices`, per-group
  operator mappings and requested slot/DSP settings without changing owners,
  audio/core, allocation, sample transport or the public Code API.
- [x] In Auto, follow the latest allocated group; selecting a physical CH
  highlights that group's slots and shows its keyboard / logical Code owner,
  note and A–F-to-physical-CH mapping. Preserve the one existing selector.
- [x] Show selected-group modulation and physical Direct / MIXS sends. Retain
  Custom reordered operators, Self history and Cycle current/history meaning;
  show raw references instead of inventing edges after physical overrides.
- [x] Distinguish requested held / released ownership from native envelope
  phases or audible activity. Retained released groups are not claimed free.
  Stolen/replaced groups and stale Code lanes must not remain highlighted.
- [x] Preserve editor / keyboard targets, Code continuity, physical ownership,
  SSF Live / Pause / audition / Capture, focus and narrow layout. Keep long
  explanations behind `?`; use the existing route area rather than extra CHs.
- [x] Verify model, stable DOM and real muted browser workflows, then the
  extracted ZIP and exact source/Mixer freshness proofs; record results.

No new native observation, allocation behavior, sound/volume change, preset
format, arbitrary hardware topology inference, npm/release/version/commit/
push/tag or Tauri work. Human listening remains separate.

Completed: 462 unit + 2 deterministic package tests, 14 source and 14 extracted
ZIP browser scenarios, 16 existing SSF browser scenarios, 26 source-proof tests,
six source recorders and both Mixer generators pass. Physical output remained
muted. See [verification](verification_scsp_synth_slot_allocation_20261118.md)
and evidence under `build/scsp-synth-slot-allocation-20261118/` /
`build/scsp-synth-slot-allocation-browser-20261118/`.
