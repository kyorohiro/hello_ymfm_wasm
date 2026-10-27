# Public factory PSG receipt refresh for POKEY

Date: 2026-10-27

The public factory adds an independent POKEY dynamic loader, its direct API type map, and a generic Worklet name. This functional addition changes the whole-file provenance hash of `web/soundchip.js`; existing chip-loader branches and Mixer gains are retained.

All **18 actual WASM measurements** were repeated with the unchanged measurement script: Sega PSG, AY-3-8910 and NES at 220/440/880 Hz and 44,100/48,000 Hz. Every result field excluding source hashes in [receipt 04](soundchip_psg_levels_04.json) exactly matches [receipt 03](soundchip_psg_levels_03.json). Only the public factory source hash differs.

The generator and its test fixture now select receipt 04. Strict source-hash checks remain enabled, and both generated preset modules retain their exact HEAD bytes. The measurement-derived values remain Sega PSG `0.455420`, AY-3-8910 `1.100331` and NES `1.514209`; the later listening-policy values are likewise unchanged. POKEY has no measured calibration and retains unity source gain.

The [verification receipt](soundchip_psg_calibration_refresh_03.json) records these comparisons. No physical audio device or publication was involved.

```sh
node scripts/measure_soundchip_psg_levels.mjs --out docs/issues/soundchip_psg_levels_04.json
node scripts/generate_soundchip_mixer_presets.mjs --check
node --test scripts/generate_soundchip_mixer_presets.test.mjs
```
