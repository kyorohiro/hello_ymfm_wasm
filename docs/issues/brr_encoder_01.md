# PCM to SNES BRR encoder

Date: 2026-10-28

## Implemented

`web/snes_brr_encoder.js` provides `encodeBrr(pcm, options)`, a bounded pure
JavaScript mono Float32 PCM encoder. Its docs mirror is byte-identical. Browser,
module Worker and Node consumers use the same conversion. Playground exposes
both `encodeBrr()` and `pg.encodeBrr()`; encoding needs no audio RPC or WASM.

The encoder preserves source indices and never resamples, normalizes, infers
pitch or truncates oversized input. One-shots explicitly zero-pad to a 16-frame
block. Loop starts and looping input lengths must already be 16-frame aligned.
The first and loop-start blocks use filter 0 so arbitrary incoming history does
not change later loop laps. Remaining blocks search the four predictor filters,
ranges 0–12 and signed nibbles with the accurate DSP's integer arithmetic.

The default output budget is 64,512 bytes, enough for 114,688 source frames in
an otherwise empty SnesSynth. Existing allocations, directory placement and echo
RAM remain the caller's responsibility. Returned source/encoded lengths, loop
metadata and JSON-safe raw reconstruction metrics make padding and lossy error
explicit. Tuning still belongs to the subsequent `loadBRR()` call.

SNES mode now includes `examples/snes/snes-pcm-brr.js`: original 128-frame PCM
→ 72-byte BRR → six-note melody. It uses the shared SNES endpoint without Mixer
overrides. The Node example writes `.brr`, tuning/conversion `.json`, and a
stereo `.wav` rendered by the actual 32-kHz S-DSP. Neither example needs game
files, a recording or an instrument ROM.

The npm wildcard exports include the new helper and generated declarations.
Playground packaging explicitly includes the module, generated Example catalog
and source file; scoped cache revision is `snes-brr-encoder-1`. The itch web CI
adds native/WASM core checks and packaged Main/Worker browser checks. Existing
DSP cores, WASM binaries, timing and Mixer defaults have not changed.

## Verification

- Decoder/encoder/SnesSynth/SPC: 37 tests passed, including eight new encoder
  cases. The available native compiler is required to succeed; only an absent
  compiler produces an explicit native-reference skip.
- Existing accurate native decoder and full S-DSP playback independently match
  generated data against WASM: 31,040 stereo frames across five cases, including
  KON/KOFF and resets. Header/nibble ordering, arbitrary-history loop laps,
  padding, limits, quality, input ownership and isolated live instances are
  covered. No external SDK checkout is required.
- Main/Worker/Monaco: 261 tests passed. Global and pg results match the direct
  helper, SNES retains the utility without OPN shortcuts, validation propagates,
  and source navigation opens the new module. Catalog/declaration regressions:
  50 tests passed. All mode TypeScript checks passed.
- Installed npm tarball: both extension and extensionless imports, conversion,
  real DSP playback/release, all existing package checks, and generated browser
  and Node declarations passed. Version remains 0.2.32; nothing was published.
- Node demo: 64,000 finite stereo frames, 2 seconds at 32 kHz, with silent tail.
  Example artifacts are `/private/tmp/snes-pcm-brr-root-verified.{brr,json,wav}`.
- Both local ZIPs pass CRC and byte-for-byte stage comparison. Run ZIP contains
  892 entries and stays below the existing 1,000-entry hosting limit.

Chromium 153 and WebKit 26.6 each passed Main and Worker on both the source
page and the exact minified Run ZIP (eight routes). The exact Example ran twice
per route. Both global entry points rejected invalid inputs; real final PCM was
finite and nonzero, and Stop produced exact silence. Physical output was muted.
The unchanged packaging/preview CI unit command also passed 36 cases, and
`actionlint` passed for the updated workflow.

Exact artifact/source hashes and browser results are recorded in the
[companion receipt](brr_encoder_01.json).
Physical test output is muted; automated PCM checks do not replace listening.
Remote CI, Tauri GUI listening and app uploads have not been performed for this
change. No commit, push, tag, npm release or SDK/Tauri import was made.

## Next boundary

Sample Editor integration remains separate: select/resample mono source,
show conversion loss and capacity, preserve explicit tuning/loop markers, then
support isolated converted preview and saved Keyboard playback. The encoder/API
and reproducible Examples are complete before that UI work begins.

See the [public guide](../snes_brr_encoder.md) for imports, result fields and
precise input/loop restrictions.
