# PC98 Synth Sine release / initial decode — 2026-11-19

User still hears keyboard release noise with Sine, and notes a slight initial
flattening in the 128-frame decoded Sine display. Continue both issues without
treating the previous Triangle fix as a solution for Sine.

- [x] Measure actual native Sine output around noteOff, separating ordinary
  sine slope from fade quantization and the final stop discontinuity.
- [x] Improve the app-owned software release when measurements support it;
  preserve raw keyOff, authored volume, other OPNA sources and queue ownership.
- [x] Establish whether initial decoded Sine error is an encoder choice or a
  decoder startup constraint. Do not replace the honest decoded canvas with
  an idealized curve, change raw imports or silently alter pitch/output gain.
- [x] Verify focused native/race tests and muted keyboard browser behavior.
  Record limits clearly, especially any waveform-shape compromise.

Prior Triangle edits are staged by the user and must remain staged/unchanged
except explicitly necessary integration. No staging, reset, commit, publication
or native/WASM gain rewrite is authorized or needed.

## Result

- The app release remains 8 ms after its existing 128-output-frame lead. It
  now samples a raised-cosine envelope each output frame and sends only changed
  integer R11 levels (at most 256 batches, 193 at authored level192). Raw
  `keyOff` remains immediate. No global output gain or shared chip code changed.
- Actual native tests at 44.1/48 kHz and five release phases compare the old
  64-step line with the installed curve. With the new generated Sine, worst
  envelope-error RMS falls 0.00119166 → 0.00024847 (79%); rapid error-difference
  RMS falls 0.00062915 → 0.00024791 (61%). The final Stop edge is zero in these
  measurements. Held PCM before release is identical; canonical volume192,
  owner cancellation, other OPNA sources and raw keyOff are preserved.
- Fresh ADPCM starts predictor0/step127, which cannot track the first slope
  of the 128-point Sine. Generated Sine alone now uses first code6 and last
  code3 with greedy encoding in between. The final code matters because ymfm
  resets before decoding the final Repeat nibble. Ordinary imports/drawings
  still use the existing shared encoder, including Sine-looking input.
- Fresh decoded Sine maximum error is 0.00863 vs 0.03376; first-eight-sample
  RMS error is 0.00450 vs 0.01632. Actual repeated native output is also closer
  to the intended Sine at roots36/60/68 and both output rates. This is still
  4-bit ADPCM, not perfect PCM; maximum ordinary repeated sample-to-sample
  slope is essentially unchanged. No canvas smoothing or gain compensation.
- Saved samples are not rewritten. Reload the page, then press Software wave
  → Sine to replace a previously saved cycle. New defaults use the new encoder.
- Full OPNA app/shared-runtime tests: 191/191. Packaging tests: 2/2. Logs and
  archive manifest: `build/fm2608-sine-declick-20261119/`.
- Native release measurement (prior measurements retained):
  `build/opna-sine-release-20261119/installed-measurement-generated-sine.json`.
  Onset probes: `build/fm2608-sine-start-20261119/`.
- Chromium/WebKit source and extracted actual ZIP: 16/16 groups passed, always
  physically muted. Verified honest decoded Canvas/export, computer/screen
  keyboard release, rapid retrigger and raw Code keyOff. 110 non-HTML served
  assets matched source hashes. Receipts:
  `build/opna-sine-release-20261119/browser-source.json` and
  `build/fm2608-sine-declick-20261119/browser-zip.json`. No human listening.
- The user's nine staged blobs were verified unchanged; changes for this task
  remain unstaged.
