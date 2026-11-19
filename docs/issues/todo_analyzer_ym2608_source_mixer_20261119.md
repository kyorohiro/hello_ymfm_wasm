# VGM Analyzer YM2608 source Mixer — 2026-11-19

Extend the independently adjustable FM / SSG / Rhythm / ADPCM controls from
FM2608 Synth to VGM Analyzer, using the existing native source-gain API.

- [x] Preserve the calibrated YM2608 whole-chip gain, shared pan/mute and saved
  preferences; add four clearly grouped volume/mute controls at unity by default.
- [x] Apply source gains without changing VGM register writes or rendering a
  source multiple times. Cover standalone and mixed-chip playback.
- [x] Preserve settings through pause, restart, snapshots, seek and WAV export.
  Persist source preferences separately; reset restores unity source gains.
- [x] Verify real source isolation, muted evolution, invalid-input handling and
  compatibility with the existing whole-chip strip.
- [x] Update cache versions and readable Analyzer packaging, then verify source
  and ZIP in physically muted Chromium/WebKit sessions.

The four gains already exist; no shared runtime/native changes are needed.
The Analyzer's own measurement receipts bind its playback modules, so refresh
its extra-chip and PSG probes offline, keeping historical captures immutable.
Source controls provide scalar gain/mute; pan remains shared and the measured
whole-chip output remains the parent control.
No commit, push or publication is requested.

Completed validation:

- Four grouped controls under the existing YM2608 strip: FM / SSG / Rhythm /
  ADPCM, each Volume 0–380% and Mute. Shared Pan stays on the parent. Native
  source edits apply before UI/preferences commit; rejected edits retain the
  prior state. Empty source preferences do not rewrite legacy record shapes.
- 642 Analyzer/generator tests: 641 passed, one existing conditional skip.
  This includes actual four-source PCM, continued muted evolution, restart,
  snapshots, seek, WAV, mixed AY+YM2608, preferences and UI validation.
- Existing broad Mixer browser checks pass Chromium and WebKit, including
  calibrated defaults, old saved-gain migration, pan, mute, reset and FX.
- Focused source and exact-ZIP checks pass both browsers with physical output
  muted. Real half-volume ratios are about 0.5; muted output is zero. Live
  playback, pause/resume, seek, storage reload, Reset and downloaded WAV pass.
  All 200 served asset digests match between source and packaged application;
  desktop/mobile screenshots were visually checked.
- Fresh offline captures `analyzer_extra_levels_07.json` (18 rows) and
  `analyzer_psg_levels_10.json` (12 rows) reproduce every prior sample statistic,
  reference and default exactly. Historical reports remain unchanged. The
  generator requires current sources, including the new source controller.
- Cache versions cover the entry, Mixer modules, playback engine and native
  YM2608 loader/binary. The package includes the readable new module.
- Final checked archive:
  `release/hello_ymfm_wasm_ym2608-source-mixer-final-20261119_itch_vgm_analyzer.zip`
  (614 files / 706 ZIP entries; SHA256 `abffd79e63892059586c6bbb5bd5bc868e1702a749c3b617095765a498bdeb71`).

Logs and archive verification:
`build/analyzer-opna-source-mixer-20261119/`.
Focused browser receipts/screenshots:
`build/analyzer-ym2608-source-mixer-20261119/`.

Existing buffering tests were updated from removed `web/` paths to canonical
runtime paths, and POKEY default assertions now use its measured Mixer defaults.
These corrections do not change either audio implementation.
