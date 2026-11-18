# SCSP Synth single Self in Custom4/6 — 2026-11-18

Base `d76285ad`; worktree was clean. User approved extending the proven
Custom2 single-operator Self to Custom4/6, including Code, UI and persistence.

- [x] Extend graph validation to one Self OP in Custom2/4/6. Self exclusively
  uses its two X32/Y0 history taps; other OPs retain up to two external sources
  in Custom4/6. Reject double Self, Self plus another input at that target,
  duplicate inputs, general multi-OP cycles and malformed graphs atomically.
- [x] Preserve dependency order, physical allocation, owned-history attack
  initialization, live depth edits, release/steal and DSP/manual/Code owners.
  Implicit resize preserves surviving Self edges and drops removed operators.
- [x] Expose one Self choice in Input X for A–F, disable Input Y for that
  target, and show the existing Self loop/hint. Selecting Self replaces that
  target's external inputs; explicit invalid Code graphs still reject.
- [x] Keep v8 strictly Custom2 Self. Use v9 for Custom4/6 Self, preserve old
  non-self v4–v7 exports and v1–v8 rejection/compatibility rules. Update types,
  help and a readable fresh-project Code example.
- [x] Verify real WASM at 44.1/48 kHz with independent explicit physical-slot
  fixtures, including every Self target, merge/fan-out and prior 2OP behavior.
  Keep existing runtime/core/WASM/gains and historical JSON unchanged.
- [x] Verify muted source/exact-ZIP Chromium/WebKit, legacy regressions,
  packaging/source receipts and local CI commands. Record restart evidence.

No general cycle engine, multiple Self OPs, adjustable feedback delay/gain,
common runtime/core changes, npm publication/version bump, commit/push/tag,
Tauri or other Synth changes. Physical output remains muted. The pinned
zero-slot-delay core is not a claim of full physical SCSP pipeline fidelity.

Evidence directory: `build/scsp-multi-self-feedback-20261118/`.

Completed checkpoint: backend/API frozen, focused 105 tests pass. New coverage
includes 120 explicit actual-WASM comparisons: all 10 Custom4/6 Self targets,
merge/fan-out or disconnected topology, MDL 0/1/12 and 44.1/48 kHz output.
Synth/packaging pass 400 tests; post-visual Y0 label correction passes the
8 view/example checks again. Types pass 2 tests. Source/exact-ZIP browser
verification passes 72 cases at 48 kHz with permanent physical mute.
110 actual before/after cases, 81 proof tests, 15 recorders and both Mixer
generators pass. Independent actual-Git reconstruction and 110 rerenders match.
Receipt object pin:
`cda0b7cb5530bf18ade132858323c44a344802e4ec5ec39191af3b4748ef835c`.

All 381 ZIP entries, 152 comparable served files and 353 original source inputs
match. See the [verification record](verification_scsp_fm_multi_self_feedback_20261118.md).
Only listening, physical pipeline comparison and future general-cycle/multiple
Self work remain. No implementation remains for this bounded extension.
