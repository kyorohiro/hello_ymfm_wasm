# SCSP Synth read-only SSF DSP observation — 2026-11-18

User approved observing the playing SSF's DSP, before the feedback milestone.
Base `3ec34056` (per-operator MDL); worktree was clean.

- [x] Add passive DSP observation to the pinned Mednafen SSF engine via the
  existing temporary build overlay, without bus reads, writes or sample clocks.
  Capture all 128 instructions, 64 signed COEF, 32 MADRS and 16 effect outputs;
  retain the existing slot/RAM snapshot and same observation frame.
- [x] Rebuild and verify readable SSF adapter/loader/WASM/source receipts.
  Keep the original vendor source tree untouched and preserve old rendering.
- [x] Carry owned DSP data through the existing audible-position history;
  Play/Seek/CH selection show the same snapshot, Pause stays frozen. Preserve
  the history byte/count budget and never imply missing data is zero.
- [x] Enable DSP tab during SSF Live as a clearly read-only SSF view. Show
  program/disassembly, coefficients and selected CH send/direct plus all shared
  returns. Keep the existing Synth draft/settings separate and restore them on
  Live Off/Stop. CH selection should not kick the user out of the DSP tab.
- [x] Reuse the assembler's whole-instruction decoder where valid, with raw
  words and an explicit fallback for unsupported data. Do not apply the Synth
  execution-profile restriction to viewing game DSP instructions.
- [x] Distinguish configured routing, instruction references and observed raw
  effect outputs; do not infer arbitrary program input-to-output connectivity
  or present sampled values as audio meters. Put detailed explanations in ?.
- [x] Verify observation does not alter PCM/native time/RAM/voice state;
  test nonzero DSP fixtures, snapshot ownership, pause/seek/history, rendering
  parity, Synth draft retention, readonly behavior and unsupported/missing DSP.
- [x] Verify source and exact standalone ZIP in muted Chromium/WebKit; update
  CI, provenance/calibration guards and durable restart records.

Scope: observation only. No SSF DSP edits, automatic copying/applying to Synth,
DSP history restoration, new generic scheduler/API, feedback implementation,
npm publication, parent commit/push/tag or Tauri changes. Preserve calibration
gains and historical JSON evidence. Browser physical output stays muted.

Completed: 375 Synth/packaging tests, 67 guard tests plus final 5-test checker
repin validation, 11 recorder checks and both Mixer generators pass. Eight
actual Git predecessor/new-observed/new-unobserved native cases match exactly.
CPU registers are not exported; the implementation review confirms const
copies without bus/clock calls. Source/ZIP Chromium/WebKit pass seven cases
each, and the existing DSP-flow ZIP suite also passes both engines.
See [verification](verification_scsp_ssf_dsp_live_20261118.md) and
[machine evidence](verification_scsp_ssf_dsp_live_20261118.json).

Follow-up: game-DSP transfer requires an explicit cross-engine dialect policy:
Mednafen NOFL is word3 bit8, while Synth/MAME uses bit15. The read-only view
adapts only its private decoding image and retains all original raw words.
Manual real-game listening, DSP history copying and feedback remain separate.
