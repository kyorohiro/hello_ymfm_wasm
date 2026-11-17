# YM2149 envelope-pitched Sync-buzzer example — 2026-11-17

User approved adding a ST Synth example with Tone / Noise disabled, melody
pitch supplied by periodic R13 envelope retriggers, and timbre controlled by
the shared envelope Period. Use existing build / compile / schedule APIs only.

- [x] Inspect example discovery, Apply / Stop ownership, public note conversion,
  UI cache tokens, and readable-package / calibration provenance requirements.
- [x] Add `/examples/envelope-melody.js` without replacing existing examples,
  saved source, input mode, or starter `index.js`. Follow BPM with `beat()`;
  use one compact named repeat per note and explicit release / owner cleanup.
- [x] Explain software scheduling, the shared hardware Envelope, pitch versus
  Period, sample-clock limits, and manual edits / reservation conflicts.
- [x] Verify the actual editable source against shipped AY WASM at 44.1 / 48 kHz:
  register setup, repeated R13 writes, fundamental pitch, Period-dependent
  waveform, reference-rate independence, and silence after cancellation.
- [x] Verify source and packaged UI with physically muted Chromium / WebKit:
  Files discovery, Run / Apply / Stop, note changes, manual Period edits,
  ownership cleanup, saved examples and New Project / cache behavior.
- [x] Refresh only required UI source receipts / version tokens, build a local
  readable Web ZIP, run applicable checks, and record results / restart state.

No new runtime API, timer-per-write fallback, Native scheduling, shared mixer
gain change, C++ / WASM / SDK rebuild, external game assets, physical audio,
commit, push, Tauri import or publication. Existing staged examples-verification
records belong to the user and must remain staged and unchanged.

## Completed / restart

Implementation uses Shape 9 (one decay then zero hold) so a shorter Period
does not add free-running ramps. Initial setup also writes Shape 9 immediately
to keep the UI shadow consistent with the scheduled byte. Per-note repeated
patterns contain only one R13 write; live Period edits are retained.

176 tests passed, including six actual-source / shipped-WASM tests. Source and
package browser checks passed 16 scenarios in Chromium / WebKit: performance
(4), persistent HTTP-cache migrations (8), and New Project (4). Both mixer
freshness checks passed with existing evidence and gain values unchanged.

Local readable ZIP:
`release/tetorica_ym2149_st_synth_envelope-melody-20261117_itch.zip`.
No commit, push or upload performed.

Usage and results: [verification](verification_ym2149_envelope_melody_20261117.md)
and [machine evidence](verification_ym2149_envelope_melody_20261117.json).
