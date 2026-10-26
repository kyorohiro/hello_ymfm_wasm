# Sega PSG source separation and provenance review

Date: 2026-10-26

## Result and scope

Sega PSG is a Tetorica implementation that was historically stored beside
ymfm. The main source now lives in
[`third_party/tetorica_sega_psg`](../../third_party/tetorica_sega_psg/README.md),
with an explicit BSD-3-Clause license, copyright 2026 kyorohiro, and credit to
Maxim and contributors for [SMS Power!'s SN76489 hardware documentation](https://www.smspower.org/Development/SN76489).

The authoritative `w/tetorica-soundchip-native` checkout has the corresponding
`vendor/tetorica_sega_psg/` directory. Its WASM recipe, Native CMake target,
catalog, license index and component notes use the separated source.
The main and SDK `.cpp`/`.h` copies are identical. The complete synthesis and
API bodies are unchanged; only a four-line copyright/SPDX prefix was added.

The user selected **source separation now, pinned SDK update later**.
Both applications' fixed SDK 0.1.1 snapshots retain their original paths and
contents: 379 files in the main application and 379 in Tauri. SDK version,
pins, receipts, published packages and deployed runtime files are unchanged.
The working SDK relocation belongs in the next SDK release and import.

## Provenance review

The review started from main commit
`bc85574b27e2a9d84ae4a7d90ac4280fa05b8627` and SDK commit
`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`.

- `54e2aa8d` (2026-08-15) introduced the standalone `SegaPSG` class and WASM bridge.
- `cbc42183` corrected reset, register writes, zero/one periods and noise-divider phase.
- `25a2fe3a` introduced Tetorica's shared `ChipStateIO` field serialization.
- `6a32398b` and `14db588e` added channel muting and Game Gear stereo.

The first/current sources and these changes were compared with official MAME
[`sn76496.cpp`](https://github.com/mamedev/mame/blob/6ec57cdad916c9879251f64dc20412304bb14e24/src/devices/sound/sn76496.cpp)
and [its header](https://github.com/mamedev/mame/blob/6ec57cdad916c9879251f64dc20412304bb14e24/src/devices/sound/sn76496.h),
at revision `6ec57cdad916c9879251f64dc20412304bb14e24`, and the
[last master revision before local creation](https://github.com/mamedev/mame/tree/783ee569f268dc60af4b05add5f444dfe69a98fc/src/devices/sound).
The two inspected MAME versions have identical source hashes.

No distinctive copied MAME implementation or comments were found in the
inspected sources and history. The local channel structures, register dispatch,
generation, noise stepping and state serialization differ from MAME's device
implementation. Forty token comparisons corroborated that review: the longest
literal run was 11 tokens for a hardware register-mask/shift expression;
identifier normalization reached 13 tokens of generic syntax. No runs of
20 tokens were found. Token similarity alone does not establish provenance.
MAME's inspected SN76496 files themselves carry BSD-3-Clause and Nicola Salmoria's
copyright; a project-wide license assumption was not used.

This supports treating the code as a Tetorica implementation within the reviewed
scope. It does not prove that no external code was ever consulted. The user's
recollection supplies the historical SMS Power reference; the first commit did
not record a URL. The reference was checked for technical consistency and is
credited as hardware documentation, without relicensing that documentation or
its downloadable sample code.

## Integration and packaging

- `src/segapsg.cpp` and `.h` remain as compatibility includes. Compile the old
  or new `.cpp` once, with `-Ithird_party/tetorica_sega_psg -Isrc`.
- `src/chip_state.h` stays the shared Tetorica helper. The SDK keeps its shared
  copy in `vendor/ymfm/chip_state.h`; this path does not imply ymfm authorship.
- Full runtime, FM npm, Playground, Synth and Analyzer packaging include the
  PSG-specific BSD notice, reference README and self-contained source recipe.
  Packaging checks the core body, bridge, helper and recipe against the fixed
  SDK before copying. Redistribution adds the explicit Tetorica notice without
  rebuilding or replacing deployed runtime files.
- Tauri's three legacy snapshot collectors select the canonical source rather
  than the compatibility includes. A future sync names the separate notice
  `LICENSE.segapsg`, avoiding collision with ymfm's `LICENSE`. Actual snapshots,
  source manifests, `build.rs` and the SDK pin were not resynchronized.

## Verification

- SDK collection: **22 chips, 27 WASM recipes, 278 snapshot records** verified.
- Separated SDK: actual Emscripten 6.0.6 WASM build succeeded. The resulting JS
  and WASM are byte-identical to the deployed pair.
- Existing real-core comparison: **7,074 cases**, maximum PCM difference **0**.
  Covers three clocks and output rates, tone/noise/attenuation, Game Gear stereo,
  muting, reset, owned/borrowed generation, Genesis mixing and VGM checkpoint/seek.
  Includes 414 own-state loads, 324 cross-build state loads and 432 reset/replays.
- Native: configured and built `tetorica_segapsg_fixture` from the separated
  source; `tetorica.segapsg.self_test` passed.
- Main C++: canonical source and old compatibility source both compile with
  the documented include directories.
- FM npm: tarball payload, installed runtime/real cores and type checks passed.
- Playground, Synth and Analyzer: all three ZIPs built and dependency checks
  passed. Each includes the 11-file PSG source/notice payload and unchanged
  generated pair. The source-only package rebuilt to byte-identical JS/WASM.
- Fixed-SDK regression suite: **109 tests passed**; fixed snapshots and all
  54 files in `docs/generated` match the pre-change hashes.
- Tauri collectors: existing snapshot checks passed for Genesis, Game Gear and
  Master System. Thirteen isolated future-sync/negative checks passed, including
  missing canonical source, notice tampering and separate license destinations.

The machine-readable [evidence summary](segapsg_provenance_layout_01.json)
records source hashes, reference URLs, comparison data and build receipts.
Large local reports are retained under `/private/tmp/tetorica-segapsg-layout/`
and `/private/tmp/tetorica-segapsg-provenance/`. This task did not perform a
listening or hardware-accuracy test.
