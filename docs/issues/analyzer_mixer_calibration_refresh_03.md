# Analyzer calibration receipt refresh after POKEY integration

2026-10-27. Completed locally while adding POKEY VGM playback.

POKEY detection, playback and Mixer routing changed `cli/render.js`, `playback_core.js` and `playback_mixer.js`. The preceding POKEY cache-version rollout also changed recorded chip-wrapper import URLs. The strict whole-file source-hash guard correctly requires refreshed measurement receipts. Its validation has not been weakened.

The existing mechanical tools were rerun against the actual current Analyzer render paths, with unity source Mixer/master and no audio device:

- `analyzer_extra_levels_05.json`: 18 captures. All fields except `sources`, including PCM hashes, measurements, formulas and gains, exactly match `analyzer_extra_levels_04.json`.
- `analyzer_psg_levels_06.json`: 12 captures. All fields except `sources` exactly match `analyzer_psg_levels_05.json`. The YM2608 FM reference and its internal SSG/FM ratio remain unchanged.
- `analyzer_nes_levels_01.json` remains unchanged because all 11 recorded source hashes still match.

The generator now selects the new receipts. Generated `mixer_calibration_data.js` changes only its two provenance comments; its executable gain table is byte-identical. This refresh changes no existing audio level or application listening policy. POKEY is not calibrated by these measurements and retains its explicit unity gain of `1.0`.

Validation: all 12 related tests passed. Eight actual Analyzer routes passed unity/default PCM ratios, retained targets, reset gain and exact PCM16 WAV comparisons; maximum gain error was `2.8610229518832853e-8`.

```sh
node scripts/calibrate_analyzer_extra_levels.mjs --out=/private/tmp/analyzer-extra-levels-pokey-refresh.json
node scripts/measure_analyzer_psg_levels.mjs --out /private/tmp/analyzer-psg-levels-pokey-refresh.json
node scripts/generate_analyzer_mixer_defaults.mjs --check
node --test scripts/generate_analyzer_mixer_defaults.test.mjs scripts/measure_analyzer_psg_levels.test.mjs docs/vgm_analyzer/mixer_defaults.test.mjs
node scripts/check_analyzer_mixer_levels.mjs
```

Source hashes, exact report comparisons and validation results are recorded in [analyzer_mixer_calibration_refresh_03.json](analyzer_mixer_calibration_refresh_03.json). No npm publication was performed.
