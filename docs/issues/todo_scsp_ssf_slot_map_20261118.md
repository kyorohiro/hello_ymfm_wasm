# SSF 32-slot activity and selected-slot routes - 2026-11-18

Base `e585c879`; initially clean worktree. Make the playing SSF machine easier
to inspect using its existing audible-position snapshots. This follows the
32-slot overview discussion; arbitrary SSF is not a Synth A/B template.

- [x] Reuse the existing Auto / CH1–32 selector as the single slot overview.
  Distinguish observed activity, Gate and Release, with labelled ENV strips;
  do not present these as measured audio output or inactive slots as free.
- [x] Show the selected SSF slot's configured Sound Stack X/Y references,
  receiving MDL, write inhibition, Direct level/pan and MIXS input/send.
  Retain raw offsets, including repeated references and renderer limitations;
  do not infer immediate CH producers or a per-slot DSP return.
- [x] Follow Play snapshots, freeze at Pause, and preserve current channel
  selection, keyboard audition, editable parameters and Capture behavior.
  Live Off / Stop restores the authored view; reading never writes registers.
- [x] Keep detailed caveats behind `?`, retain readable narrow layouts and
  keyboard focus, and avoid a second 32-CH picker or permanent long help.
- [x] Verify model/DOM behavior, actual muted SSF Play/Pause/Resume/selection,
  existing editor/Code behavior and extracted distribution; refresh the
  narrowly scoped source/package proofs and record results.

No new observer ABI, core/WASM/audio/gain changes, topology inference, runtime
tracing, preset schema, release/npm/version/commit/push/tag or Tauri work.
Human listening and hardware fidelity remain separate from muted verification.

Completed: 454 unit/package tests, 16 source and 16 extracted-ZIP browser cases,
16 existing channel-browser cases, 13 source-proof tests, all source recorders
and both Mixer generators pass. Physical output stayed permanently muted.
See [verification](verification_scsp_ssf_slot_map_20261118.md) and evidence in
`build/scsp-ssf-slot-map-20261118/` / `build/scsp-ssf-slot-map-browser-20261118/`.
