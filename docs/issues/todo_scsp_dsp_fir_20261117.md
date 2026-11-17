# SCSP DSP two-tap FIR example — 2026-11-17

User approved a small two-tap low-pass example running on SCSP's own DSP,
using the existing program / coefficient editor. Record work before coding.

- [x] Author a readable `.scspasm` fixture using MIXS0, TEMP history and EFREG0
  within the existing executable profile. Explain pipeline positions, DEC /
  rotating TEMP addressing, Q12 rounding and the precise supported equation.
- [x] Verify the shipped core's actual sample history / response with an
  independent impulse / fixed-point reference, block partitioning and frequency
  checks. Do not call a delay / gain change a filter or promise a cutoff knob.
- [x] Add a compact example chooser for built-in Delay and two-tap FIR. Loading
  an example stages source / recommended coefficients without changing sound;
  existing Check / explicit Apply performs the complete reviewed setup.
- [x] Keep program / recommended-coefficient application atomic in the audio
  owner, with rollback on transfer failure, no voice / Code reset, and the
  existing program-only / live-coefficient APIs intact. Retain cold migration,
  session scope and separate SSF / audition ownership.
- [x] Make the applied example and FIR's routing / tap meanings clear. Explain
  wet-only listening and that this short filter mainly reduces high frequencies;
  low sine notes change little. Keep shared controls compact and truthful.
- [x] Verify source / readable ZIP in permanently muted Chromium / WebKit,
  including staging, explicit Apply, coefficient / role synchronization,
  persistence boundaries, failure retention and keyboard / Code continuity.
- [x] Update usage, cache graph, package fixture / receipts and verification
  records. Preserve mixer measurements, default PCM behavior and existing APIs.

No new generic DSP language, public npm DSP API, coefficient-bank / RAM-layout
editor, SDK / WASM rebuild, Tauri import, commit, push or publication. Use the
existing three coefficient entries and keep portable voice / idle formats.
Physical output remains muted during automated checks; no human listening is
claimed. If current DSP history cannot be initialized safely, document or bound
the startup transient rather than resetting unrelated voices.

## Completed / restart

**DSP → Example → 2-tap FIR low-pass → Check → Apply program + coefficients**.
Enable DSP return; use direct level 0 / high notes / Saw or Noise / Spectrum for
comparison. Choose the Delay example with the same workflow to restore its
program and recommended coefficients. Selecting / Check does not change sound.
Reset draft and source-only reload do not install coefficients.

Four microsteps implement the adjacent-sample FIR; independent Q12 reference and
real shipped-WASM EFREG / PCM match exactly. Old TEMP history affects at most
the first frame. The same setup is a no-op; changes apply atomically and keep
held voices / Code. Rejected / recoverably failed setup restores the complete
old state; ACK followed by failed refresh still retains the new acknowledged
setup and Applied label across audio restart.

247 SCSP tests, 12 assembler / CLI tests and both calibration checks pass.
Source / isolated ZIP pass Chromium / WebKit, 15 scenarios each (60 total),
including ACK / refresh / context-close recovery and newer-stage races. Existing
program Check / Apply browser regression also passes. All physical output stayed
permanently muted; no human listening or physical hardware claim.

ZIP: `release/tetorica_scsp_synth_dsp-fir2-20261117_itch.zip`.
See [verification](verification_scsp_dsp_fir_20261117.md) and
[machine evidence](verification_scsp_dsp_fir_20261117.json).
No commit, push or publication. Further filter examples / generic DSP API remain
separate decisions.
