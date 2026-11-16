# Tetorica YM2149 ST Synth — initial browser implementation

Date: 2026-11-16. Product slug: `tetorica-ym2149-st-synth`.

## Implementation

- Browser entry: `docs/synth-ym2149-st/index.html`.
- ASWAN's layout and Code / Files patterns, with the approved gray / blue / white ST icon.
- Existing AY/YM Worklet, configured as YM2149 (`type: 0x10`, `flags: 1`) at 2,000,000 Hz. No DSP, shared runtime or native-core change.
- One AudioContext and one chip-to-speaker route. Keyboard, controls and Code share the same physical chip client.
- Auto round robin and individual CH1 / CH2 / CH3 display, editing and keyboard targets. Selection alone does not unify settings. Stale keyboard or Code releases cannot stop a newer keyboard owner.
- Per-channel tone / noise gates, fixed volume and shared-envelope selection; one shared noise period and one shared envelope period / shape, including explicit retrigger.
- Drag / minus / plus numeric controls, octave, two keyboard Pitch controls, Master up to 380% and Mixer gain relative to the calibrated 85% AY baseline.
- Existing virtual Files, context menus, readable JSON presets, local persistence and Cassette projects. JSON selection keeps Keyboard view and running Code; project restoration never executes code.
- Existing Code runtime with one borrowed `useSoundChip("ay8910")`, completion declarations, `liveLoop`, `livePrepare`, `liveFx`, `context` and tempo-based starter code. Hardware calls are synchronous; musical waits use `await beat()`.
- Code Stop fades the common output briefly and releases Code-owned voices while preserving newer manual notes. Global Stop releases all voices. Preset renaming never retriggers the envelope.

## Automated verification

`npm run test:ym2149-st-synth`: **52 tests passed**. Includes real YM2149 WASM PCM, initial/Stop silence, hardware shared-envelope behavior, owner safety, calibrated Mixer gain, audio failure cleanup, retired Code leases, FX graph restoration, TypeScript declarations/source navigation, Files persistence races and atomic Cassette/preset imports.

`node scripts/generate_soundchip_mixer_presets.mjs --check`: **passed**. Existing shared Mixer calibration remains current.

`git diff --check`: **passed**.

The actual packaged root entry was tested with Chromium and WebKit:

```sh
node scripts/check_ym2149_st_synth_browser.cjs \
  --root=release/itch_ym2149_st_synth_dev-CpOPVV \
  --entry=/index.html \
  --out=docs/issues/verification_ym2149_st_synth_browser_20261116.json \
  --screenshots=/private/tmp/ym2149-st-final-ui
```

Both engines passed with no missing local resources or uncaught errors. Checks cover actual PCM before a test-only speaker mute, CH1→CH2→CH3→CH1, individual edits and Auto preservation, Code with hardware/preset edits, Keyboard/Code tab changes, preserving manual notes on Code Stop, return to silence, 380% Master, expanded Code, 1280 / 390 / 320 pixel layouts, and explicit recovery after a closed AudioContext.

Every physical speaker route was muted. This verifies generated PCM and control behavior, not human listening. The browser test deliberately blocked the Monaco CDN to exercise offline textarea fallback; declaration checking and source-navigation mappings were verified separately. Normal online Monaco initialization is retained from the shared Synth controls.

## Distribution

```sh
sh scripts/package_itch_ym2149_st_synth.sh
```

Created `release/tetorica_ym2149_st_synth_dev_itch.zip`:

- 129 files, 1,234,785 bytes.
- SHA-256: `021617017e50ab3305e93dcafa4da376282d3438a1df69a8fe69f0d5b0082f30`.
- Four explicit browser entry modules; no minification or bundling of authored JavaScript/CSS.
- Root and nested entry pages, local AY Worklet/WASM, Code FX runtime, icon, credits, authenticated AY/YM native source/build kit and original browser-input source ZIP with SHA-256 receipt.
- Deterministic packaging tests passed; existing archives are never silently overwritten.

A dedicated GitHub Actions workflow was added but has not been run remotely. No commit, push, tag or publication was performed.

## Remaining work

- Human listening and usability feedback.
- YM / SNDH reference playback and sound import remain a separate next stage.
- Timed-register reservations, Sync-buzzer examples, volume-register sample playback, STE DMA, Looper / Event Rec and Tauri are not included in this initial Synth.

See [the implementation TODO](todo_ym2149_st_synth_20261116.md).
