# PC98 Synth four-source Mixer — 2026-11-19

User requests independent FM / SSG / Rhythm / ADPCM output-volume faders.

- [x] Add four host source gains before native mixing without editing voice
  registers or replacing hardware Level controls. Retain the legacy two-bus
  output-gain API and bit-exact unity output/clipping/timing behavior.
- [x] Verify source isolation, continued muted-source evolution, invalid-input
  atomicity, snapshots and old API behavior against the previous WASM.
- [x] Extend JS/Main/Worklet/synchronous reference playback and app Mixer to
  all four sources. Preserve Keyboard/Code, channel mutes and master gain.
- [x] Preserve old stored two-fader behavior where a persisted mix exists;
  retain YM2203 automatic correction and recorded FM/SSG volume handling.
- [x] Refresh the reviewed local SDK candidate, generated WASM/source receipts
  and readable distribution; complete affected checks and muted browser/ZIP
  verification. Do not weaken provenance/calibration checks to force a pass.

The current 12ms ADPCM release experiment remains unchanged. This task adds
source mixing; any later higher-resolution software release is a separate step.
No npm/GitHub/itch publication, staging or commit is requested.

Implementation and validation:

- Native source gains are additive to the existing two-bus API. The pinned
  vendor YM2608 core is unchanged. A reviewed local SDK candidate is imported
  with an authenticated source ZIP and generated build receipts.
- Four independent faders cover 0–380%; boosted values use orange. YM2203
  correction and file volume entries apply to FM/SSG only. Existing per-channel
  monitor mutes remain available. There is currently no persisted output mix
  in Cassette; the model can normalize a previous two-bus record explicitly.
- All-unity output is exactly unchanged across 586 differential cases and
  7,264,744 stereo frames. Rebuilding the imported candidate also passes the
  same comparison. Real-WASM tests cover isolation, scaling, muted evolution,
  snapshot restore and invalid-input atomicity.
- 290 focused app/runtime/package tests pass. Source faders preserve VGM
  transport, paused position, instrument registers and settings through seek.
- Standalone ZIP generated and its 38 native source inputs authenticated:
  `release/tetorica_fm2608_synth_four-source-mixer-verified-20261119_itch.zip`.
- [x] Finish muted Chromium/WebKit verification of the app and packaged ZIP.
  Both browsers pass all four-source output/Code/transport checks. The ZIP
  matches 113 loaded source assets; physical output is zero throughout.
- [x] Finish fresh PS1/WonderSwan/POKEY/SCSP raw+verify calibration reports and
  update active references without rewriting historical measurement evidence.
  Eight complete reports pass. Normal generators reproduce the new policy;
  the only coefficient changes are the newly measured POKEY values (about
  -0.004%) and SCSP primary gain (0.128825 to 0.128826). YM2608 gain is unchanged.
- The new evidence tests pass 10/10; migration integration has no unresolved
  failures (85/87 initially, corrected expectations pass 17/17), with a further
  29 historical policy/source checks and three exact policy-pin checks passing.
  No tracked historical measurement JSON was edited. Independent mutation
  checks reject altered current sources and reports.
- All 102 artifact/inventory/staging tests pass. The SDK pin verifies 484 files,
  and runtime artifacts verify 33 builds / 68 outputs / 75 mirrors. Runtime
  strict types, 434 generated declarations and installed NodeNext/Bundler /
  browser consumers pass. npm packages were built locally, not published.
- App-specific engine/loader/WASM URLs are versioned together. Reference
  playback passes fetched WASM bytes through the supported `wasmBinary`
  option, avoiding stale cache combinations.

Detailed working logs are in `build/fm2608-source-mixer-20261119/`.
The artifact-builder test fixture also excludes the existing standalone Atari
player builder, like the standalone SID builders; it does not use the SDK
dispatcher simulated by that fixture. No Atari runtime code is changed.
