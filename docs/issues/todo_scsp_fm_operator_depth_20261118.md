# SCSP Synth per-operator FM depth — 2026-11-18

User approved per-operator MDL, keeping the global control as a batch edit.
Base: `688a225f` (Custom 2/4/6OP); worktree was clean.

- [x] Record and validate optional six-entry `fm.depths` (A–F, 0..12).
  Absent values use the existing common depth. A scalar-only depth edit sets
  all operators; an explicit array overrides that batch value. Uniform arrays
  normalize to the legacy scalar representation.
- [x] Apply receiving-operator MDL to new, held and releasing groups through
  their own operator/slot mapping. Preserve Code, physical owners, DSP state,
  existing routing and atomic rejection. X/Y share the receiving OP's MDL.
- [x] Add selected-OP Depth with the existing numeric button UI, compact mixed
  state feedback for the batch control and focus-safe editing. Include fixed
  and Custom FM; retain physical-CH / SSF edit behavior.
- [x] Keep legacy v1–v6 audio and default export unchanged. Use v7 only when
  individual values are needed; restore portable presets and idle projects.
- [x] Update Code declarations, README and source/cache references. Do not add
  another performance API: use existing `setConfig({fm:{depths:[...]}})`.
- [x] Verify independent real-WASM output, shared X/Y depth, mapping, release,
  ownership, global reset, invalid arrays/getters, migration and preset roundtrip.
- [x] Verify source and standalone ZIP in muted Chromium/WebKit, narrow layout,
  old audio/calibration proofs and durable restart evidence.

MDL is SCSP hardware; the editor's A–F mapping and batch control are software.
No per-edge depth is implied: two sources are averaged before one common MDL
at their destination. Self/cyclic feedback is a separate follow-up.

No npm publication/version bump, common-runtime/WASM changes, parent commit,
push/tag, other Synth or Tauri edits. Preserve historical proof JSON/gains.
Automated browser output stays permanently muted; listening is a user check.

Completed: 358 Synth/packaging tests, 62 proof/guard tests, exact 66-case legacy
comparison, seven parity recorders, both source-receipt checks and both Mixer
generators pass. Source/ZIP Chromium and WebKit pass eight cases each at 48 kHz.
See [verification](verification_scsp_fm_operator_depth_20261118.md) and
[machine evidence](verification_scsp_fm_operator_depth_20261118.json).
Next design work remains feedback/history behavior in the broader FM TODO.
