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
| Game Boy APU | `scripts/build_gameboy_apu_wasm.sh` | `gameboy_apu_wasm` |
| NES APU / FDS | `scripts/build_nesapu_wasm.sh` | `nesapu_wasm` |
| SNES SPC700 / S-DSP | `scripts/build_spc_wasm.sh` | `spc_wasm` |
| Sega PCM (315-5218) | `scripts/build_segapcm_wasm.sh` | `segapcm_wasm` |
| K051649 (SCC) | `scripts/build_k051649_wasm.sh` | `k051649_wasm` |
| YM3438 | `scripts/build_ym3438_wasm.sh` | `ym3438_wasm` |
| YMF276 | `scripts/build_ymf276_wasm.sh` | `ymf276_wasm` |
| YMF288 | `scripts/build_ymf288_wasm.sh` | `ymf288_wasm` |
| YMF278B | `scripts/build_ymf278b_wasm.sh` | `ymf278b_wasm` |
| YM2612 (Nuked OPN2) | `scripts/build_nuked_opn2_wasm.sh` | `nuked_opn2_wasm` |

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
sh scripts/build_gameboy_apu_wasm.sh
sh scripts/build_nesapu_wasm.sh
sh scripts/build_spc_wasm.sh
sh scripts/build_segapcm_wasm.sh
sh scripts/build_k051649_wasm.sh
sh scripts/build_ym3438_wasm.sh
sh scripts/build_ymf276_wasm.sh
sh scripts/build_ymf288_wasm.sh
sh scripts/build_ymf278b_wasm.sh
sh scripts/build_nuked_opn2_wasm.sh
```

Each build verifies the snapshot before invoking the SDK's original chip
recipe. Each module basename in the table produces a `.js` / `.wasm` pair
under `docs/generated/`.
The YM2203, YM2610B, YM2151, OKIM6258, SPC and Sega PCM recipes retain their generated-glue whitespace cleanup using Perl.
With Node.js available, the SDK also writes
`docs/generated/build-info.json` with compiler version, source hashes and
output hashes. Building one chip preserves the other chips' existing records.
These are build records; consumers still load the same JS/WASM pairs through
the existing `Ym2612`, `Ym2203`, `Ym2608`, `Ym2610B`, `Ym2151`, `Oki6258AudioEngine`, `Ym2413`, `Ym3526`, `Ym3812`, `Ymf262`, `Y8950`, `Ay8910`, `SegaPSG`, `Rf5c164`, `PWM32X`, `Huc6280AudioEngine`, `GameboyApu`, `NesApuWasm`, `SpcCore`, `SnesDspCore`, `SegaPcm`, `K051649`, `Ym3438`, `Ymf276`, `Ymf288` and `Ymf278b` APIs.
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
sh /path/to/checkout/scripts/build_gameboy_apu_wasm.sh ./gameboy-output
sh /path/to/checkout/scripts/build_nesapu_wasm.sh ./nes-output
sh /path/to/checkout/scripts/build_spc_wasm.sh ./spc-output
sh /path/to/checkout/scripts/build_segapcm_wasm.sh ./segapcm-output
sh /path/to/checkout/scripts/build_k051649_wasm.sh ./scc-output
sh /path/to/checkout/scripts/build_ym3438_wasm.sh ./ym3438-output
sh /path/to/checkout/scripts/build_ymf276_wasm.sh ./ymf276-output
sh /path/to/checkout/scripts/build_ymf288_wasm.sh ./ymf288-output
sh /path/to/checkout/scripts/build_ymf278b_wasm.sh ./ymf278b-output
sh /path/to/checkout/scripts/build_nuked_opn2_wasm.sh ./nuked-output
```

Set `EMXX` to select an installed Emscripten C++ compiler; Nuked uses `EMCC` for C.
The SDK recipes retain
O2, the existing exports and memory growth settings. AY, Game Boy, NES, Sega PCM and K051649 use C++17
without `EXPORT_ALL`, retaining ten, eleven, eighteen, thirteen and nine exports respectively.
Nuked uses C11; the other recipes above use C++14.
YM2612, YM2203, YM2608, YM2610B, YM2413, Sega PSG, RF5C164, SPC and Nuked recipes retain their explicit `ASSERTIONS=1`; AY, Game Boy, NES, Sega PCM, K051649, YM3438, YMF276, YMF288, YMF278B, PWM, HuC6280, OPM/OPP, OKIM6258, Y8950 and the OPL1/2/3 recipes retain
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
Game Boy retains its four voices, register writes, mute mask, configured-rate
owned stereo output and opaque same-instance snapshots. Its core integrates
each native tick over the output frame using fractional durations.
Reset restores the DMG wave-RAM pattern and synthesis timing, retaining host
mutes. NR52 power-off retains wave RAM. Native states copy a same-build C++
object, including padding and mute/configuration fields; they are not a portable
or untrusted-input format. `GameboyApuAudioEngine` additionally validates its
rate, volume and channel-mask settings before loading its own snapshot tokens.
Its `process(left, right, frames)` fills caller buffers through owned generation;
no low-level Into, borrowed-buffer, read/status or IRQ API is introduced.
NES retains `-fwrapv`, `-fno-strict-aliasing`, `-ffp-contract=off`,
`-fexceptions` and `DISABLE_EXCEPTION_CATCHING=0`. Its incoming loader options
remain `wasmBinary`, `locateFile`, `print`, `printErr` and `noInitialRun`; runtime
methods remain `cwrap`, `HEAPU8`, `HEAPU32`, `HEAPF32` and `HEAPF64`.
Asynchronous `NesApu.create()` uses WASM; `new NesApu()` retains the synchronous
JavaScript reference. The WASM wrapper retains five APU voices, optional FDS,
64 KiB RAM load/read, owned output and cached borrowed views. Its 400-byte,
31-field applied-state observation is not a save/load facility. Reset clears
RAM, FDS tables and synthesis history while retaining mutes and C clock override.
Existing Analyzer/Player NES playback continues to use the separate JavaScript
engine, including its snapshots; this migration adds no WASM Player adapter.
Distribution source bundles contain verified SDK inputs and a standalone
recipe with only its two vendor paths relocated to the existing `third_party/`
layout. They rebuild without the checkout's SDK dispatcher or Python importer.
SPC retains C++14/O2, assertions, 33 C exports, `wasmBinary` initialization and
`HEAPU8` / `HEAPF32` / `UTF8ToString` runtime methods. The accurate DSP generates
32,000 native stereo frames per second; output resampling remains at the boundary.
`SpcCore` runs SPC700 files, while `SnesDspCore` is DSP-only. Caller-owned
`renderInto()` output, copied RAM/DSP analysis snapshots, mute, restart and
existing trace/discovery/observer/timeline APIs are preserved. These snapshots
are not arbitrary-position restorable emulator states. Timeline replay retains
the original four-frame output FIFO and 1,024,000-Hz effective DSP event ordering.
The complete modified LGPL library travels with the distribution, including
uncompiled source and original notices. Its standalone recipe relocates five
vendor paths to the existing `third_party/snes-spc` layout. Assertions embed
source paths, so relocated binaries can differ in hash; runtime equality is
checked separately. No fast DSP, optional filter or IPL ROM is added.
Sega PCM retains its 16 voices, independent left/right volumes, ROM bank
configuration, caller-owned stereo output and opaque same-instance/same-build
state API. State contains sample ROM as well as playback state; it is not a
portable serialization contract. The Analyzer's Sega PCM engine uses main-thread
synthesis and replay-from-zero seeking rather than a checkpoint adapter.
K051649 retains its five voices, SCC shared waveform and SCC+ independent
waveform writes, frequency/volume/key/test controls, native mute and owned PCM.
Its recipe exposes `cwrap` / `HEAPF32`, with no Perl cleanup or state/read API.
Reset/reprogram and post-scenario continuation are compared instead of snapshot
restoration. Analyzer MSX compositions use the existing engine and replay seek;
this build migration does not add an SCC Playground mode.
YM3438 and YMF276 use the SDK's shared OPN-variant recipe with
`OPN_VARIANT=ym3438` and `OPN_VARIANT=ymf276` respectively, without an SSG flag.
C++14/O2, 11 C exports, `cwrap` / `HEAPF32`, incoming
`wasmBinary` / `locateFile` and no Perl cleanup are retained. Their `OpnVariant`
binding has bus `read()` / status / IRQ and owned PCM, with no native state,
mute or borrowed-output API. `sampleRate(clock)` calculates a rate and does not
change synthesis state. Warm reset retains some counters and DAC settings;
comparisons use matched reset histories rather than assuming a new instance.
The public `YM3438Synth` and `YMF276Synth` use direct transport, without a
RuntimeSynth or synthesis Worklet. YMF276 retains its distinct 14-bit FM path
and DAC right shift; sharing the wrapper does not make its output identical to
YM3438. YMF288 uses the same SDK recipe with `OPN_VARIANT=ymf288` and
`OPN_HAS_SSG`, summing its mono SSG output into both FM outputs before clamping.
Its current maximum-fidelity PCM rate is `floor(clock / 16)` (500,000 Hz at the
default 8 MHz clock); `sampleRate(clock)` remains a calculation. Browser output
must convert this PCM to a supported AudioBuffer rate. Unlike the other two
variants, its wrapper reset reconstructs the handle contents for reproducible
cold output. The low-level reset enables three FM channels; `YMF288Synth.reset()`
enables all six using register `0x29`. The Synth is FM-only; the binding exposes
no rhythm ROM upload or native snapshot API. The application's shared variant
recipe remains available unchanged for comparison builds.
YMF278B retains C++14/O2, `EXPORT_ALL`, 15 C exports, `cwrap` / `HEAPF32` /
`HEAPU8` and the incoming `wasmBinary` option. It mixes 18 FM channels and
24 PCM voices through DO2, with native output at `floor(clock / 768)`.
The sample-memory API retains its 4 MiB limit, partial loads and clear operation.
Native RAM bus writes do not update the JS upload mirror. Public reset recreates
the chip and reloads that mirror and both mute masks; raw native reset has a
different retained-history contract. No native snapshot or borrowed/Into API is
added. The existing AudioEngine keeps its rate conversion and optional PSG;
Analyzer/VGM playback and seeking continue through the existing replay path.
Nuked OPN2 retains C11/O2, assertions, `EXPORT_ALL`, 12 C exports,
`cwrap` / `HEAPF32` and the incoming `wasmBinary` option. The existing `Ym2612`
wrapper loads its separate module without a new API. Native snapshots and
native mute exports are absent; internal-envelope output remains a zero-filled
compatibility interface. Each bus write advances 24 internal clocks; each PCM
frame sums another 24 clocks and scales by 11. Its YM2612 ladder/DC behavior
is preserved, so inactive output is not assumed to be exactly zero.
Distribution source bundles use verified SDK inputs with only two source paths
relocated to `third_party/nuked-opn2`. They rebuild without the SDK dispatcher
or Python importer. See `sources/Nuked-OPN2.md`, the core's LGPL notice and
`sources/LICENSE.tetorica` for the original wrapper/build recipe's BSD notice.

## Fixed source and updates

`third_party/soundchip-sdk.json` records SDK `0.1.1`, source commit
`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`, archive SHA-256, release-manifest
SHA-256 and the complete 379-file snapshot. This is the same source release
used by Playground Tauri. Per-component terms remain in the SDK's `LICENSES.md`
and `vendor/` notices; these twenty-three wrappers, ymfm inputs and the MAME-derived
OKIM6258, AY, RF5C164, PWM, HuC6280, Game Boy, Sega PCM and K051649 adaptations retain BSD-3-Clause.
NES/FDS retains its Apache-2.0 JSNES and MIT FDS licenses, authors and provenance;
these terms are separate from the twenty-three BSD-3-Clause module recipes.
SNES SPC700/S-DSP retains snes_spc's LGPL-2.1-or-later terms and complete
corresponding modified source; its license is not applied to other chip cores.
The optional Nuked OPN2 module separately retains LGPL-2.1-or-later core terms,
complete modified source and provenance. The original Tetorica wrapper/recipe
BSD notice is included separately; the 23 BSD module recipes remain distinct.
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
node scripts/check_gameboy_apu_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-gameboy-build \
  --sdk-dir /path/to/sdk-gameboy-build \
  --out /tmp/gameboy-comparison.json
node scripts/check_nesapu_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-nes-build \
  --sdk-dir /path/to/sdk-nes-build \
  --out /tmp/nes-comparison.json
node scripts/check_spc_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-spc-build \
  --sdk-dir /path/to/sdk-spc-build \
  --out /tmp/spc-comparison.json
node scripts/check_segapcm_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-segapcm-build \
  --sdk-dir /path/to/sdk-segapcm-build \
  --out /tmp/segapcm-comparison.json
node scripts/check_k051649_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-scc-build \
  --sdk-dir /path/to/sdk-scc-build \
  --out /tmp/scc-comparison.json
node scripts/check_ym3438_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-ym3438-build \
  --sdk-dir /path/to/sdk-ym3438-build \
  --out /tmp/ym3438-comparison.json
node scripts/check_ymf276_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-ymf276-build \
  --sdk-dir /path/to/sdk-ymf276-build \
  --out /tmp/ymf276-comparison.json
node scripts/check_ymf288_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-ymf288-build \
  --sdk-dir /path/to/sdk-ymf288-build \
  --out /tmp/ymf288-comparison.json
node scripts/check_ymf278b_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-ymf278b-build \
  --sdk-dir /path/to/sdk-ymf278b-build \
  --out /tmp/ymf278b-comparison.json
node scripts/check_nuked_opn2_wasm_sdk.mjs \
  --legacy-dir /path/to/previous-nuked-build \
  --sdk-dir /path/to/sdk-nuked-build \
  --out /tmp/nuked-comparison.json
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
The Game Boy checker covers both pulse voices, duty/sweep/envelope/length,
wave RAM, 7/15-bit noise, NR50/NR51 routing, NR52 power, mute/reset, fractional
timing and owned output. Snapshot comparisons validate headers/configuration
and exact PCM continuation through public tokens and trusted same-build native
loads; they do not claim equality of ABI padding. Actual VGM `0xb3` playback
and the Player's existing checkpoint/seek behavior are also checked.
The NES checker compares actual WASM pulse, triangle, noise, DMC and FDS PCM,
31-field observations, RAM readback, reset/replay and owned/borrowed buffers.
Mute/filter history is compared against the retained JavaScript reference with
the same history. VGM `0xb4` writes and type-`0xc2` RAM blocks are checked through
the existing parser and a recording target; no WASM Player/checkpoint integration
or inaccessible full-state equality is claimed.
The SPC checker compares actual SPC700 and DSP-only PCM, RAM/DSP analysis,
eight BRR voices, envelopes, pitch/noise/echo, restart and caller-buffer rendering.
It also exercises bounded DSP observation, RAM-read discovery, trace and timeline
replay. Active CPU writes to live BRR RAM retain the upstream dependence on render
partitions; comparisons use identical layouts in that case. No snapshot-load API
or unrestricted hardware-transcription accuracy is inferred.
The Sega PCM checker compares actual 16-voice stereo PCM and opaque state,
ROM load/clear and bank selection, register aliases, looping/end conditions,
mute/reset and state continuation. Engine/optional PSG and real Player replay
seek use the existing Analyzer path; the engine has no checkpoint state facade.
The K051649 checker compares real five-voice PCM, shared/independent wave writes,
frequency halt, test-register protection, key/volume aliases, mute/reset, owned
buffer lifetime, Engine mixing and MSX/AY Player replay seeking. It records the
transitive static runtime dependency closure and uses no inaccessible chip state.
The YM3438 checker compares all six FM channels, algorithms/operators, LFO,
channel-3 special mode, timers/CSM, CMOS DAC, bus/status/IRQ, continuation probes
and matched warm resets. It exercises the supported direct Synth transport and
buffer ownership without inventing a state facade, Player or UI playback route.
The YMF276 checker covers the same bus and direct-Synth contract, plus its
distinct FM/DAC scaling and latch behavior. Positive DAC controls check all
256 data codes, both ninth-bit values and all four stereo routes. Rate queries
remain calculations, and reset comparisons use matched warm histories.
The YMF288 checker compares FM and SSG through the actual mono-SSG mixing
path, bus/status/IRQ and direct Synth, using the variant's fixed output-rate
contract and reconstructed-reset behavior. Rhythm register handling uses the
existing interface's default external reads; no authentic rhythm ROM playback
or new upload API is claimed.
The YMF278B checker covers both FM and PCM, uploaded synthetic sample data,
memory bus access, independent mute masks, read/status/IRQ hooks, reset,
AudioEngine rate conversion and real Player replay/seek. Its sample data is
authored for the checks; no external copyrighted wave ROM is distributed.
The Nuked checker compares six-channel FM, DAC, bus/status/IRQ, write-driven
clock advancement, reset, owned/borrowed PCM and the zero-filled envelope
interface through the existing `Ym2612` wrapper. It also exercises the actual
Synth and Genesis/PSG Player replay path without assuming native snapshots or
ymfm's output scale. Standalone source rebuilds are verified separately.
The checkers open no audio device. Binary hashes
can differ with compiler versions or embedded assertion paths; runtime
comparison is separate from binary identity.

The twenty-six module recipes above have switched to this build source. DX7
continues using its existing inputs. Local `src/`, `wasm/` and `third_party/`
reference copies remain available for comparison builds.
