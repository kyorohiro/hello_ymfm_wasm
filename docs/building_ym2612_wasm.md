# Building YM2612, YM2203 and YM2608 WASM from the fixed SDK

The normal ymfm YM2612, YM2203 and YM2608 builds use the complete local SDK source release at
`third_party/tetorica-soundchip-native/`. A fresh checkout contains the source,
build recipes, provenance and component licenses. No SDK checkout, submodule,
download or synchronized edit of another repository is required.

## Build

Install Emscripten and Python 3, then run:

```sh
python3 scripts/import_soundchip_sdk.py --check
sh scripts/build_ym2612_wasm.sh
sh scripts/build_ym2203_wasm.sh
sh scripts/build_ym2608_wasm.sh
```

Each build verifies the snapshot before invoking the SDK's original chip
recipe. It produces the corresponding `docs/generated/ym2612_wasm.js` /
`ym2612_wasm.wasm`, `ym2203_wasm.js` / `ym2203_wasm.wasm`, or
`ym2608_wasm.js` / `ym2608_wasm.wasm` pair.
The YM2203 recipe also retains its generated-glue whitespace cleanup using Perl.
With Node.js available, the SDK also writes
`docs/generated/build-info.json` with compiler version, source hashes and
output hashes. Building one chip preserves the other chips' existing records.
These are build records; consumers still load the same JS/WASM pairs through
the existing `Ym2612`, `Ym2203` and `Ym2608` APIs.

An optional output directory is resolved relative to the caller's working
directory. The build script itself can be invoked from outside the checkout:

```sh
sh /path/to/checkout/scripts/build_ym2612_wasm.sh ./ym2612-output
sh /path/to/checkout/scripts/build_ym2203_wasm.sh ./ym2203-output
sh /path/to/checkout/scripts/build_ym2608_wasm.sh ./ym2608-output
```

Set `EMXX` to select an installed Emscripten C++ compiler. The SDK recipe retains
C++14, O2, runtime assertions, the existing exports and memory growth settings.
The synchronous `read()` and `generateStereo()` APIs are unchanged.

## Fixed source and updates

`third_party/soundchip-sdk.json` records SDK `0.1.1`, source commit
`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`, archive SHA-256, release-manifest
SHA-256 and the complete 379-file snapshot. This is the same source release
used by Playground Tauri. Per-component terms remain in the SDK's `LICENSES.md`
and `vendor/` notices; these three wrappers and ymfm inputs retain BSD-3-Clause.

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
```

The Python tests verify offline imports and a fresh-copy build route using a
recording compiler. The Node checkers compare actual WASM PCM,
read/status/IRQ, reset and state restoration, including multiple clocks and
irregular render blocks. YM2612 also checks internal envelopes; YM2203 checks
FM/SSG, prescalers, source/channel mutes and engine resampling.
YM2608 also checks rhythm and ADPCM-B playback, memory transfers and saved
sample memory using original synthetic test data.
They open no audio device. Binary hashes
can differ with compiler versions or embedded assertion paths; runtime
comparison is separate from binary identity.

Normal YM2612, YM2203 and YM2608 have switched to this build source. Other chip recipes and
the optional Nuked build continue using their existing inputs. Local `src/`
and `wasm/` copies remain available for those recipes and comparison builds.
