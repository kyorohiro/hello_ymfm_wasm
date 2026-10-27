# Web release preflight and Analyzer calibration receipt refresh

2026-10-28. Prepared for the user's manual itch.io Web-only upload of VGM Analyzer and Playground. Base commit: `3df4336b`.

The initial Analyzer package check correctly rejected stale measurement source hashes. Fourteen files changed only JSDoc import query strings from `?v=pokey-mode-1` to `?v=pokey-prepare-1`; reversing that exact text reproduces every historical source hash. No audio implementation or WASM changed. The mandatory source-hash guard remains enabled.

The established measurement tools were rerun against the current actual Analyzer engines:

- `analyzer_extra_levels_06.json`: 18 captures. Every field except `sources`, including PCM hashes, measured levels and derived gains, exactly matches `analyzer_extra_levels_05.json`.
- `analyzer_psg_levels_07.json`: 12 captures. Every field except `sources` exactly matches `analyzer_psg_levels_06.json`.
- `analyzer_nes_levels_01.json`: all 11 source hashes still match; no update needed.

The generator selects these new receipts. The generated gain table is executable-byte-identical; only its two provenance comments change. Shared Mixer presets and application listening levels are unchanged.

All 12 related tests passed. Eight actual Analyzer routes passed unity/default PCM ratios, fixed targets, restart and exact WAV parity; maximum gain error `2.8610229518832853e-8`. Fresh packaging passed both dependency checks. The packaged Analyzer also passed Chromium/WebKit real AudioWorklet tests, 12 checks per browser, including Mixer persistence, FM/SSG levels and exact-zero mute. Physical output was muted.

Fresh Playground ZIP contains the same 1005 payload files, byte-for-byte, as the previously verified Mega-CD CD-DA package. Its Chromium/WebKit Main/Worker proof remains applicable. The ZIP container hash differs because packaging timestamps differ.

Upload these files manually, each to its corresponding existing itch.io HTML project:

- `release/hello_ymfm_wasm_web-20261028-3df4336_itch_playground.zip`
- `release/hello_ymfm_wasm_web-20261028-3df4336_itch_vgm_analyzer.zip`

Both ZIPs have root `index.html`, no website service-worker registration, and all archived files match their staging directories. Full artifact hashes and verification evidence are in [analyzer_mixer_calibration_refresh_04.json](analyzer_mixer_calibration_refresh_04.json).

No upload, commit, tag, npm publication or Tauri import was performed. These local ZIPs are ready for manual upload; live itch.io iframe operation must be confirmed after the user uploads them.
