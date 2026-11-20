# SMSGEAR Synth basic application verification — 2026-11-20

Entry: `docs/synth-smsgear/index.html`. Adopted icon: `docs/tetorica_smsgear_synth.webp`.
The app uses existing Sega PSG and YM2413 native endpoints, shared Files / Code
helpers and calibrated mixer policy. It does not instantiate a YM2612 instrument.
Application guide and limitations: [README](../synth-smsgear/README.md).

## Local checks

- `node --test docs/synth-smsgear/*.test.mjs scripts/package_itch_all.test.mjs`: **25 passed** (11 application checks, 14 batch-packaging checks).
- Actual WASM reference rendering at 44,100 and 48,000 Hz: Game Gear pan, output mute without stopping chip time, exact frozen Pause position, resumed writes; YM2413-only output is finite, nonzero and mono.
- Preset normalization, source-preserving VGM/VGZ import, invalid/truncated/dual-chip rejection, static capture pan and Cassette working/saved preservation.
- Code declaration selection checked in the suite; a strict TypeScript consumer was also checked locally against the generated declarations.
- `node scripts/generate_soundchip_mixer_presets.mjs --check`: **passed**. No canonical runtime/core or calibration policy edits.
- `git diff --check`: **passed**.

## Browser / ZIP checks

`node scripts/check_smsgear_synth_browser.cjs` checks Chromium and WebKit with
an unconditional zero-gain stage before every physical audio destination.
Actual signal is measured before that stage; no sound is played through speakers.

Checks include passive startup/import, PSG and FM notes, Code Run/Stop,
keyboard input view changes without stopping Code, persistent expanded layout,
VGM Play/Pause/Resume/Stop, frozen reference position while auditioning,
Capture keeping paused transport, failed import keeping the current sound and
390px layout without horizontal overflow. The CDN is blocked to verify the
plain-text editor fallback. This does not verify CDN-hosted Monaco itself.

The same checks pass on the extracted standalone ZIP in both engines:

```sh
node scripts/package_itch_smsgear_synth.mjs ready build/smsgear-check/package
node scripts/check_smsgear_synth_browser.cjs \
  --root=build/smsgear-check/package/extracted-ready \
  --entry=/index.html --out=build/smsgear-check/package-browser.json
```

Candidate ZIP: `build/smsgear-check/package/tetorica_smsgear_synth_ready_itch.zip`
(3,998,539 bytes), SHA-256:
`c904ba44ad26b576e69404da841a3ffe7a736d84041ceaeb1473e344dfb0331c`.
ZIP CRCs and all 179 browser-module source hashes were checked against the
working tree. Authored modules are distributed without minification/bundling;
WASM, reusable runtime source kits and component licenses are retained.
Screenshots/logs are local under `build/smsgear-check/`.

## Scope and follow-up

Test music is original synthetic register data; no game assets are bundled.
Actual game-driver sound quality and human listening remain unverified.
Reference seek/cache, direct song edits, software PSG Envelope and timed APIs
remain in the [TODO](todo_smsgear_synth_20261120.md). There was no publication,
commit/push/tag, shared runtime rebuild or Tauri work in this change.
