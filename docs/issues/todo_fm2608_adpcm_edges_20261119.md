# PC98 Synth ADPCM waveform and release edges — 2026-11-19

User reports a consistently deformed left edge in the decoded software-wave
display and a keyboard release click. Screenshot: Triangle, root MIDI60,
base rate33488 Hz, level192, Repeat On, 128 decoded frames /64 ADPCM bytes.

- [x] Reproduce the generated-wave left edge with the real encoder/decoder;
  distinguish decoder startup constraints from avoidable software generation.
  Keep the displayed waveform faithful to decoded data and imports unchanged.
- [x] Reproduce keyboard release through the installed app guard, measure
  residual discontinuities, and repair the scoped software release as needed.
  Preserve raw keyOff, authored volume/capture and other OPNA sound sections.
- [x] Verify relevant native-render cases, repeat/retrigger/ownership behavior,
  muted browser UI and readable package. Record practical limits; no listening
  claim without an actual listening check.

No native/WASM gain rewrite, unrelated source editing, publication, staging or
commit is included. Record findings before broadening the implementation.

## Findings and implementation

Generated Triangle started at -0.6; the decoder starts/reset-repeats with
predictor 0 and step 127. The first decoded values (-.007, -.025, -.066, -.165,
-.402, -.515) explain the screenshot's left plunge. Rotating only the software
Triangle by a quarter cycle starts it at zero without changing its 128 frames,
root/pitch, range, volume or amplitude. The canvas still draws decoded ADPCM.
Saw/Square definitions, imported and previously saved bytes remain unchanged.
Saw's hard edge has inherent reconstruction error; rotating it worsened target
RMS error, so that unrelated sound change was rejected.

The installed keyboard noteOff correctly uses the existing 8 ms / 64-step guard
with a 128-frame lead. Its true stop edge is already small; the old Triangle's
repeat-reset burst persisted during the audible tail. The phase fix reduces
held maximum step by 92.3–92.5% and the release-window maximum by 91.3–92.4%
at 44.1 / 48 kHz over tested phases. Guarded true-stop worst steps are about
0.00175 / 0.00214 versus raw 0.1363 / 0.1595. Runtime guard/ownership logic and audio.js were
left unchanged; actual-native regression tests cover the corrected Triangle.
Normal ADPCM quantization and ordinary waveform slopes remain distinguishable
from an abrupt decoder stop.

Existing Triangle data needs regeneration: reload, then click **Software wave →
Triangle**. Current imported/saved sample data is preserved intentionally.

## Evidence

178/178 app/shared-runtime/queue tests and 2/2 deterministic readable-package
tests pass. Sixty actual-native release cases are recorded in
`build/opna-release-noise-20261119/measurement.json`; the separate wave
measurements/tests live in `build/fm2608-wave-start-20261119/`.
Combined browser/package evidence lives in `build/fm2608-adpcm-edges-20261119/`.

Focused source and actual extracted ZIP checks pass 16 groups / four runs in
Chromium / WebKit. Actual keyboard/screen-key output has maximum adjacent
steps around 0.010–0.011 at Master 70%, each release sends the existing 64 fade
batches and reaches silence, and Sine still works. The decoded Triangle canvas
was visually reviewed; ZIP screenshots match source. All 104 non-HTML served
assets match, with no page errors, missing files or external requests.
Browser checker SHA-256:
`424df513120f21933c9e87a06f1b072b5191290e49cb631473c3c69a02da8a4c`.
Reports: `browser-source.json` and `zip/browser-packaged.json` in that directory.

Readable local validation archive:
`release/tetorica_fm2608_synth_adpcm-edges-20261119_itch.zip` (183 files;
SHA-256 `5a892cb9ec8aeba9c5115e7dcc2143f941d12b19360327271a124a3d4646dc6b`).
Physical output was muted; human listening was not performed.
