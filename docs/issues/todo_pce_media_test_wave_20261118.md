# PC Engine MSM5205 / CD-DA test-wave editing — 2026-11-18

User cannot assess source levels without authoring a comparable Sine and
changing its parameters. Extend the two existing sample players with a small
software PCM source editor, keeping hardware/source distinctions explicit.

- [x] Add Sine / Triangle / Saw / Square and a shared-canvas one-cycle drawing
  editor to both media tabs. Expose frequency, level and bounded duration,
  optional edge smoothing and visible auto-load / pending-draft status.
- [x] Generate standard stereo PCM16 / 44.1 kHz WAVs, save them through the
  validated Files API, and load each source using its existing public path.
  Reuse an editor-owned file only while its revision matches; preserve unrelated
  user files and keep within the existing Cassette budget.
- [x] Keep current source controls: MSM ADPCM encoding / Rate / Loop and actual
  decoded-wave display; CD-DA transport / track / seek. Do not imply that PCM
  generation, drawing or frequency controls are hardware oscillators.
- [x] Do not auto-play. Stage locally during a drawing gesture and load only
  after release/change when auto-load is On. Manual load must be obvious when
  Off; cancellation, replacement, New Cassette and disposal fence stale work.
- [x] Verify WAV format / frequency / levels / limits, independent editable
  cycles, safe file ownership / budgeting and real muted browser flows for
  both source tabs and the extracted ZIP. Source media levels remain unchanged.

No new sound-chip emulation, external inputs, native changes or publication.

Completed pure tests and source/extracted-ZIP Chromium / WebKit checks are
recorded in [the combined verification](verification_pce_opna_refinements_20261118.md).
