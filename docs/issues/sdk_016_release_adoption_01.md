# SDK 0.1.6 public release and application adoption

2026-10-29 JST. **The SDK v0.1.6 release is published, and the actual public source ZIP has been adopted and verified in the main application and Playground Tauri.** The SDK release commit/tag is pushed. The user committed and pushed the main adoption as `9cb0ab772763c5f1583b76023b3461b657c8fb2d` and Tauri adoption as `6ac2f78d204c5055de0dc1f6576d05979e0397b2` (both titled `tetorica-fm2612 0.2.33`). Final release-record edits may remain uncommitted. npm [`tetorica-fm2612 0.2.33`](https://www.npmjs.com/package/tetorica-fm2612/v/0.2.33) is also published; its separate publication evidence is in [the npm release record](npm_ps1_mixer_release_01.md).

## Published source and fixed pins

[SDK v0.1.6](https://github.com/kyorohiro/tetorica-soundchip-native/releases/tag/v0.1.6) was published at `2026-10-28T22:27:29Z` (2026-10-29 07:27:29 JST), with source commit `ba2a52943f0ac43b02b57f07b48ffb8b3ccb54f6`. It is a public, non-draft, non-prerelease release.

| Item | Verified value |
| --- | --- |
| Source archive | `tetorica-soundchip-native-0.1.6-sources.zip` |
| Archive size | 1,246,902 bytes |
| Archive SHA-256 | `2e6126935756c517d10cc6849977fb0132387e7abf6160185c341ea67b4fcc17` |
| Release-manifest SHA-256 | `e0a86268aaa3dbbb2bf0567bf2a11925bf8da785b846b58ea4b8f71d280adfeb` |
| `SHA256SUMS` SHA-256 | `1493cddf847946845c13baa18e4aeb82822f0994269bd67c8449b06e311819ce` |
| Complete source closure | 454 payload files plus the manifest: 455 archive members |

The public download matched GitHub asset digests and the published checksum file. ZIP CRC, every manifest size/hash, and byte equality with the prepared release archive passed. Main `third_party/soundchip-sdk.json`, Tauri `src-tauri/soundchip-sdk.json`, generated PS1 build receipts and distributed source receipts now carry the same formal pin, without `localCandidate`.

The catalog retains 29 chip WASM recipes, two separate application-audio recipes (CD-DA/MSM5205), and one PS1 SPU instrument recipe: **32 builds and 63 outputs**. PS1 remains an instrument category. Its Playground API does not add PS1 to the npm package-root generic chip factory.

## Source equivalence and preserved runtime bytes

The candidate source ZIP (`3c7c2a9cdfcb0316162f6365aef89f0c9fd92140ae4828599cd613255d153952`) remains historical evidence. Comparing all 455 candidate archive files with the formal snapshot found **449 unchanged files**, five changed Markdown documents (`CHANGELOG.md`, `README.md`, `docs/releases.md`, `docs/verification.md`, `tests/README.md`) and the regenerated manifest. No recorded core, bridge, compiler recipe or other build input changed.

The main PS1 wrapper regenerated its build receipt from the formal pin. All **77 deployed JS/WASM files** captured before adoption still have exactly the same bytes and SHA-256. SDK archive/manifest provenance and source-bundle receipts changed; runtime binaries did not. Historical calibration reports remain unchanged.

A read-only audit of [WASM SDK CI run 40778420584](https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/40778420584) verified the complete relationship to that earlier candidate:

- All **608 build-source records across 192 unique paths** match the formal SDK; every recorded source fingerprint verifies. The groups retain 589 records for 29 chip builds, eight for two application-audio builds, and 11 for PS1. Group path counts overlap and are not summed as independent inputs.
- All **63 outputs** match the artifact, CI reference outputs and current `docs/generated/` files. All **30 checker scripts** match the current repository.
- Artifact CRC and the separately extracted summary match. Across 30 JSON reports, **182 contained members / 184 path-hash records / 254 references** verify: 38 logs, 29 detailed reports, 57 rebuilt files, 57 reference files and one PS1 Native fixture. The 2,594 repository/checker or relative paths absent from the artifact are excluded from this contained-member count and retain that scope in the evidence.
- The archived run reports **40,474 exact chip comparisons**, successful CD-DA/MSM5205 checks and PS1 Native/WASM parity over **98,828 interleaved samples, maximum difference zero** (tolerance `1e-6`). Its PS1 smoke exercised 24 voices and 311,605 rendered frames.

That CI run compiled the earlier candidate. This source-equivalence audit does not relabel it as a CI build of the published archive and executed no compiler, browser or fresh PCM comparison.

## Post-adoption verification

The main Node SDK/inventory/receipt/runner regression group passed **116 tests**, with zero failures or skips. The Python archive/importer/build-routing suite (`python3 -m unittest discover -s test -p 'test_*sdk*.py' -v`) passed **142 tests**, with zero failures or skips.

The standalone distributed-source checks rebuilt without an SDK checkout and verified exact generated JS/WASM equality. PS1 retained its full **24 authenticated SDK inputs / 28 exported source files**. Each CD-DA and MSM5205 bundle retained **six SDK inputs / eight exported source files**, with C11 and C++14 checks. The initial sandbox attempts were denied access to Emscripten's installed cache lock; their logs remain preserved, and the approved reruns passed.

Both current Playground ZIPs passed CRC checks:

| Archive | Bytes | Entries / files | SHA-256 |
| --- | ---: | ---: | --- |
| Full `hello_ymfm_wasm_dev_itch_playground.zip` | 37,009,456 | 1,187 / 1,066 | `3f1ae1dcb640b6d6f6f0a9d39b3fac4392e81eb1df782234216d6bd3428cab36` |
| Run `hello_ymfm_wasm_dev_itch_playground_for_run.zip` | 37,398,287 | 931 / 931 | `9c3f59378c7829061ecd76020cafff55e3bf8ce5a05660419295cec0524cb3f1` |

The full archive includes `samples/.DS_Store`; Tauri's existing importer excludes this metadata and imports **1,065 files**. Its `release.lock.json` identifies the full ZIP above. The import also carries the main application's already generated PS1/WonderSwan/POKEY calibrated Mixer policies and two UI cache version tokens. This is separate from the SDK provenance update; Native core sources and generated chip outputs retain their bytes.

Tauri verification passed:

- Public SDK source pin and imported frontend checks; Native/frontend pins equal, with 455 source members and no candidate marker.
- **31 Python and 31 Node tests**, including SDK receipt corruption, immutable snapshot replacement and published-update coverage.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml native_genesis`: **757 passed, zero failed, two ignored, 38 filtered out**. The ignored tests are the explicit monitor microbenchmark and system audio-device smoke. They were not executed.
- All **24 offline source/snapshot checks** and the complete matching Native source archive: **2,085 source files**, SHA-256 `6030f1d16dc58480aa6841043c95b12c754a3e206c024a72127b38527ced3234`. Its recorded frontend hash equals the full ZIP above. The verifier records `deviceOpened: false` and `networkUsed: false`.

## Evidence and remaining publication scope

Machine-readable results, raw evidence sizes/SHA-256 values, complete runtime preservation hashes, source-closure counts and repository states are in [sdk_016_release_adoption_01.json](sdk_016_release_adoption_01.json). Primary local evidence is `/private/tmp/sdk-016-published/public-verification.json`, `/private/tmp/sdk-016-consumer-before.json`, `/private/tmp/sdk-016-ci-source-equivalence.json`, `/private/tmp/sdk-016-tauri-import-audit.json` and `/private/tmp/sdk-016-tauri-sources-check.json`; regression and rebuild logs use the `/private/tmp/sdk-016-` prefix.

[PS1 SDK/Native implementation](ps1_sdk_native_01.md), [prior remote CI](ps1_remote_ci_01.md) and the original calibration reports retain their historical statuses and bytes. This new record supersedes their unpublished-candidate status only for the formal release/adoption described here.

No Desktop application release, itch upload or hardware listening was performed. The earlier validation snapshot preceded the user commits above; integration code is now committed and pushed. Later record edits may remain uncommitted. npm [`0.2.33`](https://www.npmjs.com/package/tetorica-fm2612/v/0.2.33) publication completed successfully: registry version/latest and the downloaded published tarball match the verified release archive. Its tarball, registry integrity and publication result are documented separately in [npm_ps1_mixer_release_01.md](npm_ps1_mixer_release_01.md).
