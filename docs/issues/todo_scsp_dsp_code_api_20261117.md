# SCSP DSP authoring from Synth Code — 2026-11-17

User approved completing the Code workflow: compile DSP source, apply it to the
shared Synth, and change coefficients during performance. Record work first.

- [x] Add local, synchronous `scsp.compileDsp(source)` using the existing source
  Check / execution-profile validator. It returns owned 512-word data without
  chip / UI mutation or an audio-owner request; no parsing on the audio thread.
- [x] Expose session-fenced `applyDspProgram(words, options?)`, `getDspProgram()`,
  `getDspCoefficients()` and partial `setDspCoefficients(patch)` on the existing
  borrowed Code client. Reuse owner validation / atomic replacement / rollback.
- [x] Keep stale-client / Run / Apply / Stop ownership and argument snapshots.
  Invalid programs / coefficients cannot partially modify live sound. Code DSP
  calls target the primary shared Synth, independently of SSF / audition.
- [x] Publish acknowledged DSP changes to Main before returning a Code result,
  preserving program / all coefficient restart state even when observation or
  post-ACK refresh fails. Update Applied / live UI without overwriting drafts or
  polling / transferring program words every frame.
- [x] Add accurate types / completion / implementation navigation, and a small
  editable Code example compiling IIR then running independent beat-based melody
  and `tween()` coefficient motion. Update Files starters only without replacing
  existing saved projects or running imported code automatically.
- [x] Verify local compilation, remote dispatch, complete setup / partial edits,
  actual shipped-WASM PCM, stale calls, GUI coexistence and restart recovery.
  Check source / isolated readable ZIP in permanently muted Chromium / WebKit.
- [x] Refresh cache graph / editable assets, docs and verification records.
  Preserve default PCM, calibration, portable formats and existing APIs.

No new DSP language, reservation / scheduling API, independent chip instance,
public npm DSP export, SDK / WASM rebuild, Tauri import, commit, push or publication.
Program-only Apply retains live coefficients; staged complete setup Apply uses
the existing optional three-entry table. DSP program / coefficients are shared
Synth-session state and persist when Code stops; Code Stop releases owned notes.

## Completed / restart

Code now provides local `compileDsp()` and acknowledged program / coefficient
getters and setters on the existing shared Synth. Fresh Files include
`examples/dsp-iir-motion.js`; existing saved projects can add that readable file
without replacement. Run configures its IIR once; Apply retains live setup.
The independent `beat()` melody and four-second coefficient `tween()` use one
engine. Code Stop keeps shared DSP setup while retiring notes / clients.

269 SCSP tests, 12 assembler tests and both calibration checks pass. Source /
ZIP pass 44 browser cases total; the earlier FIR recovery suite passes 30 more.
All physical output remained gain 0; no listening was performed.

ZIP: `release/tetorica_scsp_synth_dsp-code-20261117_itch.zip`.
See [verification](verification_scsp_dsp_code_api_20261117.md) and
[machine evidence](verification_scsp_dsp_code_api_20261117.json).
No commit, push or publication.
