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
```

Each build verifies the snapshot before invoking the SDK's original chip
recipe. Each module basename in the table produces a `.js` / `.wasm` pair
under `docs/generated/`.
The YM2203, YM2610B, YM2151 and OKIM6258 recipes retain their generated-glue whitespace cleanup using Perl.
With Node.js available, the SDK also writes
`docs/generated/build-info.json` with compiler version, source hashes and
output hashes. Building one chip preserves the other chips' existing records.
These are build records; consumers still load the same JS/WASM pairs through
the existing `Ym2612`, `Ym2203`, `Ym2608`, `Ym2610B`, `Ym2151`, `Oki6258AudioEngine` and `Ym2413` APIs.
For the shared YM2610/B module, `Ym2610B.create({variant: false, ...})`
selects YM2610 (four FM channels); the default `variant: true` selects YM2610B (six).
For the shared OPM/OPP module, `Ym2151.create({variant: 'ym2164', ...})`
selects YM2164; the default variant is `'ym2151'`. Both retain eight FM channels.

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
```

Set `EMXX` to select an installed Emscripten C++ compiler. The SDK recipe retains
C++14, O2, the existing exports and memory growth settings.
OPN and YM2413 recipes retain their explicit `ASSERTIONS=1`; OPM/OPP and OKIM6258 retain
their existing compiler-default assertion setting.
The OPN/OPM/OPLL synchronous `read()` / `generateStereo()` and OKIM6258
`writeOki6258()` / `processFrames()` APIs are unchanged.

## Fixed source and updates

`third_party/soundchip-sdk.json` records SDK `0.1.1`, source commit
`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`, archive SHA-256, release-manifest
SHA-256 and the complete 379-file snapshot. This is the same source release
used by Playground Tauri. Per-component terms remain in the SDK's `LICENSES.md`
and `vendor/` notices; these seven wrappers, ymfm inputs and the MAME-derived
OKIM6258 adaptation retain BSD-3-Clause.

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
They open no audio device. Binary hashes
can differ with compiler versions or embedded assertion paths; runtime
comparison is separate from binary identity.

The seven module recipes above have switched to this build source. Other chip recipes and
the optional Nuked build continue using their existing inputs. Local `src/`
and `wasm/` copies remain available for those recipes and comparison builds.
