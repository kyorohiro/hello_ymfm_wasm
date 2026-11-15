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

The user requested the next pass after the first playable version. Implement
reference playback / inspection / capture, special FM controls and portable
Code-loaded samples. Keep Looper and Event recording deferred. Reuse the
existing player, decoder, Files and calibration revision mechanisms.

- [x] Persist imported VGM / VGZ / S98 files under `/vgm/` and list them above
      the monitor with Play / Pause / Resume / Stop and Seek.
- [x] Follow FM, SSG, Rhythm and ADPCM-B settings through the existing controls.
- [x] Audition paused channels, capture their sound and retain song position.
- [x] Allow manual edits and keyboard interaction during reference playback.
- [x] Keep Code and reference-song transports exclusive while manual playing
      remains available to either transport.

- [x] Add VGM / S98 reference playback, Live channel inspection and tone capture
      through the existing OPNA Analyzer engine.
- [x] Expose CH3 special frequencies, per-operator Key On and CSM in the UI.
- [x] Capture Code-loaded ADPCM memory and its selected address range into a
      portable preset, preserving keyboard reference tuning after release.
- [ ] Evaluate Looper / Event recording after the four sound sections work.
- [x] Add FM2608 to the bulk itch.io release plan when preparing its release.
- [ ] Prepare a separate Tauri repository when requested.

The first version uses the existing Tetorica synthetic rhythm ROM. FM, SSG,
Rhythm and ADPCM-B are sections of one YM2608. Keyboard allocation and Pitch
are software performance features. Additional Code effects are host software.

## First-version verification

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
- Existing mixer-calibration revision tests had five failures among
  twelve tests across the HuC6280, PS1 import and YM2612 export chains. HEAD
  versions of `playground_monaco.js` and `playground_monaco_definitions.js`
  already fail receipt recognition when passed to the restoration function.
  The complete tests were not rerun in a separate HEAD checkout. This task
  changed no DSP or WASM. The FM2608 packager used its own verified receipts.
- [x] Reconcile those pre-existing Monaco UI changes with the calibration
      revision chain before rebuilding the older Playground packages.

## Reference-playback verification

- Verified package is `release/tetorica_fm2608_synth_dev-20261115-reference-ready_itch.zip`.
  Browser reports are `build/fm2608-synth-reference-ready.json` and
  `build/fm2608-synth-reference-ready-monaco.json`.
- 109 OPNA unit, source navigation, shared Code and package checks pass.
- The real OPNA core's CPU-uploaded and VGM-block samples match captured bytes.
- Chromium and WebKit each pass 24 speaker-muted audio / UI scenarios, including
  reference playback, independent paused audition, Capture, Seek, source-channel
  Mixer, keyboard interruption and Code / song handoff. Monaco also checks the
  CSM and portable-capture implementation links in both browsers.
- Manual edits remain visible when Auto update is off. Seek progress resumes
  following the audio clock after a focused slider edit. Invalid file selection
  retains the previous song, selector and running transport.
- Reference songs use one YM2608 and play one pass. Unsupported chips are
  rejected before replacement. Rhythm uses the original Tetorica synthetic ROM.
- Reference Capture requires complete external-memory samples with 32-byte
  addressing. CPU-direct streams and 1-bit DRAM report their capture limits.
  Code sample capture supports completed uploaded 8-bit DRAM data. A dirty
  CPU-written memory image can be replaced with a successful upload or preset.
- PS1, WonderSwan, POKEY and SCSP now have complete new baseline / verify reports
  after the earlier SPC API additions. All 637 calibration-related checks pass.
  Both generated gain policies reproduce those measured inputs. Historical
  measurements are retained through strict UI and gain-policy revision records.
- The bulk release plan now includes FM2608. The Playground's SPC helper is
  included, and its browser ZIP stays within 1000 entries with all original
  build sources retained in the included source ZIP.
