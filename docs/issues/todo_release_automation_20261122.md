# Release automation

- [x] Correct the VGM Analyzer calibration source check and copy the missing DMG and YM2608 timed-operation modules. A new measurement reproduced all 30 stored rows. The packaged Chromium check passed.
- [x] Verify the YM2413 checkpoint exports in the offline SDK route. Checkpoint restore reproduces the same 2,048 frames after rebuilding the pinned source. The VGM workflow commands passed locally.
- [x] Package all 15 Web products and verify the checksums in the normal and browser collections. Nitro DS and ST YM2149 are included in both. The release command also passed in a clean scratch checkout, including a retry and the list of 30 browser/source uploads. Chromium checks passed for the packaged Analyzer, FM2612 Synth and Playground Main/Worker.
- [x] Record one Git revision for the Web ZIPs and verify the exact tag, CI results and attached assets before publishing. Test draft upload and retry with simulated GitHub responses.
- [x] Support the 14 Tauri repositories, using their normal ZIP importers and local signed Mac builds. All 14 actual ZIP imports pass in scratch clones with the pending Playground version-import changes included. The other 13 pass at their current HEAD.
- [x] Find Windows and Linux installers from the exact Tauri tag and commit. Validate the installer names, sizes and checksums. Download and verify all five installers from the existing Nitro DS `v0.1.1` Actions run.
- [x] Plan separate browser, source and installer channels on itch.io. Record each completed upload for retries. All 15 destination product pages responded successfully, and Butler's Playground browser ZIP dry run passed.
- [x] Document the release commands, local signing, account prerequisites and one-time `html` channel setup. See [release instructions](../../README_RELEASE.md).
- [ ] Commit the existing version-import changes in `tetorica-fm2612-playground-tauri` before running the full desktop release. Its tests pass in a scratch copy with those changes.
- [ ] Run the first production release with a new Web tag and the selected desktop version. Verify Mac signing, new tag Actions and live itch.io uploads during that release.

The existing `v0.100.0` tag identifies the original browser build. It stays a reference for the Actions failures. Use a new version for releases built after these fixes.
