# SCSP Synth DSP coefficients — 2026-11-17

User approved COEF0–2 display / editing synchronized with existing Feedback.
Record this bounded checklist before implementation.

- [x] Show three compact coefficient controls with signed 13-bit code,
  normalized Q12 multiplier and actual register word / address. Explain that
  labels describe the built-in Delay; edited microprograms may use them differently.
- [x] Support integer codes −4096..4095 for all three, writing bits 15..3 with
  low three bits zero. Extend existing Feedback to −1..4095/4096 and synchronize
  COEF1 both ways, including Code changes. Retain the current default behavior.
- [x] Validate coefficient partial patches at the audio owner. Update only
  requested entries, retaining concurrent changes to other entries. Apply live
  without resetting voices / Code, MPRO or ring tails. Roll back recoverable
  write failures; stop the owner if restoration itself fails.
- [x] Keep COEF0/2 as Synth-session settings, including cold audio migration,
  Stop / mode / voice-preset loads and audio restart. COEF1 follows the existing
  voice-preset Feedback value. Leave the idle-state / voice-preset formats and
  `.scspasm` program-only exports unchanged. Do not auto-restore coefficients
  from local storage. SSF / audition DSP remains separate.
- [x] Reuse number steppers / drag controls without focus stealing. Correct
  fractional-step / endpoint precision so 1/4096 and 4095/4096 survive controls.
- [x] Verify signed encoding, real shipped-WASM output, live continuity,
  cross-control / Code synchronization, startup / session preservation, invalid
  patches and injected write failures. Test source and an isolated readable ZIP
  in permanently muted Chromium / WebKit; record evidence and restart notes.
- [x] Update cache graph / usage docs, preserve mixer measurements and gain
  calibration, and link the completed follow-up from previous DSP TODOs.

No new public DSP npm / Synth Code API, general coefficient-bank editor,
MADRS / RAM-layout changes, SDK / WASM rebuild, Tauri import, commit, push or
publication. Existing Code `setEffect({feedback})` continues to control COEF1.
New signed / >0.85 Feedback values use the current preset field but are outside
older Synth versions' accepted range; document this compatibility boundary.

## Completed / restart

Open **DSP → Synth DSP coefficients · live**. COEF0 / COEF2 are session-only;
COEF1 is the existing saved Feedback value. Both Feedback and raw COEF1 reflect
the current quantized hardware multiplier, including Code `setEffect` changes.
Coefficient edits are live and keep the ring, MPRO, held voices and Code.

232 SCSP tests and 12 assembler / CLI tests pass. Source and the final isolated
ZIP pass Chromium / WebKit with 15 scenarios each (60 total), including real
partial-update competition with Code, exact Q12 controls, rejection recovery,
audio restart and 390px layout. The earlier Check / Apply workflow regression
also passes. Physical output remained permanently muted; no human listening.
Both mixer generators pass without changing gain / measurement evidence.

Local ZIP: `release/tetorica_scsp_synth_dsp-coefficients-20261117-r2_itch.zip`.
See [verification](verification_scsp_dsp_coefficients_20261117.md) and
[machine evidence](verification_scsp_dsp_coefficients_20261117.json).
No commit, push or publication. General tables, RAM layout and additional DSP
program examples remain separate decisions.
