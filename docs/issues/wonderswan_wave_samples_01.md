# WonderSwan Wave RAM extraction

Date: 2026-10-27. Status: implemented and locally verified; not published or committed.

VGM Analyzer can now extract WonderSwan waveform snapshots in Sample Explorer. Each waveform has a 32-point display, channel/time/bank/address history, reusable `ws.setWaveform()` code, JSON export, one-second audition and audition WAV export. The same extraction and exports are available through the Node API and CLI.

## Scope and representation

- Each waveform is 16 packed bytes / 32 unsigned 4-bit points, **low nibble first**. This differs from the Game Boy packing order.
- The extractor follows known writes to the 16 KiB wave RAM. Unwritten bytes remain unknown; an incomplete waveform is not padded with invented zeros.
- Wave addresses use the selected bank and channel: `((bank << 6) + channel * 16) & 0x3fff`. Captures retain physical-address provenance, including equal waveforms selected from different banks at the same time.
- Equal contents share one sample definition while retaining their channel-specific observations. Captures flush at wait/EOF boundaries, key-on and bank/mode changes; a bank change first preserves pending writes to the old bank.
- Voice PCM on CH2 and Noise on CH4 are excluded while those modes are active. Sweep on CH3 retains its written waveform and base-frequency metadata.
- Definitions, observations and retained packed payload have explicit limits: 100,000 / 100,000 / 64 MiB. Missing clocks, dual/variant chips and invalid addresses fail explicitly.

These are **written RAM snapshots**, not detected original instruments or recordings with recovered audible durations. JSON uses `schemaVersion: 1`, `representation: "written-wave-ram"`, the original packed bytes, unpacked waveform and observations in the 44,100 Hz VGM timebase. Reusable code uses the Playground API's zero-based channels.

## Audition and UI

Load a WonderSwan VGM/VGZ, open **Sample Explorer**, then **Analyze samples**. Expand a waveform and select an observation to inspect its origin or copy code for that channel.

Audition uses the existing real WonderSwan WASM engine and its speaker midpoint correction. It isolates one waveform at the selected active observation's written base pitch, or an A4 target when that pitch is unavailable. It uses centered volume 9/9, lasts one second, and has short edge fades. It does not reproduce the song's pan/volume changes, Sweep, Noise or Voice PCM. The exported audition WAV is stereo 16-bit / 44.1 kHz, 176,444 bytes.

Preview shares the Sample Explorer AudioContext and stop/cancellation guards. Stop, occurrence changes and loading another file cancel both pending and playing previews. The existing Game Boy controls remain compatible.

## Implementation

- Extraction: `docs/vgm_analyzer/wonderswan_waves.js`, integrated into `sample_core.js` through the existing parser targets, including timed stream writes. Events are not applied twice.
- UI: `wonderswan_wave_view.js`, `sample_explorer.js`; actual preview and WAV generation in `sample_render.js`.
- Support: Analyzer controls, generated support page, CLI/package documentation, standalone packaging and installed-package checks.
- Changed sample/UI entry modules use cache version `wonderswan-waves-1`. Existing parser/player cache version `wonderswan-vgm-1` remains valid.
- SDK 0.1.4, all 55 generated WASM outputs, `playback_core.js`, `web/wonderswanaudioengine.js` and Mixer/calibration values remain unchanged.

## Verification

- Broad Node regression: **939 passed, 0 failed, 1 existing skip** out of 940. This preceded the last end-to-end tests and two small boundary refinements; the final affected paths were then covered by the focused run.
- Final focused extraction/view/preview/support/end-to-end run: **31 passed**. Counts overlap with the broad run.
- Copied waveform code ran through the real Playground Synth, direct transport and WASM. The packed RAM bytes matched the extracted source exactly.
- Normal docs and final flat distribution passed Sample Explorer checks in Chromium 153.0.8010.12 and WebKit 26.6. Checks cover content deduplication, nibble order, canvas, observation selection, Copy, JSON, real preview PCM, WAV, Stop and file/occurrence switches.
- The final flat distribution also passed the existing playback check in both browsers: four channel mutes, Wave/Noise/Sweep/Voice PCM, pause/resume, seek and Stop/replay.
- All 186 files recorded by the docs Sample Explorer check match current disk bytes. All 184 files recorded by the flat Sample Explorer check match both staging and the exact ZIP entries. Browser reports and source hashes are embedded in the companion JSON.
- The local `tetorica-vgm` 0.2.14 tarball passed isolated offline installation, actual rendering/mute, score/CLI exports, waveform inventory, JSON and preview WAV exports. The package version was not changed or published.
- Analyzer Tauri import: **398 files**, importer verification plus **6 Python / 4 Node tests passed**. No desktop shell or Rust changes.
- Support generation, CLI chip table and calibration guards passed. All 55 generated outputs remain byte-identical to the fixed SDK 0.1.4 adoption manifest.

Browser tests measured actual rendered audio upstream of a zero-gain/zeroed physical output. This verifies PCM and controls; it does not establish listening quality, original hardware accuracy, real-time deadlines or actual Tauri WebView audio. No new WASM build or all-build regression was necessary for this sample/UI-only phase.

## Artifacts and repository state

Standalone ZIP: `release/hello_ymfm_wasm_wonderswan-waves-dev_itch_vgm_analyzer.zip`.

SHA256: `b53c76ccac9893d491aec93e46fe8b4d51738f2c4602c6b45852f134e8117ba9`.

This exact ZIP is imported in `w/tetorica-fm2612-vgm-analyzer-tauri/release.lock.json` (398 files). The local package is `/private/tmp/ws-waves-vgm-package/tetorica-vgm-0.2.14.tgz`. Temporary logs need not survive; final browser results, source hashes and checksums are preserved in [wonderswan_wave_samples_01.json](wonderswan_wave_samples_01.json).

Base commits are main `3dbee68137067c6b51d4efe9464ee811ad512f67` and Analyzer Tauri `eb0344e106bb6277f9b95f413cbdaed1f35097a2`; these already contain the prior playback integration. This phase changes main and Analyzer Tauri only. SDK and Playground Tauri working trees are clean. No commit/push, tag, npm publication or CI dispatch was performed.

## Reproduction

From the main repository:

```sh
node --test --test-concurrency=2 test/*.test.mjs docs/vgm_analyzer/*.test.mjs
node --test --test-concurrency=2 test/wonderswan-wave-samples.test.mjs docs/vgm_analyzer/wonderswan*.test.mjs
node scripts/check_wonderswan_samples_browser.cjs --root=docs --out=/private/tmp/wonderswan-samples-browser.json
sh scripts/package_itch_vgm_analyzer.sh wonderswan-waves-dev
node scripts/check_wonderswan_samples_browser.cjs --root=release/itch_vgm_analyzer_wonderswan-waves-dev --out=/private/tmp/wonderswan-samples-flat.json
node scripts/check_wonderswan_analyzer_browser.cjs --root=release/itch_vgm_analyzer_wonderswan-waves-dev --out=/private/tmp/wonderswan-playback-flat.json
node scripts/build_cli.mjs
```

From `dist/vgm`, use `npm pack --pack-destination /private/tmp/ws-waves-vgm-package`; then run `node scripts/check_wonderswan_vgm_package.mjs /private/tmp/ws-waves-vgm-package/tetorica-vgm-0.2.14.tgz` from main.

From the Analyzer Tauri repository, import the generated ZIP using `python3 scripts/import_release.py <absolute-ZIP-path>`, then `python3 scripts/import_release.py --check` and `npm test`.

## Next

Try Sample Explorer with actual WonderSwan VGM/VGZ files and listen to the extracted waves. Commit/push main and Analyzer Tauri, then verify their CI. Voice PCM capture is a separate next phase; preserve its distinction from static waveform snapshots.
