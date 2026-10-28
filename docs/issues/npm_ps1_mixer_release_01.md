# PS1, sample encoders and calibrated Mixer npm release

Status: **preparing `tetorica-fm2612 0.2.33`; not yet published**.

The registry was checked on 2026-10-29: `tetorica-fm2612` and its `latest` tag
were `0.2.32`, and `0.2.33` was unused. The baseline is the published 0.2.32
release recorded in [npm_cdrom2_release_01.md](npm_cdrom2_release_01.md) and
repository commit `f3d87211`.

The release contains the accumulated changes since 0.2.32:

- Experimental standalone PS1 SPU core and 24-voice tuned Synth, fixed-rate
  resampling, named ADSR and approximate reverb, PCM-to-SPU ADPCM encoding,
  sample conversion/comparison and isolated actual-core preview. Playground
  runtime integration provides primary/additional SPUs, Main/Worker control,
  sample instruments and compatible Tauri Native playback. The package-root
  generic chip factory remains separate from the Playground PS1 API.
- Pure JavaScript SNES BRR and Neo Geo ADPCM-A encoders, plus Game Boy sample
  waveform comparison and isolated actual-core audition helpers.
- The opt-in calibrated Mixer preset now covers 25 sources, adding PS1,
  WonderSwan and POKEY to the prior 22. Saved common/per-ID values retain their
  precedence, and raw chip PCM and separate endpoint gains are unchanged.
- Published fixed SDK 0.1.6 source adoption, complete source/license bundles,
  source receipts, generated declarations and standalone rebuild recipes.
  CD-DA and MSM5205 remain separate application-audio APIs.

The package version and npm README are prepared. The formal
[SDK v0.1.6 release](https://github.com/kyorohiro/tetorica-soundchip-native/releases/tag/v0.1.6)
was published and its source archive adopted by both the main application and
Tauri. The main application's `third_party/soundchip-sdk.json` records source
commit `ba2a52943f0ac43b02b57f07b48ffb8b3ccb54f6`, source ZIP SHA-256
`2e6126935756c517d10cc6849977fb0132387e7abf6160185c341ea67b4fcc17`,
manifest SHA-256
`e0a86268aaa3dbbb2bf0567bf2a11925bf8da785b846b58ea4b8f71d280adfeb`
and 455 files. This published source pin replaces the earlier local-candidate
provenance. Final 0.2.33 tarball validation and npm publication have not yet
been recorded here; previous implementation reports describe historical local
validation.

The post-adoption Python importer and build-routing regression suite passed:
`python3 -m unittest discover -s test -p 'test_*sdk*.py' -v`, **142 tests**,
zero failures or skips. It covers SDK archive/pin validation and isolated
compiler-route fixtures, including CD-DA/MSM5205 and PS1. The log is
`/private/tmp/sdk-016-python.log`. This suite does not establish final npm
tarball parity or real-core audio output.

A read-only audit of the prior CI artifact
`/private/tmp/wasm-sdk-40778420584.zip` found all **608 build-source records
across 192 unique paths** equal to the now-published SDK snapshot, and all
**63 outputs from 32 builds** byte-identical to current `docs/generated/`.
The artifact's 38 logs, 29 detailed reports, recorded generated files and PS1
Native fixture passed their contained hash checks; its ZIP CRC and separately
extracted summary also matched. All 30 recorded checker scripts match the
current repository. The archived run reports 40,474 exact chip comparisons,
passing CD-DA/MSM5205 checks and PS1 Native/WASM parity over 98,828 interleaved
samples with maximum difference zero.

That CI run compiled the earlier local SDK candidate, rather than the formal
release archive. Comparing all 455 candidate archive files with the formal
snapshot found 449 unchanged files, five changed Markdown documents
(`CHANGELOG.md`, `README.md`, `docs/releases.md`, `docs/verification.md`,
`tests/README.md`) and the regenerated `RELEASE-MANIFEST.json`; no recorded
build input changed. This audit executed no compiler or audio check and does
not relabel the historical CI run as a build of the official archive. Detailed
evidence is `/private/tmp/sdk-016-ci-source-equivalence.json`.

Final release evidence must identify the exact tarball and hashes, isolated
installation and consumer types, actual WASM/core and relevant browser checks,
source/license closure, and registry parity after publication. These results
will be recorded in `npm_ps1_mixer_release_01.json` and this status updated
after publication. Prior candidate counts and test results are historical and
are not assertions about the final artifact.

Implementation evidence: [PS1 SDK/Native integration](ps1_sdk_native_01.md),
[PS1 clock/PCM checks](ps1_audio_clock_01.md),
[PS1 Sample Editor](ps1_sample_editor_01.md),
[PS1 calibration](ps1_chip_levels_01.md),
[WonderSwan calibration](wonderswan_chip_levels_01.md),
[POKEY calibration](pokey_chip_levels_01.md),
[SNES BRR encoder](brr_encoder_01.md),
[Neo Geo ADPCM-A encoder](adpcm_a_encoder_01.md), and
[Game Boy sample preview](gameboy_sample_preview_01.md).
