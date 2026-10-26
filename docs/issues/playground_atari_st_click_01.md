# Atari ST starter: note-gate clicks

2026-10-26

## Reproduction and cause

The user reported crackles when the Atari ST `index.js` starts and stops notes. The unchanged starter reproduces a large step even with ideal sample-aligned offline rendering; no browser/device load or scheduling jitter is needed.

The normalized YM2149 DAC table contains a constant -0.125 baseline for each physical voice, before the three-channel average. The speaker transport hard-mutes voices at volume zero. With the starter's levels 9/6/5, this abruptly switches a roughly -0.107 DC mean to exact zero, although the steady tone's AC RMS is only about 0.0118. Lowering volume or adding a volume-register ramp alone retains this baseline jump at the first unmute.

The pitch, 2 MHz clock conversion and register ordering did not show an Atari-specific defect in this investigation. This identifies a deterministic source of note-gate clicks; it does not prove that every possible audible interruption has this cause.

## Change

The newly added normalized YM2149 speaker profile (`type === 0x10`, `flags & 1`) removes this known DAC-table baseline for the currently unmuted voices. Correction is applied to the existing PCM buffers **before** clock resampling, so fractional-clock held samples are corrected too.

Raw WASM generation, chip registers, DAC/envelope curves, pitch, Mixer values and `index.js` remain unchanged. The legacy AY-3-8910 speaker path and unnormalized profiles retain their existing PCM, including compatibility with the fixed Native AY adapter. Extending a matching policy to that legacy/Native path is separate work.

This adds no audio node, polling or array allocation beyond the existing renderer. The speaker source adapter adjusts the returned buffers in place. Browser cache URLs advance to `atari-st-mode-2`, and the frontend ZIP is imported normally into Tauri.

## Verification

- Evaluate the exact checked-in `index.js` through the old and new Worklet, using the real YM2149 WASM. Three loop callbacks at 44.1/48 kHz produce 24 note boundaries per rate. Maximum note-gate step: **0.125 → 0.0353794**, a reduction of about 72%.
- Steady, mean-subtracted PCM differs by at most `6.94e-18`. Register state and physical profile match; arbitrary block partitions produce identical corrected PCM.
- Raw AY type 0 flags 0/1 and YM type 16 flags 0 remain byte-identical to the old renderer.
- The real Chromium starter regression fails on the old Worklet with a step of `0.10207` after the Mixer. Corrected normal docs and the final flat package pass in Chromium and WebKit; measured steps are about 0.023–0.031. A4 remains about 440.14 Hz, mono matches, and Main/Worker, Keyboard, editing, Stop and rerun pass.
- 122 targeted tests and a separate overlapping 70-test chip/clock/performance suite pass. Added regressions cover real PCM, note gates, lower-clock held output, reset/cancellation and partition invariance.
- The final ZIP contains 901 files and is imported/verified in Tauri. SHA-256: `092733c6756ecba7f00af3d71d5b6b75933b6e9f366e7a77c53394b8fa46f21f`.

See the [compact measurement record](playground_atari_st_click_01.json). Full diagnostic scripts, measurements, logs and before/after WAV files are in `/private/tmp/tetorica-atari-st-click/`; actual Worklet comparisons are under `actual/`. These are signal measurements, not a physical listening confirmation. No commit, tag or public release is performed here.

```sh
node --test web/playground_ay8910_inspector.test.mjs web/native_runtime_synth.test.mjs web/ay8910.test.mjs web/ay8910synth.test.mjs docs/playground/playground_atari_st_examples.test.mjs
node scripts/check_playground_atari_st_browser.cjs
node scripts/check_playground_atari_st_browser.cjs --docs-dir release/itch_playground_atari-st-click-dev
```
