# Public factory PSG receipt refresh for WonderSwan Worklet types

Date: 2026-10-27

Adding WonderSwan to the JSDoc `WorkletChipName` union changes the whole-file hash of `web/soundchip.js`. The executable factory statements are unchanged: the historical HEAD source matches receipt 02, and historical/current JavaScript is byte-identical after esbuild JavaScript/ES2022/ESM comment and whitespace removal. The [verification receipt](soundchip_psg_calibration_refresh_02.json) records both original hashes and the canonical executable hash.

All **18 actual WASM measurements** were repeated using the unchanged measurement script: Sega PSG, AY-3-8910 and NES at 220/440/880 Hz and 44,100/48,000 Hz. Every field of the [fresh report](soundchip_psg_levels_03.json), excluding source hashes, exactly matches [receipt 02](soundchip_psg_levels_02.json). Only the factory source hash changed.

The preset generator and test fixture now select receipt 03. Source-hash validation remains strict. Both checked-in preset modules retain their exact HEAD bytes; measured defaults and listening-policy gain values are unchanged. No audio device, build, package or publication was involved.

```sh
node scripts/measure_soundchip_psg_levels.mjs --out docs/issues/soundchip_psg_levels_03.json
node scripts/generate_soundchip_mixer_presets.mjs --check
node --test scripts/generate_soundchip_mixer_presets.test.mjs
```
