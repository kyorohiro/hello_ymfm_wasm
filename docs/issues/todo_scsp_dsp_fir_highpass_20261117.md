# SCSP FIR low-pass / high-pass comparison — 2026-11-17

User approved a high-pass example using the existing two-tap FIR instructions,
changing only COEF1 from +2048 to −2048. Record work before implementation.

- [x] Add a readable high-pass example / fixture with recommended codes
  `[4095,-2048,2048]`, retaining every program word from the low-pass example.
- [x] Verify actual shipped-WASM impulse polarity, independent signed Q12
  arithmetic, low-frequency suppression and high-frequency response. Explain
  the small quantization residual rather than promising exact DC cancellation.
- [x] Add high-pass to the existing chooser / explicit Check and atomic setup
  Apply. Selection / Check must leave sound unchanged; switching LP / HP keeps
  held keyboard / Code and does not rewrite identical MPRO instructions.
- [x] Identify the shared FIR program separately from its coefficient variant.
  Applied labels and routing hints must follow actual acknowledged coefficients,
  including manual / Code changes; custom taps must not be labelled low-pass.
- [x] Retain existing staging / newer-draft races, failure recovery, cold setup,
  source-only persistence and separate SSF ownership. Keep existing live controls
  and backend transactions; do not add a new DSP language or audio engine.
- [x] Verify source / isolated readable ZIP in permanently muted Chromium /
  WebKit, existing tests and mixer checks; record package hashes and restart notes.
- [x] Update user guidance, cache graph, package fixture / receipts and the
  preceding FIR TODO. Keep default PCM and portable formats unchanged.

No new public DSP npm / Code API, SDK / WASM rebuild, Tauri import, commit,
push or publication. The existing FIR first-frame TEMP-history bound remains.

## Completed / restart

**DSP → Example → 2-tap FIR high-pass → Check → Apply program + coefficients**.
Enable DSP return and direct level 0 for comparison. LP / HP use identical
instructions; COEF1 alone changes +2048 / −2048. Applied labels and routing
hints track actual coefficients, including manual / Code updates. Other weights
show custom coefficients; observation does not replace drafts / staged settings.

249 SCSP tests, 12 assembler / CLI tests and both calibration checks pass.
Actual WASM impulse / signed-Q12 / frequency tests confirm low-frequency
suppression with a small DC residual. LP → HP causes no MPRO writes / program
revision change and retains voice / sample phase. Backend / audio / low-pass
fixture files remain byte-identical to HEAD.

Source / final ZIP pass Chromium / WebKit, 14 scenarios each (56 total).
The preceding full FIR browser regression also passes, including ACK / failed
refresh / AudioContext-close restart. All physical output was permanently muted.

ZIP: `release/tetorica_scsp_synth_dsp-fir-highpass-20261117_itch.zip`.
See [verification](verification_scsp_dsp_fir_highpass_20261117.md) and
[machine evidence](verification_scsp_dsp_fir_highpass_20261117.json).
No commit, push or publication.
