# PS1 initial instrument level

Date: 2026-10-29. Base: `53f4e16ad3fdfbb5092558ea355f74261bb9d233`.

The initial SPU sample used by index.js and Keyboard was filter 0 / shift 4,
with a decoded peak of `0.0546875`. After the calibrated Mixer gain was applied,
this authored instrument was much quieter than the SPU tab's Sine shape.

`createPs1InitSample()` now uses filter 0 / shift 0 and sine codes −5…5, with
a decoded peak of **0.625**, close to the editor Sine input peak of **0.65**.
The sample remains 64 bytes / 112 frames with the same tuning, flags and loop.
No encoder runs in AudioWorklet; the factory still authors four bounded packets.

The central factory serves Browser AudioWorklet and the Native JS adapter;
Worker uses the same prepared instrument. Canonical web source and its deployed
docs mirror are synchronized, and the npm build contains the canonical bytes.
The source gain remains **0.128832** for primary, additional and the opt-in npm
calibrated preset. Voice volumes, ADSR, uploaded samples and user Mixer presets
retain their existing values.

## Actual-core comparison

`scripts/check_ps1_starter_levels.mjs` compares the historical starter, current
starter, editor Sine and immutable calibration reference through shipped WASM,
Ps1Synth and the existing host-rate resampler. It uses one settled voice at L/R
0.75, full sustain and no reverb, retaining only 128-frame scratch buffers.

| Output rate | Current / historical AC RMS | Current vs editor Sine |
| --- | ---: | ---: |
| 44,100 Hz | 11.6504× | −0.1728 dB |
| 48,000 Hz | 11.6477× | −0.1766 dB |

Both rates have finite, non-clipped mono-voice output, identical centered
channels, unchanged approximately 439.99 Hz pitch, stable sustain and exact
silence after fast key-off and Stop. The calibration reference is bit-identical
to independently authored original reference packets through the same core.
Post-Mixer figures in the offline report are explicitly arithmetic estimates;
they are not presented as browser graph measurements or human listening.

Full measurements: [ps1_init_sample_levels_01.json](ps1_init_sample_levels_01.json).
Build and browser summaries: [ps1_init_sample_01.json](ps1_init_sample_01.json).

## Verification and provenance

- Core/Synth/resampler/Worklet/Native and reference tests pass: 68 tests. This
  includes actual Native/WASM reference parity at 12 route combinations.
- Calibration/source guard suites pass: 356 tests. Both Mixer generators pass
  `--check` without changing generated gains.
- The original calibration JSON and frozen reference generator remain untouched.
  [A dedicated receipt](ps1_init_sample_receipt_01.json) permits only the exact
  initial factory revision. It reconstructs the full measured predecessor hash,
  proves every byte outside the factory/JSDoc unchanged, and rejects any other
  tuning, loop, flags, packet or synth/render modification. The calibration setup
  already clears RAM and uploads its own reference before capture. This is source
  revision evidence, not relabelled historical measurements.
- Public Playground source passes Chromium/WebKit × Main/Worker (four routes):
  starter twice, CH24 Guitar/PC Keyboard, tab audition, Stop/error recovery,
  additional SPU disposal, RAM-retaining reset, Examples and mode round trip.
- The actual bundled/minified Run ZIP passes WebKit Main/Worker (two routes).
  Both archives pass CRC; Run remains 931 entries. Source and ZIP browser captures
  use the actual SPU AudioWorklet with physical output muted.
- npm payload builds: 335 modules, 28 engines, 385 checked declarations. The
  packaged starter source equals canonical web bytes. No npm publication occurs.
- The bounded measurement and receipt tests are included in itch web CI.
  Workflow syntax passes actionlint. Remote CI and Tauri frontend import are
  outside this local verification; no Native device or human listening was used.

Reproduce:

```sh
node scripts/check_ps1_starter_levels.mjs --out /private/tmp/ps1-starter-levels.json
node --test web/ps1synth.test.mjs web/ps1_resampler.test.mjs web/playground_ps1_worklet.test.mjs web/native_genesis_ps1.test.mjs scripts/soundchip_calibration_ps1.test.mjs
node scripts/check_playground_ps1_browser.cjs --out /private/tmp/ps1-starter-browser.json
sh scripts/package_itch_playground.sh ps1-starter-level-dev
node scripts/check_playground_ps1_browser.cjs --webkit-only --zip release/hello_ymfm_wasm_ps1-starter-level-dev_itch_playground_for_run.zip --out /private/tmp/ps1-starter-zip-browser.json
npm run build:fm2612
```
