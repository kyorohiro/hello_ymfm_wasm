# SCSP one-pole IIR low-pass example — 2026-11-17

User approved a small one-pole IIR low-pass using preceding output feedback.
Record this checklist before implementation.

- [x] Author a readable TEMP-based three-step IIR fixture within the current
  execution profile. Use previous output / current input, recommend stable Q12
  codes, and explain accumulator pipeline / rotating TEMP addressing.
- [x] Verify real shipped-WASM EFREG / PCM against an independent recursive
  fixed-point reference, impulse decay, frequency response, partitioning, no
  sample-RAM writes and retained voice / sample phase.
- [x] Characterize inherited TEMP state and fixed-point residuals. Unlike FIR,
  old history is recursive and need not disappear after one frame. Do not add
  hidden native rendering or reset unrelated voices during Apply. Document
  recommended-coefficient stability and how Stop resets history.
- [x] Add the example to existing source / coefficient staging, Check and atomic
  Apply. Keep cold startup, session persistence, newer-draft races, ACK / failed
  refresh recovery and separate SSF / audition ownership intact.
- [x] Show IIR roles, unused COEF0, output feedback / input coefficients and
  disabled Delay Time. Recognize default / custom coefficients from actual owner
  state, including Code. Explain gain matching without adding a cutoff / resonance
  knob or changing the live coefficient API.
- [x] Verify source / readable isolated ZIP in permanently muted Chromium /
  WebKit, existing tests, prior recovery regression and calibration checks.
- [x] Update guidance, cache graph, package fixture / source receipts, TODO links
  and verification / restart records. Preserve default behavior and formats.

No new DSP language, public npm / Code setter, RAM layout, audio engine, SDK /
WASM rebuild, Tauri import, commit, push or publication. Coefficients remain
raw hardware values; this milestone adds a tested example, not automatic tuning.

## Completed / restart

**DSP → Example → 1-pole IIR low-pass → Check → Apply program + coefficients**.
Enable DSP return / direct level 0 for comparison. COEF0 and Delay Time are
unused / disabled. COEF1 is output feedback, COEF2 input. Recommended 3840 / 256
means `y[n] ≈ 0.9375*y[n−1] + 0.0625*x[n]`; individual edits also change gain.
Actual default / custom identification and Code synchronization remain live.

The three-step program matches an independent recursive Q24 reference, including
signed extremes, impulse decay, frequency response, old TEMP state and −1 PCM16
zero-input residue. Unlike FIR, inherited history recurs over multiple samples.
Stop resets history; clearing Delay RAM with Apply / Enable does not reset TEMP.
Restore guidance visibly explains that source-only reload does not stage coefficients.

256 SCSP tests, 12 assembler / CLI tests and both calibration checks pass.
Source / final ZIP pass Chromium / WebKit, 15 scenarios each (60 total), plus
the preceding complete FIR recovery regression. All physical output stayed
permanently muted. Existing backend / audio / prior fixtures are unchanged.

ZIP: `release/tetorica_scsp_synth_dsp-iir1-20261117_itch.zip`.
See [verification](verification_scsp_dsp_iir_20261117.md) and
[machine evidence](verification_scsp_dsp_iir_20261117.json).
No commit, push or publication.
