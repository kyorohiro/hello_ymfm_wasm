# SDK 0.1.5 release and CD-ROM² consumer adoption

Status: **released and adopted locally, 2026-10-28**.

The SDK release is published. Main application and Playground Tauri changes are
local and uncommitted. No npm package, itch.io upload or desktop app release was
published by this task.

## Published SDK

- Release: [tetorica-soundchip-native v0.1.5](https://github.com/kyorohiro/tetorica-soundchip-native/releases/tag/v0.1.5).
- Commit: `3bb8d9ceffa50ad183d1ab856e031fe649425bca`.
- Source asset: `tetorica-soundchip-native-0.1.5-sources.zip`, 1,165,195 bytes,
  **431 members**, SHA-256
  `e37be75316a35a4159d8760afa9e4b86a9a4b8d4d24f674cc15e3e5e52c44309`.
- Manifest SHA-256:
  `e2b5703a2bbf44323d5331b522aa167fa091fcb13ceadebe14d021efe3aa07e7`.
- [Branch validation](https://github.com/kyorohiro/tetorica-soundchip-native/actions/runs/40585529737)
  passed all ten jobs at aggregation commit `52062d0`. The release metadata then
  aligned CMake with SDK version 0.1.5 and included CD-DA/MSM5205 in its changelog.
- [Tag validation and publication](https://github.com/kyorohiro/tetorica-soundchip-native/actions/runs/40586736443)
  passed all five Native jobs, five WASM jobs and publication. Native platforms
  were Windows x64, Linux x64/ARM64 and macOS Intel/Apple Silicon. WASM jobs were
  YM2612, WonderSwan, POKEY, CD-DA and MSM5205.

The downloaded public ZIP is byte-identical to the locally audited release
candidate and its payload matches the tagged SDK checkout. Its digest matches
GitHub's published asset metadata; the canonical checksum line also hashes to the
published `SHA256SUMS` asset digest. Existing v0.1.4 assets were left untouched.
Both consumer pins identify this release, without a local-candidate marker.
Their `archiveName` preserves the local download filename ending in
`-published-sources.zip`; it identifies the same public asset bytes above.

## Main application

The two C11 modules now build from the fixed SDK. The former `native/cdda/` and
`native/msm5205/` mirrors were removed after proving their core, header and bridge
bytes equal the released SDK. Exported source bundles retain their existing
`sources/native/{cdda,msm5205}/` layout for users.

Inventory verification distinguishes **29 chip artifacts** from **two
application-audio modules**. All 31 have fresh build receipts. The new module
checks enforce complete source fingerprints, descriptor/raw-WASM pairs, control
ABIs, no imports and fixed 128 KiB memory without executing a start function
during metadata validation. Historical 29-build snapshot validation is retained.

Validation passed:

- All **31 actual fixed-SDK builds**, **183 source inputs**, **61 unique output
  files**. All **75 deployed files** across `docs/generated` and `web/generated`
  remain byte-identical to their pre-adoption versions; only receipt metadata
  changed.
- **40,474 exact chip comparisons**, plus actual CD-DA/MSM5205 Native/WASM checks
  and the unchanged raw MSM5205 JavaScript oracle. Repository inputs stayed
  unchanged throughout the final comparison.
- **125 Node**, **55 audio unit**, **25 Python importer** and **three build-route**
  tests. Routing tests reject a dirty SDK before compilation and cover toolchain
  paths containing spaces, default output paths and SDK-only compiler inputs.
- Actual main audio core checks: CD-DA at four rates, 1,442,066 frames; MSM5205 at
  two rates in six scenarios, 97,438 frames. C11 and C++14 callers pass.

CI now names all 31 builds, includes the new module/tamper/routing checks and
rebuilds both exported source bundles. This main-repository workflow change has
not been run remotely during this task.

## Tauri Native Audio

Tauri imports the same complete SDK ZIP. `build.rs` compiles the two C11 cores and
headers directly from its vendored SDK. The former local `native-cdda/` and
`native-msm5205/` originals were removed. No Rust source, API, clock, scheduling or
Mixer gain changed. All **284 common SDK C/C++/header inputs** and the four audio
core/header inputs remain byte-identical to the former providers.

Sync tools now perform read-only fixed-SDK verification rather than copying into
the vendor tree. They compare both pins and the core/header/license/NOTICE
closure. Import guards retain historical snapshot validation while rejecting
partial new audio modules.

Validation passed: **780 Cargo tests**, four existing ignored tests, **30 Python
tests** and **24 offline source pins**. The full Cargo retry used one harness
thread after sandbox port restrictions and a loaded parallel run affected three
unrelated MCP/QuickJS cases; no production workaround was added. Test-internal
concurrency checks were retained. Desktop application CI and GUI listening were
not run for these local consumer changes.

## Source bundles and distribution checks

Both source bundles include their SDK receipt, core/header/bridge, relocated
standalone recipe, BSD license and NOTICE. CD-DA is also listed explicitly in
distribution license indexes. From a directory without the SDK or importer,
both recipes reproduce the deployed descriptor and WASM exactly and compile
their cores as strict C11 and C++14.

The current npm stage/tarball passes installed-runtime, real WASM, Synth/sample/
keyboard and positive/negative NodeNext/Bundler type checks: **935 package
members**, SHA-256
`9217432e28bddbb4b65ff9e3f4f77193de3df0d090016399f9c54ff6482b0c2b`.
It remains version **0.2.32**, is a local verification artifact and was not
republished. A future npm publication needs a new version.

The local Playground ZIP is
`release/hello_ymfm_wasm_sdk-015-cdrom2-dev_itch_playground.zip`: **1,004 files**,
SHA-256 `e3f63f9fea0f948879ae9c43afa8c7615b18b856e53173615d7cba771f4f7449`.
Every ZIP member matches the stage, and both embedded source bundles pass their
receipt/hash checks. Tauri's import verifies **1,003 effective frontend files**
against that archive. Its regenerated corresponding-source ZIP records **1,995
source files**, SHA-256
`d43176f2d17940a06527e30e61a1079290a310f24968c45c0d5f0b44576824bf`.
All 24 offline source checks, the fixed SDK, frontend lock and corresponding
source ZIP agree. Detailed metrics are in the JSON receipt.

Emscripten/npm cache writes required sandbox escalation, and SSH push credentials
were unavailable. The release push succeeded through HTTPS using the existing
GitHub credential helper. No repository remote, global credential configuration
or sound-generation behavior was changed.

Detailed evidence, archive identities and test results are in
[sdk_015_cdrom2_release_adoption_01.json](sdk_015_cdrom2_release_adoption_01.json).
The next separate step is committing the consumer changes and validating the
desktop application CI before an app release.
