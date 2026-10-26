# SDK 0.1.4 adoption in the application and Playground Tauri

Date: 2026-10-27

## Result

Both consumers now contain the same **395-file SDK 0.1.4 source release**.
The application builds all **28 WASM artifacts** from that immutable snapshot,
including WonderSwan. Its earlier standalone recipe/receipt has been replaced
by the normal SDK dispatcher and central `docs/generated/build-info.json`.
Playground Tauri uses the same source ZIP and the updated frontend archive.

All **55 generated JS/WASM outputs are byte-identical** to the previously
deployed files. Existing PCM, public APIs, Mixer values and speaker correction
are preserved. WonderSwan's Tauri Native Audio adapter remains the next task;
adding its sources to the SDK does not enable that backend by itself.

## Official source release

| Field | Value |
| --- | --- |
| Release | [v0.1.4](https://github.com/kyorohiro/tetorica-soundchip-native/releases/tag/v0.1.4) |
| SDK source commit | `6f8b872b6f35f5df619b2468d58da57037c96e07` |
| Archive | `tetorica-soundchip-native-0.1.4-sources.zip` |
| Archive bytes | 1,051,025 |
| Archive SHA-256 | `f173092241badd27c84d6846a69bd175375f080a57fdaf4983c56751c201f65e` |
| Manifest SHA-256 | `61354b939961eea8c2c058ca08c682fb1fdc48cf58373a45da2b468455227924` |
| Members including manifest | 395 |

The published archive and `SHA256SUMS` were verified before importing.
Both importers subsequently passed offline verification. The SDK repository
itself was not edited during adoption. Relative to 0.1.2, the archive adds
14 payload files, changes 20 metadata/documentation/build/test files, and
retains 360 existing payload files byte-for-byte; none were removed.
Existing Native runtime source files are unchanged.

## WASM migration and comparison

Before upgrading, the old SDK pin, source snapshot and generated outputs were
copied outside the checkout. The old 27-artifact receipts, all 164 recipe inputs,
and the separately recorded WonderSwan outputs were verified. The original
eight WonderSwan source/recipe inputs were also retained for its historical
standalone audit.

All 28 artifacts were then compiled with Emscripten 6.0.6 from the imported SDK.
The new receipts verify **170 unique recipe/source inputs** and all 55 outputs.
Only after checking the new outputs against the frozen old bytes was the real
new central receipt copied into `docs/generated/`. No old receipt was edited to
claim a build that had not run. The three DX7 binary copies still match.

The strict inventory and batch runner now require all 28 artifacts/55 outputs;
WonderSwan has no special coexistence exemption. Its checker reuses the core's
actual waveform/Noise/Sweep/Voice PCM programs and independent DAC/LFSR/pitch
expectations. The standalone comparison CLI also rejects aliased/overlapping
inputs and existing or unsafe report destinations before loading generated JS.

The complete final PCM/API comparison uses the already compiled, validated
output directory; this is not counted as another compiler execution.
It verifies ABI, receipts, inputs and output integrity before and after all
per-core comparisons. The CI workflow runs the same complete checker and the
WonderSwan receipt/CLI negative tests.

## Local verification

| Check | Result |
| --- | --- |
| Importer regression tests | 19 passed |
| Offline per-chip build routes | 113 passed |
| Receipt, batch, DX7 and WonderSwan CLI guards | 95 passed |
| All-artifact WASM PCM/API comparison | 40,360 comparisons, maximum difference 0 |
| WonderSwan old build vs SDK build | 378 cases, 6,193,152 stereo frames, difference 0 |
| WonderSwan Native vs SDK WASM | 126 cases, 3,096,576 stereo frames, difference 0 |
| WonderSwan independent expectations / Native C ABI | 24 / 1,091 checks passed |
| FM npm package | Isolated packed install, actual runtime/assets and types passed |
| Packaged Playground | 1,027 module/asset references and mode checks passed |
| Packaged browser playback | Chromium and WebKit; Main/Worker, Keyboard, Inspector, examples and Stop passed |
| Tauri integration tests | Python 22 / Node 31 passed |
| Tauri Rust | 726 passed, 4 ignored, 0 failed |
| Tauri primary lifecycle | 22 modes, 604,032 frames, 88 Run/Stop transitions passed |
| Tauri extra instances | 3 mixtures, 7 solo sources, 16-slot limit and Stop budget 0 passed |
| Tauri Genesis vs WASM | 6 cases, 49,152 frames, max difference `3.725290298461914e-9` |
| Native corresponding sources | 22 source pins and final 1,851-file bundle verified |

Initial sandbox runs could not write Emscripten/npm caches or bind the MCP
test TCP sockets. Those checks passed after rerunning with the required host
permissions; there was no source workaround or audio-code change.

Frame counts above retain their original units and are not combined. These
are automated source/PCM/browser checks, not physical listening, hardware
accuracy or an audio callback deadline benchmark.

## Distribution checkpoint

- Playground ZIP: `release/hello_ymfm_wasm_sdk-014-dev_itch_playground.zip`.
  SHA-256 `fd73d44799dfe7819dba99967331bb3a0d0fab4d545fae8e6ee20fc6b1a0cc54`.
  There are 919 non-directory ZIP entries, including `samples/.DS_Store`;
  Tauri's existing metadata filter imports and verifies 918 application files.
  The package contains the central receipt instead of the old WonderSwan receipt.
- Tauri corresponding-source ZIP: 1,851 files, SHA-256
  `3933ab31e95fac188bc2acb67776b10d658a067ffa2f3f5258cf563a0e0b973a`.
- FM npm validation tarball: 833 files, 1,626,805 compressed / 6,060,038 unpacked bytes.
  No package version was changed and no npm package was published.

Evidence: [sdk_014_adoption_01.json](sdk_014_adoption_01.json) and
`/private/tmp/tetorica-sdk-014-adoption/`, including frozen legacy inputs,
actual rebuilt outputs, the final batch summary/per-core reports, WonderSwan
reports, browser results and Tauri logs.

## Next checkpoint

The user committed/pushed the application at
`a72c44cf5569ad8f9a628ee380987fe3d5a735ef` and Tauri at
`d3885716a152994b7c483ab4675a5a9e3e6aa37f`.
The [main WASM CI](https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/40391153310)
completed successfully. Its downloaded artifact independently passed the current
fixed SDK pin, both 28-artifact/55-output receipts, 170 input hashes and all
40,360 reported comparisons and per-core report hashes.

The [Tauri five-platform CI](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40391737139)
was dispatched against `main` and completed with **success on all five
platforms**, including installer generation. No new tag or release was published.
Downloaded validation artifacts for Linux x86_64/ARM64, Windows x86_64 and
macOS Intel/ARM64 contain 15 JSON reports. Each verifies the same SDK 0.1.4
and 395 files, 22 source pins, expected frontend archive, 22-mode lifecycle
with 604,032 frames and 88 Run/Stop transitions, three extra-chip mixtures,
seven solo sources, sixteen slots and zero reserved budget after Stop.

Every corresponding-source bundle contains 1,851 files. Windows reports SHA-256
`632119f520902e381ec3af0dd0ef0f6640f6164d5de2eff3260cf0a9c9200039`;
the other four report the local `3933ab31...` hash above. Each job's bundle
verification passed. The JSON results were audited; the installer/source ZIP
binaries themselves were not downloaded or executed, and the cause of that
cross-platform hash difference was not independently investigated.

These CI results target the committed consumer heads above. Subsequent local
changes only record the results and the read-only design for
[WonderSwan's Native Audio integration](native_wonderswan_01.md).
The SDK tag's previously successful seven-platform/artifact checks are
separate evidence; they do not replace the consumer CI.
