# VGM Analyzer packaging: keyboard octave revision

`sh scripts/package_itch_vgm_analyzer.sh` stopped before staging with:

```
served DSP/WASM source changed; remeasure: docs/synth/synth_keyboard.js
```

The four current calibration reports also record UI modules served by Playground.
Commit `a71529c108a94f15b36d9d1af45434e122229ac8` changed the shared keyboard:
`createFretboardLayout` accepts `octave = 0`, and adds `octave * 12` to MIDI notes.
Playground's operator keyboard does not pass this optional value. The change does
not alter calibration reference programs, audio renderers, WASM, or mixer gains.

The freshness validators now recognize only this exact complete UI revision and
reconstruct the original measured file by reverting those two edits. All other
source changes still fail. Historical report files and generated gains are intact.

- Measured file: 9,982 bytes, SHA256 `ba14f89680e240e2ccda1e13f7df6345f8e1ebec876613df9f1294eff93d83fc`.
- Reviewed file: 10,010 bytes, SHA256 `b7dc1daea64aa6e061bfdb2295010ee24eddaba51ab7ab6cf87c0f751be7c795`.
- Tests compare complete default layouts against the reconstructed predecessor,
  and reject changed defaults, pitch arithmetic, imports, paths and file contents.
- Related keyboard, freshness, calibration and generator tests: 54 passed.
- Packaging with a unique version and with the default version completed.

This is a review of an inactive UI option, not a new audio measurement.
