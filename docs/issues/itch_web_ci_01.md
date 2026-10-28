# itch web release CI

Date: 2026-10-28

The user releases the outputs of these three commands as GitHub Release
attachments, and uploads to itch.io manually:

```sh
sh scripts/package_itch_synth.sh
sh scripts/package_itch_vgm_analyzer.sh
sh scripts/package_itch_playground.sh
```

## Changes

- Added `.github/workflows/itch-web.yml`, running on push, pull request, or manual
  dispatch. It uses the exact default commands above on Ubuntu 24.04 with Node 22
  and Python 3.12. It does not create or publish GitHub Releases.
- Added `scripts/check_itch_release_archives.mjs` and 19 regression tests. The
  validator checks exactly the four default ZIPs, CRCs, safe paths, stage bytes,
  playable hosting limits, and the Playground bundle/source/notice contracts.
  It writes a portable manifest and SHA-256 checksums after successful validation.
- Added `scripts/check_itch_synth_browser.cjs`: extract the actual ZIP, import an
  original sustained TFI using the public UI, and check real keyboard PCM,
  release silence, and replay in Chromium and WebKit. Physical output is muted.
- Reused the Analyzer Mixer browser checker against its validated staging tree
  and the existing 20-case Playground checker against the extracted Run ZIP.
- Successful CI retains `itch-web-release-zips` for 14 days: four ZIPs,
  `SHA256SUMS`, and `itch-web-release.json`. Diagnostics are retained for seven
  days as `itch-web-validation`, including on failures.
- Added [maintainer instructions](../itch_web_release.md), linked from both
  READMEs. Extract the outer Actions artifact before attaching/uploading the
  individual application ZIPs.

## Local validation

- All three exact packaging commands succeeded.
- 29 targeted tests passed: 19 archive checks and the existing ten Run
  preparation/bundle checks.
- All four actual archives passed the validator and checksum verification:

| Artifact | Entries, including directories | Role |
| --- | ---: | --- |
| Synth | 231 | Browser-playable |
| VGM Analyzer | 463 | Browser-playable |
| Playground Run | 888 | Browser-playable |
| Playground full | 1115 | Full download; hosting limit does not apply |

- Playground Run preserves 872 files without changes, including 47 notices.
  The complete original audio/build source archive has 91 files; the original
  UI source archive has 77 files including root licenses. Audio code and WASM
  were not rebuilt or modified.
- Official actionlint 1.7.12 reported no diagnostics for the new workflow. Its
  downloaded archive was verified against the upstream checksum.

- Synth passed in Chromium 153 and WebKit 26.6: public TFI import, actual YM2612
  Worklet PCM, exact silence after release, and audible replay. All 76 served
  assets came from the extracted ZIP; no page, console, network, or HTTP errors.
- Analyzer passed all 12 checks in each browser, including actual OPNA FM/SSG
  gain ratios and exact zero on mute, against the ZIP-matched stage.
- Playground passed all 20 conditions: Chromium/WebKit × Genesis/Mega-CD/Game
  Boy/NES/WonderSwan × Main at the server root/Worker at a nested itch-style URL.
  Real PCM, Stop/Rerun, Shell, relative imports, Monaco types, and Mega-CD source
  isolation were checked from the extracted Run ZIP, with no repository fallback.

Browser execution results, exact archive hashes, and input hashes are recorded
in the [JSON receipt](itch_web_ci_01.json).

## Release status

The prior bundle/minify change has already been committed and the user confirmed
that the uploaded Playground runs on itch.io. This CI change is separate and
remains uncommitted. Local packages were built from base commit
`8608b0ef2051d5904b5d7db576a63980b24e3a9e`; the CI/checker/documentation additions
were uncommitted during validation. These new files do not change the packaged
application payload.

The new workflow has not run on GitHub or Ubuntu yet. After committing and pushing
this change, inspect its first Actions run and download the verified artifact.
There was no push, tag, GitHub Release upload, itch.io upload, npm publication,
SDK update, or Tauri import in this task.
