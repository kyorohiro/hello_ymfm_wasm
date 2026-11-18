# SCSP Cycle 2OP portable presets and saved authoring - 2026-11-18

Base `6ca7c946bba5c8a84610dd4b3b7542e71562f89f`; worktree clean.
Continue the [bounded integration design](scsp_synth_cycle2_design_20261118.md)
with persistence first, before the selectable Cycle UI and return-path display.

- [x] Implement explicit v11 FM2/Cycle presets with all source PCM/voice/effect
  data; preserve v1-10 validation and exact existing export-version selection.
- [x] Enable actual edited Cycle authoring cache, Files/preset/JSON/Cassette and
  local draft/recovery paths; remove the temporary Phase-1 save restriction.
- [x] Update Code declarations and meaningful real-WASM roundtrip/invalid-input
  and compatibility tests, including running Code and manual/source changes.
- [x] Verify real browser saves, reload/no-autoplay, sound recovery and normal
  preset interoperability with permanently muted output.
- [x] Preserve historical measurement JSON/defaults/runtime/core/WASM/gains;
  check source proofs and packaging, then record completed and remaining work.

No new Cycle UI selection/graph controls, arbitrary cycles, shared core or raw
API change, version/publication/release/commit/push/tag or Tauri work.

Results: 437 SCSP/package tests, shared runtime types, 16 exact preset
roundtrips, 206 prior/current parity cases and 20 muted browser checks pass.
See [verification](verification_scsp_cycle2_presets_20261118.md).
