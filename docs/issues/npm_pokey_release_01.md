# POKEY npm release

Publication status: **published; both latest tags and registry tarball parity verified**.

The requested scope is the two npm packages only:

| Package | Published version | Contents |
| --- | --- | --- |
| [tetorica-fm2612](https://www.npmjs.com/package/tetorica-fm2612/v/0.2.31) | 0.2.31 | POKEY raw/Synth/AudioWorklet APIs, independent dual chips, source bundle, and bounded Playground timeline preparation. |
| [tetorica-vgm](https://www.npmjs.com/package/tetorica-vgm/v/0.2.16) | 0.2.16 | Single/dual POKEY VGM playback, stream handling, channel mute, API/CLI rendering and corresponding sources. |

The exact published tarballs are retained under
`/private/tmp/npm-pokey-release-20261027/`. Both package READMEs and CLI usage
now describe the versioned POKEY release rather than an unreleased feature.
Existing Mixer gains and generated WASM binaries are unchanged. SDK 0.1.5
remains a hash-pinned local source candidate with its original provenance;
this npm task does not publish an SDK tag or GitHub Release.

FM verification built 305 modules, 28 chip/engine pairs and 352 declarations.
Its isolated consumer loaded all 28 real WASM engines and passed three type
configurations. All 880 tarball files match staging and the isolated install.
VGM verification passed 1,157 tests with one existing optional tool skip.
Its isolated consumer verified 168 modules, single/dual playback, streams,
mute/seek/lifecycle, API/CLI output, licenses and included sources. All 277
tarball files match staging and the isolated install.

| Package | Tarball SHA-256 |
| --- | --- |
| tetorica-fm2612 0.2.31 | `6941d3474abd619fd0cec1b41b79f51c6011ca49d3bf9ab47ca31422e641851d` |
| tetorica-vgm 0.2.16 | `1ee60b3caa7978f0129d3af7436860f6d19bc32aabe65977de9f4ab8d8add0a2` |

Both publish commands completed successfully after browser authentication.
Following npm's asynchronous processing, both exact versions became available
and both `latest` tags matched. Each registry tarball was downloaded again and
matched its validated candidate byte for byte, including all 880 FM and 277 VGM
files. Registry SHA-1 and SHA-512 integrity also matched. The published payloads
are therefore the exact artifacts used for the pre-publication isolated checks.

Preparation receipts are
`/private/tmp/npm-pokey-release-20261027/fm/verified.json` and
`/private/tmp/npm-pokey-release-20261027/vgm/release-receipt.json`.
Final publication, metadata and file-hash evidence is recorded in
[npm_pokey_release_01.json](npm_pokey_release_01.json).
No commit, push, tag, SDK publication, Examples update or itch.io upload is
part of this task.
