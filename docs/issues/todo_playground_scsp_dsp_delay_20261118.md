# Managed SCSP DSP Delay in Playground / npm — 2026-11-18

User approved extending the existing Synth Delay to the common SCSP API after
npm 0.2.43. Start in the normal main checkout at 54f02905. Record decisions and
verification here so work can resume after a restart.

- [x] Inspect the fixed Delay program, DSP RAM addressing, append-only PCM/editor
  allocator, state adoption and Main / Worker ownership boundaries.
- [x] Add an explicit managed fixed-Delay API over the same owned SCSP core.
  Reserve a bounded ring on demand without moving or overwriting loaded PCM;
  reject invalid / insufficient-RAM requests before changing the current sound.
- [x] Preserve register-only Gain / IIR APIs, default untouched PCM behavior,
  held notes and per-slot sends / shared return. Define Delay tail, Time / Enable,
  program replacement, Stop, reset and reservation retention explicitly.
- [x] Add acknowledged Main / Worker integration, Native capability rejection,
  exact public types / completion and readable beat-based Files / npm examples.
- [x] Verify existing-Synth Delay PCM parity, nonzero-base addressing, impulse /
  feedback / render partitioning, RAM/editor protection, atomic failure and
  lifecycle. Test real browsers at 44.1 / 48 kHz with physical output muted.
- [x] Check the installed npm archive and affected standalone packaging / source
  guards; record limits, evidence and manual listening tasks.

This milestone does not publish npm, change versions, commit / push / tag, add
Reverb or arbitrary DSP RAM layouts, alter core/WASM/calibration, or update
Tauri / other repositories. Existing Synth Delay remains the reference.

## Decisions / restart

`setDspDelay({enabled, timeMs, feedback})` installs the original fixed six-step
Delay. Time is integer 20..700 ms; Feedback is -1..4095/4096 and read back as
signed-Q12 quantized feedback. Per-slot `setMix({dspSend})` and shared
`setDspReturn()` remain separate. The initial Return is muted until set explicitly.

The first successful call appends a 64 KiB reservation at an 8 KiB RBP boundary.
Existing PCM/editor pages retain their addresses. No reservation is consumed
on validation, insufficient space or failed installation. A detached `dspRam`
state field retains the reservation across program changes / reset(false);
`reset({clearRam:true})` releases it with the bank. Settings are materialized
once before selecting the ring, including for reentrant JavaScript getters.

Time / Enable changes clear the packed ring; Feedback / coefficients / Return
preserve it. KeyOff / noteOff leave echoes. Stop clears voices and the ring,
then restores setup. Applying a RAM-free image keeps the reservation without
using it. Continuous Feedback motion uses COEF1 small deltas, synchronized with
`delay.feedback`, rather than sending a full setup snapshot every tween step.

Source example: **Files → examples/scsp/scsp-dsp-delay.js → Code → Run**.
No npm publication is part of this milestone; public 0.2.43 does not yet expose
`setDspDelay()`. Final archive / source-guard checks pass; see
[verification and usage](verification_playground_scsp_dsp_delay_20261118.md).
Manual listening remains available when the user has time.
