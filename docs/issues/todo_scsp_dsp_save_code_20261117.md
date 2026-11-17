# Save the current SCSP DSP setup as editable Code — 2026-11-17

User approved exporting GUI-adjusted DSP as JavaScript in Files. Record work
before implementation. Reuse the existing compile / apply / coefficient API.

- [x] Generate readable JavaScript for the acknowledged Synth DSP program,
  complete COEF0–2 table and effect settings. Use canonical field source and
  existing validation; do not serialize an unapplied draft or staged example.
- [x] Obtain one consistent snapshot from the primary owner when audio is
  active; saving cold must not create an AudioContext. Keep SSF independent.
- [x] Add a compact "Save setup to Code" action beside the Applied DSP state.
  Save a uniquely named .js file without overwriting, auto-running, stopping
  performance or forcing Keyboard into Code. Preserve the editor draft.
- [x] Reuse Files persistence, selection and failure / disposal safeguards.
  Generated Code restores setup when explicitly Run, using the current voices.
  Exclude PCM, note performance, active DSP history and voice routing from this
  export; explain these limits in help / readable generated comments.
- [x] Verify real-WASM round trips, complete snapshot consistency, source
  safety / invalid input, Files collisions / persistence and GUI coexistence.
  Check source and readable ZIP in permanently muted Chromium / WebKit.
- [x] Update docs, cache graph, package checks and verification records.

No new preset format, public npm API, scheduling, DSP language, native / WASM
rebuild, Tauri import, commit, push or publication.

## Completed / restart

Use DSP → Save setup to Code to write the applied program, all three
coefficients and effect settings into /dsp/SCSP DSP setup.js. Later saves use
numbered names. Saving keeps performance and Keyboard / Code mode; explicitly
Run the saved file to restore its DSP with the current voices. Source drafts,
PCM, voice routing, notes, live DSP history and the SSF engine are separate.

288 SCSP tests, 12 assembler tests and both calibration checks pass. Source /
final ZIP pass Chromium / WebKit, eight scenarios each (32 total). Existing DSP
Code regression also passes both browsers. All physical output stayed at gain 0.

Final ZIP: release/tetorica_scsp_synth_dsp-save-code2-20261117_itch.zip.
See [verification](verification_scsp_dsp_save_code_20261117.md) and
[machine evidence](verification_scsp_dsp_save_code_20261117.json).
No commit, push or publication.
