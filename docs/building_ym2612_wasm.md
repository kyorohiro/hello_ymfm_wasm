# Building WASM from the fixed SDK

The builds listed below use the complete local SDK source release at
`third_party/tetorica-soundchip-native/`. A fresh checkout contains the source,
build recipes, provenance and component licenses. No SDK checkout, submodule,
download or synchronized edit of another repository is required.

## Build

| Chip(s) | Build script | Output module basename |
| --- | --- | --- |
| YM2612 (ymfm) | `scripts/build_ym2612_wasm.sh` | `ym2612_wasm` |
| YM2203 | `scripts/build_ym2203_wasm.sh` | `ym2203_wasm` |
| YM2608 | `scripts/build_ym2608_wasm.sh` | `ym2608_wasm` |
| YM2610 / YM2610B | `scripts/build_ym2610b_wasm.sh` | `ym2610b_wasm` |
| YM2151 / YM2164 | `scripts/build_ym2151_wasm.sh` | `ym2151_wasm` |
| OKIM6258 | `scripts/build_okim6258_wasm.sh` | `okim6258_wasm` |
| YM2413 | `scripts/build_ym2413_wasm.sh` | `ym2413_wasm` |
| YM3526 | `scripts/build_ym3526_wasm.sh` | `ym3526_wasm` |
| YM3812 | `scripts/build_ym3812_wasm.sh` | `ym3812_wasm` |
| YMF262 | `scripts/build_ymf262_wasm.sh` | `ymf262_wasm` |
| Y8950 | `scripts/build_y8950_wasm.sh` | `y8950_wasm` |
| AY-3-8910 / YM2149 | `scripts/build_ay8910_wasm.sh` | `ay8910_wasm` |
| Sega PSG | `scripts/build_segapsg_wasm.sh` | `segapsg_wasm` |
| RF5C164 | `scripts/build_rf5c164_wasm.sh` | `rf5c164_wasm` |
| 32X PWM | `scripts/build_pwm32x_wasm.sh` | `pwm32x_wasm` |
| HuC6280 | `scripts/build_huc6280_wasm.sh` | `huc6280_wasm` |

Install Emscripten and Python 3, then run:

```sh
python3 scripts/import_soundchip_sdk.py --check
sh scripts/build_ym2612_wasm.sh
sh scripts/build_ym2203_wasm.sh
sh scripts/build_ym2608_wasm.sh
sh scripts/build_ym2610b_wasm.sh
sh scripts/build_ym2151_wasm.sh
sh scripts/build_okim6258_wasm.sh
sh scripts/build_ym2413_wasm.sh
sh scripts/build_ym3526_wasm.sh
sh scripts/build_ym3812_wasm.sh
sh scripts/build_ymf262_wasm.sh
sh scripts/build_y8950_wasm.sh
sh scripts/build_ay8910_wasm.sh
sh scripts/build_segapsg_wasm.sh
sh scripts/build_rf5c164_wasm.sh
sh scripts/build_pwm32x_wasm.sh
sh scripts/build_huc6280_wasm.sh
```

Each build verifies the snapshot before invoking the SDK's original chip
recipe. Each module basename in the table produces a `.js` / `.wasm` pair
under `docs/generated/`.
The YM2203, YM2610B, YM2151 and OKIM6258 recipes retain their generated-glue whitespace cleanup using Perl.
With Node.js available, the SDK also writes
`docs/generated/build-info.json` with compiler version, source hashes and
output hashes. Building one chip preserves the other chips' existing records.
These are build records; consumers still load the same JS/WASM pairs through
the existing `Ym2612`, `Ym2203`, `Ym2608`, `Ym2610B`, `Ym2151`, `Oki6258AudioEngine`, `Ym2413`, `Ym3526`, `Ym3812`, `Ymf262`, `Y8950`, `Ay8910`, `SegaPSG`, `Rf5c164`, `PWM32X` and `Huc6280AudioEngine` APIs.
For the shared YM2610/B module, `Ym2610B.create({variant: false, ...})`
selects YM2610 (four FM channels); the default `variant: true` selects YM2610B (six).
For the shared OPM/OPP module, `Ym2151.create({variant: 'ym2164', ...})`
selects YM2164; the default variant is `'ym2151'`. Both retain eight FM channels.
For the shared AY module, `Ay8910.create({type: 0x10, ...})` selects YM2149;
the default `type: 0` selects AY-3-8910. Existing normalization flags and the
YM2149 pin-26 clock-divider flag remain available.

An optional output directory is resolved relative to the caller's working
directory. The build script itself can be invoked from outside the checkout:

```sh
sh /path/to/checkout/scripts/build_ym2612_wasm.sh ./ym2612-output
sh /path/to/checkout/scripts/build_ym2203_wasm.sh ./ym2203-output
sh /path/to/checkout/scripts/build_ym2608_wasm.sh ./ym2608-output
sh /path/to/checkout/scripts/build_ym2610b_wasm.sh ./ym2610b-output
sh /path/to/checkout/scripts/build_ym2151_wasm.sh ./ym2151-output
sh /path/to/checkout/scripts/build_okim6258_wasm.sh ./okim6258-output
sh /path/to/checkout/scripts/build_ym2413_wasm.sh ./ym2413-output
sh /path/to/checkout/scripts/build_ym3526_wasm.sh ./ym3526-output
sh /path/to/checkout/scripts/build_ym3812_wasm.sh ./ym3812-output
sh /path/to/checkout/scripts/build_ymf262_wasm.sh ./ymf262-output
sh /path/to/checkout/scripts/build_y8950_wasm.sh ./y8950-output
sh /path/to/checkout/scripts/build_ay8910_wasm.sh ./ay8910-output
sh /path/to/checkout/scripts/build_segapsg_wasm.sh ./segapsg-output
sh /path/to/checkout/scripts/build_rf5c164_wasm.sh ./rf5c164-output
sh /path/to/checkout/scripts/build_pwm32x_wasm.sh ./pwm32x-output
sh /path/to/checkout/scripts/build_huc6280_wasm.sh ./huc6280-output
```

Set `EMXX` to select an installed Emscripten C++ compiler. The SDK recipes retain
O2, the existing exports and memory growth settings. AY uses C++17 and its
original ten exports without `EXPORT_ALL`; the other recipes above use C++14.
OPN, YM2413, Sega PSG and RF5C164 recipes retain their explicit `ASSERTIONS=1`; AY, PWM, HuC6280, OPM/OPP, OKIM6258, Y8950 and the OPL1/2/3 recipes retain
their existing compiler-default assertion setting.
The OPN/OPM/OPLL/OPL synchronous `read()` / `generateStereo()` and OKIM6258
`writeOki6258()` / `processFrames()` APIs are unchanged.
YMF262 also retains `generateStereoInto()` for caller-provided output buffers.
Y8950 retains its sample-memory load/clear APIs and `HEAPU8` runtime support.
AY retains synchronous register reads and owned stereo buffers. Its core
integrates native chip ticks directly into the configured output sample rate;
the existing AudioEngine does not add a JS sample-rate converter.
Sega PSG retains its byte-write, Game Gear stereo, opaque same-instance state,
owned PCM and borrowed PCM-view APIs. The same module serves Genesis-family
PSG instances, Game Gear, Master System and standalone/additional sources.
Its tick accumulator produces PCM at the configured output rate.
RF5C164 retains its eight voices, absolute and banked sample-RAM APIs, bus
address reads, owned stereo output and opaque same-instance state. Its core
holds the latest clock/384 sample at the configured output rate. Reset clears
voice/control/phase state and retains the 64 KiB RAM; state restoration includes
RAM and the held stereo sample. `HEAPU8` remains available for sample uploads.
PWM retains `-ffp-contract=off`, 23 exports and its original lack of
`EXPORT_ALL`. Its runtime methods are `cwrap`, `HEAPU8`, `HEAPU16` and `HEAPF32`.
The default async `PWM32X.create()` uses WASM; `new PWM32X()` remains the
explicit synchronous JS reference. Existing FIFO proxies, owned/borrowed PCM,
`renderInto()` and same-instance snapshots are preserved.
HuC6280 retains C++14, `EXPORT_ALL`, eight exports, `cwrap` and `HEAPF32`.
Its existing engine writes registers synchronously and returns owned stereo
buffers through `processFrames()`. The core averages chip-clock ticks at the
configured output rate, retaining the latest sample when a frame has no tick.
Reset clears wave RAM and playback state while retaining host channel mutes.
There is no snapshot, read/status, borrowed-buffer or Into API.

## Fixed source and updates

`third_party/soundchip-sdk.json` records SDK `0.1.1`, source commit
`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`, archive SHA-256, release-manifest
SHA-256 and the complete 379-file snapshot. This is the same source release
used by Playground Tauri. Per-component terms remain in the SDK's `LICENSES.md`
and `vendor/` notices; these sixteen wrappers, ymfm inputs and the MAME-derived
OKIM6258, AY, RF5C164, PWM and HuC6280 adaptations retain BSD-3-Clause.
The original Tetorica Sega PSG and state helper also retain BSD-3-Clause;
their location under `vendor/ymfm/` does not make them ymfm-originated code.

Treat the imported directory as immutable. To update it, obtain a local SDK
source-release ZIP and explicitly import its expected hash and revision:

```sh
python3 scripts/import_soundchip_sdk.py \
  --archive /path/to/tetorica-soundchip-native-VERSION-sources.zip \
  --sha256 EXPECTED_ARCHIVE_SHA256 \
  --source-commit EXPECTED_40_CHARACTER_COMMIT
```

The importer checks every manifest entry and rejects altered existing
snapshots. Review the new receipt and source diff, rebuild, compare behavior
and refresh any affected calibration captures before distributing new assets.
The commit is declared provenance; local archive and manifest hashes verify
the imported bytes without contacting GitHub.

## Verification

```sh
python3 -m unittest discover -s test -p 'test_*sdk*.py' -v
node scripts/check_ym2612_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-build \
  --sdk-dir /path/to/sdk-build \
  --out /tmp/ym2612-comparison.json
node scripts/check_ym2203_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-ym2203-build \
  --sdk-dir /path/to/sdk-ym2203-build \
  --out /tmp/ym2203-comparison.json
node scripts/check_ym2608_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-ym2608-build \
  --sdk-dir /path/to/sdk-ym2608-build \
  --out /tmp/ym2608-comparison.json
node scripts/check_ym2610b_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-ym2610b-build \
  --sdk-dir /path/to/sdk-ym2610b-build \
  --out /tmp/ym2610b-comparison.json
node scripts/check_ym2151_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-ym2151-build \
  --sdk-dir /path/to/sdk-ym2151-build \
  --out /tmp/ym2151-comparison.json
node scripts/check_okim6258_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-okim6258-build \
  --sdk-dir /path/to/sdk-okim6258-build \
  --out /tmp/okim6258-comparison.json
node scripts/check_ym2413_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-ym2413-build \
  --sdk-dir /path/to/sdk-ym2413-build \
  --out /tmp/ym2413-comparison.json
node scripts/check_ym3526_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-ym3526-build \
  --sdk-dir /path/to/sdk-ym3526-build \
  --out /tmp/ym3526-comparison.json
node scripts/check_ym3812_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-ym3812-build \
  --sdk-dir /path/to/sdk-ym3812-build \
  --out /tmp/ym3812-comparison.json
node scripts/check_ymf262_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-ymf262-build \
  --sdk-dir /path/to/sdk-ymf262-build \
  --out /tmp/ymf262-comparison.json
node scripts/check_y8950_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-y8950-build \
  --sdk-dir /path/to/sdk-y8950-build \
  --out /tmp/y8950-comparison.json
node scripts/check_ay8910_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-ay8910-build \
  --sdk-dir /path/to/sdk-ay8910-build \
  --out /tmp/ay8910-comparison.json
node scripts/check_segapsg_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-segapsg-build \
  --sdk-dir /path/to/sdk-segapsg-build \
  --out /tmp/segapsg-comparison.json
node scripts/check_rf5c164_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-rf5c164-build \
  --sdk-dir /path/to/sdk-rf5c164-build \
  --out /tmp/rf5c164-comparison.json
node scripts/check_pwm32x_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-pwm32x-build \
  --sdk-dir /path/to/sdk-pwm32x-build \
  --out /tmp/pwm32x-comparison.json
node scripts/check_huc6280_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-huc6280-build \
  --sdk-dir /path/to/sdk-huc6280-build \
  --out /tmp/huc6280-comparison.json
```

The Python tests verify offline imports and a fresh-copy build route using a
recording compiler. The Node checkers compare actual WASM PCM,
available read/status/IRQ APIs, reset and available state restoration, including multiple clocks and
irregular render blocks. YM2612 also checks internal envelopes; YM2203 checks
FM/SSG, prescalers, source/channel mutes and engine resampling.
YM2608 also checks rhythm and ADPCM-B playback, memory transfers and saved
sample memory using original synthetic test data.
The YM2610/B checker covers both FM variants, SSG, ADPCM-A/B, independent
ROM transfers and saved ROM contents, also using original synthetic data.
The YM2151 checker covers OPM and OPP variants, all eight FM channels,
LFO, noise, timers, mutes, state restoration and engine resampling.
The OKIM6258 checker compares decoder PCM and serialized state, including
FIFO/nibble handling, precision, clock/divider changes, pan and engine gain/mute.
The YM2413 checker covers all nine melody channels, built-in/user instruments,
rhythm, mutes, engine resampling and reset/replay/seek. Its existing WASM and
JS APIs have no saved-state facility, so no serialized-state restoration is claimed.
The YM3526 checker covers all nine two-operator FM channels, connection/feedback,
envelopes, AM/vibrato, rhythm, mutes, timers/IRQ/CSM, engine resampling and
reset/replay/seek. It preserves OPL1 sine-only behavior when OPL2 waveform
registers are written. Its existing WASM and JS APIs also have no saved-state facility.
The YM3812 checker additionally covers OPL2 waveform selection and its enable
register, together with nine-channel FM, rhythm, timers/IRQ/CSM, mutes and
reset/replay/seek through the existing APIs. It also has no saved-state facility.
The YMF262 checker covers both banks and 18 channels, six four-operator pairs,
eight waveforms, NEW compatibility behavior, four output buses folded into
stereo, rhythm, mutes and timers/IRQ. It preserves the existing lack of CSM
key-on and snapshot APIs, and compares reset/replay/seek and caller-buffer
rendering with the AudioEngine scratch-buffer path.
The Y8950 checker covers its existing OPL1 FM/rhythm, timers/IRQ/CSM and ADPCM
playback, CPU writes/feed, memory range/resize/clear, source mutes and VGM data
block replay/seek. It distinguishes native RAM from the JS upload mirror:
raw reset retains actual RAM, while public reset reuploads that mirror.
No snapshot, Into or working external-RAM readback API is introduced.
The AY checker covers AY-3-8910 and YM2149 with all supported type/flag
combinations, tone/noise/envelope periods, all sixteen envelope shapes,
register latches, mute phase continuity, reset/replay, owned output buffers
and VGM AY-command seek. The existing AY API has no snapshot, Into,
status, IRQ or envelope-monitor hooks. Its DAC tables can produce a DC
baseline at zero volume, so audible-output checks also require signal variation.
The Sega PSG checker covers all three tone channels, attenuation and byte
latches, periodic/white noise with tone-3 coupling, Game Gear stereo masks,
phase-preserving mutes, native state bytes and same-instance state restoration,
owned output and borrowed-view buffer reuse. Reset restores stereo routing to
`0xff`; reset and state restoration both preserve the current mute mask.
Existing VGM playback handles `0x50` PSG writes but skips `0x4f` stereo commands;
the migration preserves that behavior and tests Game Gear routing through the
direct chip/Worklet API.
The RF5C164 checker covers all eight voices, sign-magnitude samples, loop
markers, step/envelope/pan/control writes, sample RAM bounds and bank-OR window
access. It compares actual bus address reads and native state including RAM,
same-instance opaque continuation, reset and existing VGM memory commands and
seek. The public API has owned PCM only; no borrowed/Into or IRQ API is added.
The PWM checker covers FIFO overflow/flags, all sixteen routing values, timer
cadence/fractional phase, DAC/duty output, reset and state continuation, public
FIFO proxies, borrowed output and `renderInto()`. The raw state is a wasm32
struct copy: comparisons decode semantic fields and exclude ABI padding and
inactive FIFO slots; no portable state format or full raw-byte equivalence is
claimed. Snapshots exclude clock/rate/gain/output-mode/mute. Actual MAME-model
Genesis mixing and VGM PWM writes/streams/seek are tested; the standard
GenesisAudioEngine's legacy `SimplePwm` default is unchanged.
The HuC6280 checker covers six wavetable channels, wave-RAM writes and index
behavior, frequency and balance, DDA, channel-4/5 noise, LFO and silent channel
latches. It compares clock-tick averaging, mute phase continuity, reset/replay,
owned buffers and VGM writes/DDA streams/seek through the existing engine.
VGM seeks replay from the beginning; no serialized-state restoration is claimed.
The checkers open no audio device. Binary hashes
can differ with compiler versions or embedded assertion paths; runtime
comparison is separate from binary identity.

The sixteen module recipes above have switched to this build source. Other chip recipes and
the optional Nuked build continue using their existing inputs. Local `src/`
and `wasm/` copies remain available for those recipes and comparison builds.
