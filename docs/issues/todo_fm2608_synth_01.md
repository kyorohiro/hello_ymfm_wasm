# Tetorica FM2608 Synth

Started 2026-11-15. The user explicitly requested implementation after the
other Codex finished. The working tree was clean before this task began.

Build a playable YM2608 / OPNA Synth using the FM2612 Synth's editing and Code
conventions. Use the approved white FM2608 icon and keep shipped source readable.

## First playable version

- [x] Reuse the existing YM2608 runtime and shared FM control modules.
- [x] Add FM, SSG, Rhythm, ADPCM and Mixer tabs with physical-channel selection
      and Auto allocation where the hardware supports several melodic voices.
- [x] Support keyboard, pointer keyboard, octave and duplicated Pitch controls.
- [x] Keep Code playback and manual parameter/key input usable together.
- [x] Reuse Files, Monaco, Run / Apply / Stop, project persistence and export.
- [x] Save and load validated OPNA settings and embedded ADPCM sample data.
- [x] Provide a readable standalone itch.io package and a discoverable app link.
- [x] Verify the actual browser audio, controls, Code, files and packaged app.

## Subsequent development

- [ ] Add VGM / S98 reference playback, Live channel inspection and tone capture
      through the existing OPNA Analyzer engine.
- [ ] Expose CH3 special frequencies, per-operator Key On and CSM in the UI.
- [ ] Capture Code-loaded ADPCM memory and its selected address range into a
      portable preset. Current presets embed the editor's selected sample.
- [ ] Evaluate Looper / Event recording after the four sound sections work.
- [ ] Add FM2608 to the bulk itch.io release plan when preparing its release.
- [ ] Prepare a separate Tauri repository when requested.

The first version uses the existing Tetorica synthetic rhythm ROM. FM, SSG,
Rhythm and ADPCM-B are sections of one YM2608. Keyboard allocation and Pitch
are software performance features. Additional Code effects are host software.

## Verification notes

- 72 unit / source-navigation / shared Code regression / package checks pass.
- The final package passes 18 audio / UI scenarios in each of Chromium and
  WebKit. Reports are `build/fm2608-synth-packaged-final.json` and
  `build/fm2608-synth-packaged-monaco-final.json`.
- The verified ZIP is `release/tetorica_fm2608_synth_dev-20261115-final_itch.zip`.
  It contains readable modules, the matching WASM, 38 verified native inputs
  and the synthetic rhythm ROM's generator and license.
- Actual Monaco runs in Chromium and WebKit. Its worker accepts all four sound
  sections, opens the ADPCM implementation and fits expanded / mobile layouts.
- Browser audio checks intercept every destination through a zero-gain node.
  Actual FM, SSG, Rhythm and ADPCM-B PCM is measured while speakers stay muted.
- Existing mixer-calibration revision tests currently have five failures among
  twelve tests across the HuC6280, PS1 import and YM2612 export chains. HEAD
  versions of `playground_monaco.js` and `playground_monaco_definitions.js`
  already fail receipt recognition when passed to the restoration function.
  The complete tests were not rerun in a separate HEAD checkout. This task
  changes no DSP or WASM. The FM2608 packager uses its own verified receipts.
- [ ] Reconcile those pre-existing Monaco UI changes with the calibration
      revision chain before rebuilding the older Playground packages.
