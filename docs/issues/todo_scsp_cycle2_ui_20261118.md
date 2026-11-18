# SCSP Cycle 2OP selectable UI and readable routing - 2026-11-18

Base `ce9ffdf6206c12c176054b0c95d0cdf863e974e8`; worktree clean.
Complete the UI part of [the bounded design](scsp_synth_cycle2_design_20261118.md)
after instrument/Code and v11 persistence support.

- [x] Add FM2-only Cycle selection, explicit UI mode transitions and a separate
  forward/current vs history-return path without changing runtime semantics.
- [x] Reuse selected A/B ratio/Depth controls, expose each Cycle direct output,
  identify fixed inputs and explain Synth-only initialization behind `?`.
- [x] Preserve Custom/Self/dormant data and Code/manual/SSF ownership; map
  output changes into existing structural retirement and topology identity.
- [x] Add a readable Synth Cycle example using existing public Code methods.
- [x] Verify actual UI/Code/save/reload/keyboard transitions, narrow layout and
  legacy behavior with muted browsers; update necessary source/package proofs.

No arbitrary cycles, native/core/WASM/raw API/gain/default changes, new preset
schema beyond existing v11, npm/release/version/commit/push/tag or Tauri work.

Evidence: `build/scsp-cycle2-ui-20261118/` and
[verification](verification_scsp_cycle2_ui_20261118.md). Existing saved projects
are not reseeded; add the linked canonical example through Files if missing.

Completed: 444 tests, 16 source-browser checks plus 16 extracted-ZIP checks,
both Mixer generators, source/old-receipt checks and packaging pass. Audio was
permanently muted. The inherited README calibration mismatch is corrected with
an exact documentation predecessor; historical JSON and sound behavior remain
unchanged. Human listening remains separate.
