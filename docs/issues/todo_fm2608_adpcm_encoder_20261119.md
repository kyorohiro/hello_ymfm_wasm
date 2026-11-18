# FM2608 ADPCM waveform conversion and musical release — 2026-11-19

User requests an improvement for the distorted generated Saw and WAV conversion,
and RF5C164-style software smoothing for keyboard / JavaScript note release.

- [x] Improve ADPCM encoding beyond the current per-sample greedy choice,
  retaining source timing, amplitude, sample length, addressing and true decoded
  display. Verify Saw / Square as well as Sine / Triangle and imported WAV.
- [x] Compare fresh decoding and actual repeated YM2608 output at 44.1/48 kHz;
  do not exchange a cleaner preview for a worse Repeat boundary or DC bias.
- [x] Bound encoding cost for long WAV input and retain input validation.
- [x] Verify musical software release for generated and imported samples through
  keyboard and JavaScript noteOff, preserving immediate raw keyOff and other
  OPNA voices. The existing 8 ms guard should be reused rather than duplicated.
- [x] Verify app / native tests and muted browser / actual ZIP behavior.

The initial predictor0 / step127 limits the first decoded sample to about
±0.00726. An unchanged Saw starting at −0.6 cannot be reproduced exactly by
that first sample. Do not fake the display, alter raw hardware behavior, add
hidden sample preprocessing or promise lossless PCM reconstruction.

## Implementation and results

- `adpcm_encoder.js` is app-only. Generated Saw / Square / Triangle, drawings
  and newly loaded audio use the same 32-frame lookahead / 16-frame commit
  encoder; the verified generated-Sine cycle encoding is retained. No shared
  SDK codec, native core, output gain, source PCM or saved ADPCM bytes changed.
- It compares ordinary and step-diverse beam paths, including Repeat tail
  choices. Fresh and Repeat error, decoded extrema and discontinuity bounds
  must not worsen relative to the shared greedy baseline; otherwise it keeps
  that baseline. Long samples search the first128 frames plus at most sixteen
  worst regions and their preceding blocks, rather than searching every frame.
- An early candidate reduced RMS but increased native Square peaks. It was
  rejected. The shipped selection also bounds extrema and jumps. Corrected
  native tests keep Square peaks below .235 (intended amplitude .225 at the
  fixed hardware volume); no gain normalization masks encoding error.
- Fresh decoded RMS: Saw .094020 → .094018, Square .234862 → .107301,
  Sine .004349 → .001951, Triangle .002050 → .001572. Saw's first-sample
  constraint dominates the total; residual error after its first8 points drops
  about9%. It is not a perfect Saw reconstruction.
- Actual WASM at44.1/48kHz: Saw Repeat error drops about14%; Square fresh error
  about19% and Repeat error about20%, with no new amplitude overshoot. Saw's
  first-cycle native RMS is about0.1% higher in the phase-aligned comparison,
  within a .3% seam tolerance. Square derivative error is not universally
  improved; lower amplitude RMS does not mean every edge is sharper or cleaner.
- The existing 8ms musical guard is reused for all waves and WAV imports.
  240 real native cases (four shapes, source/WAV, two rates, five release
  positions, Keyboard/Code/raw) retain silence at the final musical Stop edge;
  Keyboard and Code noteOff match, raw keyOff remains immediate, and authored
  volume, sample and Repeat settings survive.
- Local4000000-frame benchmark: shared encoder415ms, bounded app encoder755ms.
  These are local measurements, not a timing guarantee for all devices.
- Focused app/shared/native/packaging tests:220/220. Final logs and package
  manifest: `build/fm2608-adpcm-codec-20261119/final/`. Corrected native fidelity
  and release receipts: `build/fm2608-generic-adpcm-20261119/*-corrected.json`.
- Final source and extracted actual ZIP:16/16 groups passed across Chromium
  and WebKit, with physical output always muted. Checked generated waves and
  Float32 WAV import, exact decoded Canvas/export, keyboard/Code release,
  retrigger and raw keyOff.111 non-HTML assets matched source hashes. Receipts:
  `build/fm2608-adpcm-codec-20261119/final/source-layout/browser.json` and
  `build/fm2608-adpcm-codec-20261119/final/zip/browser-final.json`. No listening.
- Reload the page and regenerate the software wave or reload its WAV to hear
  the new conversion. Existing saved samples intentionally retain their bytes.
