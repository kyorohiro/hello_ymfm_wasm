# Tetorica ST YM2149 Synth — Tauri, 2026-11-17

User requested a desktop app in `w/tetorica-st-ym2149-synth-tauri`, including
readable code and matching core sources so others can modify and reuse it.
Start from the existing Tetorica desktop wrapper, retain the new product name,
and import the verified Web release without minifying or rewriting its modules.

- [x] Create the initial Tauri repository files, icon set, version 0.0.1 and
  macOS / Windows / Linux build workflow, following the existing desktop apps.
- [x] Adapt the Web-release importer to validate YM2149 browser modules, AY /
  AtariAudio / effect sources and receipts, keeping original bytes in `dist/`.
  Keep `--version`, cross-platform hashes and explicit local-edit recording.
- [x] Integrate one Menu, Pin, native save dialogs and final-bus audio output
  controls with the existing Synth. Preserve Code, timed reservations, reference
  playback, Files / New Project and a single shared audio graph.
- [x] Include readable JavaScript / CSS, core source archives, rebuild scripts,
  licenses and README instructions for importing, editing and building.
- [x] Run importer / version / local-edit tests, desktop-adapter tests, muted
  Chromium / WebKit checks and Rust tests. Build an unsigned local macOS app.
- [x] Record actual validation and remaining manual/device/platform checks.
  Do not commit, tag, push, publish or access signing credentials automatically.

The wrapper's optional Native mode sends the same WASM / AudioWorklet Master
output to Rust / CPAL; it does not add a second chip renderer or Native timed
operation implementation. Hosted builds remain unsigned. Local signed builds
use the existing certificate through `deploy_mac.sh` and user-supplied variables.

Completed local implementation and checks. See
[`w/tetorica-st-ym2149-synth-tauri/docs/verification_20261117.md`](../../w/tetorica-st-ym2149-synth-tauri/docs/verification_20261117.md)
for results and remaining human / hosted release checks.
