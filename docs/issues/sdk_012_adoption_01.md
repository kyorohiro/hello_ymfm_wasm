# SDK 0.1.2 source release and application adoption

Date: 2026-10-26

## Result

Prepared SDK **0.1.2** from clean commit
`53b33a15f5c4b919b185cb912016eccfbbb6d3a6`, generated a reproducible source ZIP,
and imported that exact archive into the main application and Playground Tauri.
Both pins identify **381 files**, including the release manifest. Sega PSG now
uses `vendor/tetorica_sega_psg/`, with its own BSD license and SMS Power credit.
The shared Tetorica state helper remains in `vendor/ymfm/chip_state.h`.

The preceding SPC fix and Tauri collectors were already committed by the user
when this task began: main `2c0b40e0...`, Tauri `44e2a591...`.

## Source archive

| Field | Value |
| --- | --- |
| Version | `0.1.2` |
| Source commit | `53b33a15f5c4b919b185cb912016eccfbbb6d3a6` |
| Archive | `tetorica-soundchip-native-0.1.2-sources.zip` |
| Archive size | 1,007,976 bytes |
| Archive SHA-256 | `752d0f449fd69300881f7c369f190932154e96ab8fd103676917087a454b8c72` |
| Manifest SHA-256 | `a79387194dd58628988abbf19938175c084246e11cee9d65647881b4bd65d8cf` |
| Members | 380 payload files + 1 manifest |

The archive is available locally at
[`release/tetorica-soundchip-native-0.1.2-sources.zip`](../../release/tetorica-soundchip-native-0.1.2-sources.zip).
It was generated twice with identical bytes. Independent extraction built
19 Native libraries, passed all 24 CTest cases, rendered 18 valid original WAV
examples and passed 10 JavaScript reference checks. Source/include closure
checks confirmed that the extracted package supplies the compilation inputs.

No SDK tag or GitHub Release was published; consumers use the local archive and
record its exact hash and source commit. The SDK commit was pushed for CI.

## Main application

- The importer accepts one complete legacy or separated PSG layout, rejecting
  mixed or incomplete layouts. It still verifies the installed immutable copy
  before an update; an altered 0.1.1 cannot be overwritten by pretending to upgrade.
- Build-route tests and the Game Gear, Master System and Nuked Native comparison
  tools use the new core/include directory. The shared helper remains included.
- The pinned 0.1.1 WASM receipt and all source hashes were verified before the
  update. The old SDK and generated directory were retained outside the checkout.
- All **27 artifacts** were then actually rebuilt from the imported 0.1.2 SDK.
  All **53 JS/WASM outputs are byte-identical** to the previous deployed files.
  Only after this check was `docs/generated/build-info.json` replaced with the
  real new build receipt; no old receipt was rewritten to claim an unperformed build.
- The batch checker reuses that validated build, compares all **39,982 PCM/API
  cases**, and checks all 164 source/build input hashes. Reuse does not count as
  a second compiler execution. Existing calibration numbers and output bytes remain.
- The build guide, Sega PSG notes and both DX7 vendor READMEs describe the new pin.

Local checks passed: importer 19 tests, build routes 109 tests, batch/receipt/DX7
guards 81 tests, and FM npm's isolated installed-runtime/assets/type checks.
The FM package remains unpublished: 816 files, 1,599,186 bytes compressed and
5,963,098 bytes unpacked in this check.

## Tauri

Tauri commit `fe391fb543280a8a3cc2f11c319268c3d538d24e` adopts the same archive.
Its three PSG consumers have the new include path; the core is compiled once
from the separated directory. The installer also includes the PSG's own notice
as `tetorica-segapsg-LICENSE.txt`, alongside the existing ymfm notice.

The 268 C/C++ source/header files are unchanged from 0.1.1, except for the
four-line copyright/SPDX prefix on the two relocated PSG files. Other legacy
Native snapshots are retained unchanged.

| Local check | Result |
| --- | --- |
| Python / Node integration | 22 / 31 passed |
| Cargo | 726 passed, 4 ignored, 0 failed |
| Native Genesis vs WASM | 6 cases, 49,152 stereo frames, max difference `3.725290298461914e-9` |
| Mode lifecycle | 22 modes, 604,032 frames, 88 Run/Stop transitions |
| Additional instances | 3 mixtures, 7 solo sources, 16-slot limit and Stop budget 0 passed |
| Corresponding source ZIP | 1,803 files, all 22 source pins and bundled contents verified |

The main repository's updated Native comparison tools also passed:
Game Gear 69 cases / 454,656 stereo frames / difference 0;
Master System 63 cases / 387,072 stereo frame pairs / difference 0;
Nuked 222 cases / 1,363,968 stereo frames / maximum difference `2.9802322387695312e-8`.
These counters retain their different units and are not combined.

## CI checkpoint

- [SDK run 40297659488](https://github.com/kyorohiro/tetorica-soundchip-native/actions/runs/40297659488)
  targets the SDK source commit above.
- [Tauri run 40297874215](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40297874215)
  targets `fe391fb...`, started by `workflow_dispatch`, without a tag or release.
- Main-repository CI will target the subsequent adoption commit. Final job
  conclusions are recorded below once the runs finish; dispatch alone is not success.

Machine-readable evidence: [sdk_012_adoption_01.json](sdk_012_adoption_01.json).
Full local logs and per-core reports are under `/private/tmp/tetorica-sdk-012-adoption/`.
Browser scheduling, installer UI and listening on physical hardware are separate
from these source/build and offline PCM checks.
