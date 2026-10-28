# PS1 Sample Editor and saved Keyboard instruments

Date: 2026-10-28. Base commit: `94b62d45596776f8543de616e9fe31b995b21309`.
This milestone extends the experimental Browser PS1 mode; SDK adoption and the
Tauri Native backend are separate work. Publication has not been performed.

## Result

- Sample Editor accepts PS1 as an instrument target, defaults to it in PS1 mode
  and fixes conversion to 44,100 Hz mono. File input, microphone recording,
  drawing, gain, fades, selection, root note and cents use the shared editor.
- `renderPs1Sample()` is the canonical crop/edit/resample/ADPCM path used by
  comparison, preview and the saved instrument. The adapter consumes already
  edited PCM without applying crop, gain or fades a second time.
- Loops align inward to native 28-frame boundaries. The intro is retained and
  the post-loop tail is omitted. Requested/applied positions and omitted frames
  are visible; an empty aligned loop is rejected, including on Save. One-shots
  keep the selected PCM and explicitly pad the final packet with zero PCM.
- Comparison returns bounded 256-point source/raw-decoded waveforms, byte and
  frame counts, padding, RMS/max error and SNR. Actual SPU preview uses a private
  WASM instance for 0.85 seconds at the declared root key with cents correction.
  It applies the default voice level once and releases the instance in `finally`.
- Saving retains the neutral source Float32 WAV and edit JSON. Loading through
  `inputAudio({target:'ps1'})` regenerates the same instrument. The new
  `examples/ps1/ps1-sampler.js` connects it to Guitar, PC and pointer Keyboard.
- PS1 instruments share 24 physical voices with owner-aware cleanup and oldest
  voice stealing. Unchanged samples are reused only after checking fresh sample
  metadata and actual current RAM bytes; repeated Run/Stop does not grow the
  sample bank. Preparation never resets the primary SPU or changes the Mixer.
- Both PCM and sampler examples are now in the PS1 mode's runnable allowlist.
  The previous PCM example existed in the catalog but was absent from that list.
  All four examples have a regression assertion.

Public workflow: [PS1 Sample Editor](../ps1_sample_editor.md).
Structured evidence: [ps1_sample_editor_01.json](ps1_sample_editor_01.json).

## Work and ownership limits

The whole selected region must fit the conversion budget before resampling,
even if a shorter loop would discard its tail. This bounds temporary PCM
allocation and rejects oversized work before reading samples or allocating
native-rate output. The default 520,192-byte budget is for an otherwise empty
Synth; the actual upload also checks live free space. The original recording
is preserved when a selection is rejected.

Conversion runs in the editor Worker, outside AudioWorklet rendering. Comparison
requests are coalesced; stale generations, closed dialogs and stopped previews
cannot start late audio. There are no periodic comparison or live-chip reads.
Exact-bank reuse performs an explicit preparation-time snapshot only when
metadata identifies a possible match. It adds no reads to note events.

The comparison is raw reconstructed ADPCM. SPU interpolation, envelopes, pitch
and output mixing affect actual playback. Loop alignment cannot repair a poor
waveform seam automatically. The core's experimental accuracy and allocation
limits remain documented in [PS1 SPU](../ps1_spu.md).

## Verification

- 69 audio tests pass with no skips, including real native-decoder comparison,
  actual WASM preview, the deployed editor Worker, instrument ownership/reuse,
  existing Game Boy preview and shared sample editing.
- Main/Worker runtime, catalog, declarations and assets: 297 tests pass; the
  final catalog suite passes 13 tests after adding the runnable-example
  regression (12 overlap the preceding group). Mode/project/starter tests: 31.
  All mode declarations and installed-package consumer types pass.
- Existing shared Sample Editor checks pass in Chromium and WebKit, including
  actual MediaRecorder with generated input. Game Boy fixture, full Playground
  and actual Run ZIP checks also pass in both engines.
- Final PS1 source / actual Run ZIP × Chromium / WebKit × Main / Worker:
  all eight routes pass using the same frozen checker. Checks cover file and
  recorded input, drawing, loop validation, stale-preview cancellation,
  save/reopen, Guitar PC/pointer pitch, 24 active voices and exact sample RAM,
  hot/fresh Run reuse, continuous output quanta and exact-zero Stop.
  All 289 served source files and 217 served ZIP files match their final bytes.
- Final isolated npm tarball installation passes: 987 files, 1,883,225 compressed
  bytes, 7,039,576 unpacked bytes, 381 generated declarations and 1,085 local
  asset/module references. All 28 existing WASM engines, 15 renderer checks,
  PS1 conversion/private preview/sample reuse and consumer types pass.
- Desktop and 390px screenshots were inspected. The dialog scrolls within the
  viewport and the comparison becomes a single column on narrow screens.
- Standard Synth, VGM Analyzer and Playground packaging commands pass. All four
  archives pass CRC, safe-path and full stage-byte checks. Playground Run has
  921 entries and no directory entries, within itch.io's 1,000-entry limit.
- Analyzer calibration guard, actionlint and runtime-versioner idempotence pass.
  CI contains the new unit tests and actual Run ZIP browser checker; remote CI
  has not been run for this uncommitted work.

Browser audio is captured from the actual output path with the physical output
muted. Automated checks do not replace human listening or hardware comparison.
Microphone checks use a generated MediaStream and real MediaRecorder, not a
physical microphone. The final fixture reuses the primary public AudioContext;
an earlier fixture opening a second device context had a transient timing
assertion failure. The final eight routes keep strict zero-gap assertions.
The JSON record contains the final route and npm results.

## Delivery and next work

Run archive:
`release/hello_ymfm_wasm_ps1-sample-editor-dev_itch_playground_for_run.zip`

SHA256: `9ca8460faff07d48aebf01e3c8d9531eddd6e23c15990dc89675fbe7aa84c4fd`.
The full downloadable archive uses the same name without `_for_run`.

The C++ core, generated WASM and receipt, existing renderer bytes, Mixer gains,
fixed SDK and Tauri backend are unchanged. Package version remains `0.2.32`.
No commit, push, tag, npm publication, SDK/Tauri import or itch upload was done.

Next: add the completed PS1 source/build recipe to a new SDK version, then
connect Tauri Native PS1 playback. Human audition of file and microphone
instruments is also useful before publication.
