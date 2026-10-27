# Analyzer calibration receipt refresh after cache versioning

2026-10-27. Completed locally while packaging the WonderSwan sample-extraction update.

The Analyzer package guard rejected `docs/js/segapcmaudioengine.js`. Fourteen recorded files had changed, but comparison with the exact historical Git blobs proved that every changed line was a JSDoc type import: its cache query changed from `wonderswan-native-1` to `wonderswan-pcm-timeline-1`. Runtime code, DSP and WASM were unchanged. The strict whole-file source-hash guard was retained.

The existing mechanical measurement tools were rerun against the current actual Analyzer engines rather than replacing receipt hashes without measurement:

- `analyzer_extra_levels_04.json`: 18 captures. Every measurement, PCM hash, derived gain, formula and other report field except `sources` exactly matches `analyzer_extra_levels_03.json`.
- `analyzer_psg_levels_05.json`: 12 captures. Every report field except `sources` exactly matches `analyzer_psg_levels_04.json`.
- The NES receipt remains unchanged because all its recorded source hashes still match.

The generator now selects the new receipts. Its source verification and rejection of changed renderers are unchanged. Generated `mixer_calibration_data.js` differs only in the two provenance comments; its executable gain table is byte-identical. This refresh changes no audio level or application listening policy.

Validation: 12 related tests passed. The generator check passed. Eight actual Analyzer routes passed unity/default PCM ratios, retained targets, reset and exact PCM16 WAV comparisons; maximum gain error was `2.8610229518832853e-8`. No device was opened and no npm publication was performed.

```sh
node scripts/calibrate_analyzer_extra_levels.mjs --out=/private/tmp/analyzer-extra-levels-ws-refresh.json
node scripts/measure_analyzer_psg_levels.mjs --out /private/tmp/analyzer-psg-levels-ws-refresh.json
node scripts/generate_analyzer_mixer_defaults.mjs --check
node --test scripts/generate_analyzer_mixer_defaults.test.mjs scripts/measure_analyzer_psg_levels.test.mjs docs/vgm_analyzer/mixer_defaults.test.mjs
node scripts/check_analyzer_mixer_levels.mjs
```

Exact historical/current source hashes, changed lines, report comparisons and validation log hashes are recorded in [analyzer_mixer_calibration_refresh_02.json](analyzer_mixer_calibration_refresh_02.json).
