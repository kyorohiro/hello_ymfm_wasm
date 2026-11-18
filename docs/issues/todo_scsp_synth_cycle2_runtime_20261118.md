# SCSP Synth Cycle 2OP instrument and Code implementation - 2026-11-18

Base `b92ee48e146a011d10e383dcbc2954626cccec1c`; worktree clean.
Implement Phase 1 of [the bounded design](scsp_synth_cycle2_design_20261118.md).

- [x] Add FM2-only `algorithm: 'cycle2'`, explicit outputs and A-before-B
  mapping, fixed measured taps; preserve Custom DAG/Self behavior and defaults.
- [x] Add four-cell new-attack initialization, unchanged live history,
  validated ownership/steal/manual takeover, release/Stop and fatal commit errors.
- [x] Expose the configuration through existing Synth Code calls and types;
  preserve old preset gates and handle the Phase-1 persistence boundary clearly.
- [x] Test all 13 pairs against independent direct-register real-WASM references;
  history scope, invalid requests, lifecycle, resampling and regressions.
- [x] Verify actual Code/Worklet integration with physical output muted, update
  only necessary source proofs and record results/remaining work.

UI selection and portable v11 preset support are Phase 2, not this task.
No shared SCSP core/WASM/low-level API/gain/default/preset migration changes,
new npm version/publication, release/tag/commit/push or Tauri work.

Phase-1 persistence boundary: active Cycle JSON export/sound save rejects.
Code drafts/project export retain JavaScript plus the last portable base sound;
manual edits made during Cycle are not persisted yet. The existing source
controls remain usable and a disabled Code-only label identifies the connection.

Evidence: `build/scsp-synth-cycle2-runtime-20261118/` and
[verification](verification_scsp_synth_cycle2_runtime_20261118.md).

Completed: 429 SCSP/package tests, shared runtime types, 260 independent
Cycle PCM/stack comparisons, 166 unchanged legacy scenarios and 14 actual
Chromium/WebKit browser checks pass. Physical output was permanently muted.
Source guards reconstruct exact predecessors; prior measured JSON remains
unchanged. Phase 2 UI/v11 and human listening remain open.
