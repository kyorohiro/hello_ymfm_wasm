# PCM to Neo Geo ADPCM-A encoder

Date: 2026-10-28

## Implemented

`web/adpcm_a_sample.js` and its identical docs mirror provide a synchronous,
bounded pure JS `encodeAdpcmA()` for normalized mono Float32 PCM. The helper is
exported as an npm subpath and as global / `pg.encodeAdpcmA` in Playground Main
and Worker. Existing sample playback APIs, DSP cores, WASM, Mixer and fixed SDK
are unchanged. No new audio polling or visual/audio feedback path was added.

The codec uses high nibbles first, initial predictor and step zero, 49 Yamaha
steps and the actual 12-bit wrapping decoder arithmetic. Every frame searches
16 codes, with deterministic lower-code tie breaking. It does not resample,
normalize, infer tuning, add pitch control or introduce hardware looping.

Output is padded to a 512-frame / 256-byte range by encoding zero PCM with the
continuing predictor, rather than appending zero compressed bytes. The default
and maximum budget are 0xfff00 bytes, below the current per-voice 1-MiB limit.
Callers retain responsibility for placing aligned samples in the separate
16-MiB A memory. Result lengths and JSON-safe raw RMS/max/SNR metrics make
padding and loss explicit; metrics exclude padding and chip attenuation.

The decoded rate is clock/432 (18,518.52 Hz at 8 MHz). This differs from the
shipped core's 500-kHz internal PCM output and the chosen device/WAV rate.
Encoded zero PCM has a small quantization floor; EOF and key-off stop output.
ADPCM-A and ADPCM-B are different codecs with independent ROM spaces.

## Examples and integration

Both Neo Geo modes gain `examples/neogeo/neogeo-adpcm-a-drums.js`. Six original
kick/snare/hat/tom/wood/shaker signals are generated at `fm.clock/432` and packed
into an 8,960-byte bank. It uses the selected primary chip's six A voices, with
short source endpoint fades and chip voice levels. No Mixer override or extra
chip is added. Existing mode Examples are retained, making four per Neo Geo
mode. Saved user code and starters are unchanged.

`examples/nodejs/main_neogeo_adpcm_a.js` writes `.adpcma`, per-voice ranges and
conversion JSON, and an actual core render resampled by the existing engine to
48-kHz stereo WAV. Both variants produce 331,200 frames (6.9 seconds), peak
0.285522, all six solos audible, no clipping and exact zero EOF/final tails.
No recording, game ROM or external instrument asset is required.

Public usage is documented in [../adpcm_a_sample.md](../adpcm_a_sample.md) and
the npm README. Packaging and declaration generation include the helper;
cache revision is `adpcm-a-encoder-1`. The itch web workflow adds native/WASM
and exact packaged browser regression checks. Publication remains manual.

## Verification

- 22 codec/OPNB/ADPCM-B tests passed, including six new encoder cases, no skips.
  The test-only native transport compiles the fixed vendored SDK, not a w/
  checkout. Compiler absence is an explicit skip; available compiler failure
  fails the test. Actual ymfm raw channel decoding validates every nibble,
  including deliberately wrapping sequences. Whole-chip Native and shipped
  WASM output match exactly for both YM2610 and YM2610B.
- Actual core checks cover six voices, pan, fixed decoded pitch/duration, end
  flags and inclusive EOF, re-trigger, key-off, reset retaining ROM, disjoint
  A/B banks, high/boundary-crossing addresses, summed output, ownership and
  isolated instances/disposal. Original sine/voice-like/drum fixture SNR is
  39.91 / 44.43 / 24.94 dB; these are fixture measurements, not universal quality.
- Main/Worker/Monaco: 266 tests passed. Catalog/declaration regressions: 50
  passed. All mode TypeScript checks passed. Installed npm tarball checks
  exercise both imports, actual variant playback/EOF/retrigger and generated
  NodeNext/Bundler/browser declarations. Version remains 0.2.32, unpublished.
- Chromium 153 and WebKit 26.6 passed both modes × Main/Worker, on both source
  and the exact minified Run ZIP: 16 routes. Each exact Example ran twice;
  probe PCM was finite and nonzero, Stop output was exactly zero, both public
  utility entries and eight invalid inputs/options were exercised. No missing
  assets/runtime errors. Physical destination was always muted.
- Full and Run ZIPs pass CRC and byte-for-byte stage comparison. Run is 894
  entries, below the existing 1,000-entry limit. The updated workflow passes
  actionlint; its new remote CI has not been run.

Exact inputs, artifacts and browser results are in the
[companion receipt](adpcm_a_encoder_01.json). The raw browser reports and Node
WAV previews are under `/private/tmp/adpcm-a-encoder-*` and
`/private/tmp/neogeo-adpcm-a-{ym2610,ym2610b}.*`.

No commit/push/tag, package publication, SDK/Tauri import, Tauri GUI listening
or app upload was performed. Sample Editor integration remains a separate next
step: explicit mono/rate preparation, capacity/error display and converted
preview before assigning the six one-shot voices.
