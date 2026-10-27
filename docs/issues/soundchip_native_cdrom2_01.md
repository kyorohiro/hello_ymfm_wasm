# CD-DA and MSM5205 SDK source aggregation

Status: **implemented and verified locally, 2026-10-28**. The changes are in
`w/tetorica-soundchip-native`; no commit, push, tag or publication was performed.
The existing SDK `0.1.5` candidate metadata is retained. No consumer SDK pin,
Playground runtime, Mixer default, Tauri source or npm package was changed.

## Included components

| Component | Source | Native target / header | WASM selector |
| --- | --- | --- | --- |
| CD-DA stereo PCM device | `vendor/tetorica-cdda/` | `tetorica::cdda`, `<tetorica/cdda.h>` | `cdda` |
| MSM5205 raw decoder / PC Engine ADPCM RAM driver | `vendor/tetorica-msm5205/` | `tetorica::msm5205`, `<tetorica/msm5205.h>` | `msm5205` |

The original C11 cores, original headers and WASM bridges are byte-identical to
the main application at `d216b0d63f5061fa2e61262d6298d904076f81a6`. BSD-3-Clause
licenses and notices are included with per-file provenance and SHA-256 records.
SDK-owned build glue and documentation are identified separately. The existing
libvgm source snapshot and Analyzer JavaScript decoder remain reference material;
the compiled MSM5205 module uses the application's C11 port.

These two modules are cataloged under `applicationAudio`. The existing **24 chip
IDs**, all **29 chip WASM recipes** and all prior imported component records are
unchanged. CD-DA is a PCM device rather than a new generic chip factory ID.
Source parsing, sample encoding, scheduling, synchronized source lifetime,
Mixer/pan and audio-device output remain host responsibilities.

The SDK now has 23 static libraries, 28 public aliases/headers and 31 WASM build
selectors. Each new WASM uses the separate `standalone-audio-wasm` format: a small
ES-module descriptor plus an import-free raw WASM module, fixed 128 KiB memory
and at most 128 stereo output frames per call. The descriptor is not an
Emscripten factory. CD-DA uses a 4 KiB host-refreshed PCM window; MSM5205 has a
64 KiB encoded source area. Neither core allocates memory or opens a device.

See the SDK's [Native guide](../../w/tetorica-soundchip-native/native/README.md),
[CD-DA component](../../w/tetorica-soundchip-native/vendor/tetorica-cdda/README.md)
and [MSM5205 component](../../w/tetorica-soundchip-native/vendor/tetorica-msm5205/README.md).

## Verification

- Source inventory: **306 snapshot records** pass hash/license checks.
- Python: **88 audit/release regressions pass**, including duplicate/missing
  module entries, source/license tampering, header/alias mismatches, paired
  source/WASM identity and rejection of parity requests without a target.
- A source ZIP extracted outside the checkouts builds all **23 libraries** and
  **49 executables**: 28 fixtures plus 21 examples. **29/29 CTest entries pass**.
  All **21 examples** generate three seconds of 48 kHz stereo PCM16 without
  clipping. The two unchanged JavaScript references pass their 10 smoke checks.
- The new two C11 fixtures and one C++14 HuC6280/MSM5205/CD-DA co-link fixture also
  pass from a standalone `cmake -S native` Release build.
- Both WASM pairs build from the SDK checkout and from the extracted source ZIP.
  Their JS and WASM bytes exactly match `web/generated/` in the main application.
  Archived and independently rebuilt modules pass standalone ABI smoke checks.
- C11 cores / C++14 callers match actual WASM PCM and state exactly: CD-DA at
  8/44.1/48/384 kHz; MSM5205 at 44.1/48 kHz, including raw FIFO behavior, all 16 PCE
  rate values, an alternate clock, odd nibble ranges and render partitions.
  MSM5205 also matches the unchanged JavaScript oracle. This proves agreement of
  the tested models, not equivalence to physical hardware.
- The final source/WASM ZIPs pass manifest, provenance, companion-source,
  JavaScript smoke, WASM smoke and actual Native/WASM parity checks.

The full-build archive checker initially exited 1 at its final CD-DA rebuild
because the sandbox prevented writing an Emscripten toolchain-cache lock.
The failed subprocess was retried with cache access. Both source-only WASM
rebuilds and their smokes/parity then passed separately. The final archive audit
also returned exit 0. No source-code workaround was needed for that restriction.

Only verification documentation, the four-line parity admission guard and its
regressions changed between the full-build archive and the final archive.
All Native/WASM build inputs are byte-identical. The final checker exercises the
updated guard and dispatch against both real packaged modules.

The CI workflow now includes CD-DA/MSM5205 WASM jobs alongside YM2612, WonderSwan
and POKEY. Its five-platform Native matrix is retained. Remote CI and physical
listening were not run for this task.

## Original offline example

`tetorica_pcengine_cd_wav [output.wav]` auditions HuC6280, MSM5205 and CD-DA
individually, then together. All source data is generated in the example; no disc,
ROM, BIOS or npm dependency is needed. It defaults to `pcengine-cd.wav`.

The rendered three-second file has 144,000 frames. Solo RMS values are
approximately 0.05679 / 0.07070 / 0.05656, the combined peak is 0.30832 and the
last 0.2 seconds are exactly zero. The example applies a single 0.5 master scalar;
core PCM and application Mixer defaults are unchanged.

Local preview: `/private/tmp/sdk-pcengine-cd.wav`, SHA-256
`ee6bdfa3675271fd338b1645b7d422fe64759aa01540ead24fb4abacdf64ff9f`.
The isolated full-build output has the same bytes.

## Reproduce and resume

From `w/tetorica-soundchip-native`:

```sh
python3 scripts/check_sdk.py
python3 -m unittest discover -s tests -p 'test_*.py'
cmake -S . -B build/native -DCMAKE_BUILD_TYPE=Release
cmake --build build/native --config Release
ctest --test-dir build/native -C Release --output-on-failure
sh scripts/build-wasm.sh cdda build/application-audio
sh scripts/build-wasm.sh msm5205 build/application-audio
node tests/application_audio_wasm_smoke.mjs build/application-audio
node tests/check_application_audio_core.mjs --wasm-dir build/application-audio --artifact all
python3 scripts/package_release.py --out-dir releases --wasm-dir build/application-audio
python3 tests/check_standalone_release.py \
  --source-zip releases/tetorica-soundchip-native-0.1.5-sources.zip \
  --wasm-zip releases/tetorica-soundchip-native-0.1.5-wasm.zip \
  --application-audio-parity
```

Final local candidates are under `/private/tmp/sdk-cdrom2-archives-final/`:

| Archive | SHA-256 |
| --- | --- |
| `tetorica-soundchip-native-0.1.5-sources.zip` | `824f4c218d086f439c66f36a46c353c66ab96bc6f333292846351ae86e988985` |
| `tetorica-soundchip-native-0.1.5-wasm.zip` | `09a6676c03988001fe97ea9e8edc5f3f9fa1e6f3d026c5a2b57910080634e977` |

The same directory contains `SHA256SUMS`. These are verification candidates,
not published assets. The SDK base commit is
`a99606e` and its full changed-file hashes and detailed receipts are recorded in
[soundchip_native_cdrom2_01.json](soundchip_native_cdrom2_01.json).
The next separate step is reviewing/committing the SDK changes and checking its
remote CI before deciding on SDK publication and consumer adoption.
