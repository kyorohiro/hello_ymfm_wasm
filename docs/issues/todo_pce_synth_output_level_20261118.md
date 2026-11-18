# PC Engine Synth output level — 2026-11-18

User reports quiet output after the SCSP application-level fix. Investigate
this Synth independently: its explicit native balance is already unity, but
the source Mixer starts from the common calibrated HuC6280 value of 0.44.

- [x] Measure default Wave / Noise / DDA and polyphony through the actual
  unchanged WASM, including calibrated source mix and Master. Identify the
  application-only correction from evidence rather than copying SCSP's 8x.
- [x] Improve standalone HuC output with a source-only factor of 4 while
  preserving common Mixer defaults, native rendering and wave/PCM data.
  Apply it once to keyboard/Code/audition and VGM's HuC component. MSM5205 and
  CD-DA retain their levels. The factor precedes shared Code FX and therefore
  raises HuC FX drive; do not claim the global post-FX semantics of SCSP.
- [x] Verify source mute / volume, Master zero/default/max, Code-FX / Stop,
  final meters, explicit overrange and graph disposal. No hidden limiter or
  per-note normalization.
- [x] Verify both source and readable ZIP in permanently muted browsers,
  alongside [New Cassette](todo_pce_opna_new_cassette_20261118.md) and the
  separate [PC98 PCM release task](todo_fm2608_pcm_noteoff_guard_20261118.md).
  Preserve the prior staged SCSP work and record final evidence.

No common calibration rewrite, unrelated Synth feature, commit/push/npm/tag/
publication or Tauri work. Human listening remains separate.

Completed measurements and source/extracted-ZIP browser checks are recorded in
[the combined verification](verification_pce_opna_refinements_20261118.md).
