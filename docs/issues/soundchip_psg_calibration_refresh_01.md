# Public factory PSG calibration receipt refresh

Date: 2026-10-27

Adding `createSoundChip('wonderswan')` changes `web/soundchip.js`, which the public
factory PSG measurement receipt tracks. The strict source-hash check therefore
requires a fresh measurement even though no existing chip loader or audio core
changed.

All 18 existing WASM captures were repeated using the unchanged measurement
script: Sega PSG, AY-3-8910 and NES, each at 220/440/880 Hz and 44,100/48,000 Hz.
The [new receipt](soundchip_psg_levels_02.json) matches the
[previous receipt](soundchip_psg_levels_01.json) in every field except the
`web/soundchip.js` source hash. All measurements and calculated defaults are
identical.

For an additional PCM check, the exact historical loader was recovered from Git
revision `29af5c6bf3bf5fcb77487e07c6a6ca242d0e0dad` and verified against the old
receipt's SHA-256. All 18 captures were replayed through that loader and the
current loader with the same tracked dependencies and WASM files. Every stereo
Float32 sample matched exactly, with maximum absolute difference zero. PCM
hashes, source hashes and generated-preset hashes are recorded in the
[verification receipt](soundchip_psg_calibration_refresh_01.json).

The preset generator and its fixture now select the refreshed receipt. Generated
preset bytes, measured gains and listening-policy values remain unchanged. The
source-hash validation is still enforced; no physical audio device was used.

```sh
node scripts/measure_soundchip_psg_levels.mjs --out docs/issues/soundchip_psg_levels_02.json
node scripts/generate_soundchip_mixer_presets.mjs --check
node --test scripts/generate_soundchip_mixer_presets.test.mjs
```
