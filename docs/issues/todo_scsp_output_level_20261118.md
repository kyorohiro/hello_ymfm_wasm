# SCSP Synth application output level — 2026-11-18

User reports that Master 380% is still quieter than ordinary playback.
Prioritize this before multi-slot Capture or more DSP features.

- [x] Inspect application, raw-core and calibrated Mixer gain paths separately.
  Private `BALANCE=.125` attenuates authored / Code and song routes. Master
  380% therefore reaches only 0.475 times native output. This is not the
  separately measured common Mixer default.
- [x] Measure current and proposed output with default PCM, FM, DSP, polyphony,
  SSF and paused audition; record peaks, RMS and overrange at relevant Master
  settings without opening a physical output.
- [x] Restore application output after Code FX, retaining its existing input
  level. Use one shared post-FX compensation before final Master for authored,
  audition and song routes; keep one speaker edge and correct output meters.
  Preserve the 0–380% Master range and its existing startup value. Keep core,
  raw rendering, samples and common calibrated Mixer defaults unchanged.
- [x] Verify route gain exactly once, nonlinear Code-FX input behavior, Master
  zero/default/max, Stop fade and disposal. Do not silently add a limiter or
  promise that arbitrary full-scale polyphony remains unclipped at 380%.
- [x] Verify actual muted browser and readable ZIP flows together with the
  separate [New Cassette task](todo_scsp_new_cassette_20261118.md); refresh exact
  source proofs and record the intentional application output-level change.

Results and artifact hashes:
[combined verification](verification_scsp_output_level_new_cassette_20261118.md).

No Capture/DSP feature additions, npm/version/publication, commit/push/tag or
Tauri work. Human listening remains separate from muted/offline measurements.
