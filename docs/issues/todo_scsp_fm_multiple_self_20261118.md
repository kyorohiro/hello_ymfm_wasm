# SCSP Synth multiple Self operators in Custom4/6 — 2026-11-18

Base `47d9a51e`; worktree was clean. User approved multiple independent Self
operators in Custom4/6, for example B/C feeding themselves and merging at A.

- [x] Allow multiple Self targets in Custom4/6. Each target must contain only
  `[self]`, reserving both native history taps X32/Y0. Other targets keep up to
  two external sources. Reject Self plus external input, duplicates, malformed
  graphs and multi-OP cycles before any mutation.
- [x] Keep Custom2's existing one-Self limit. Resize keeps surviving routes;
  if shrinking to 2OP leaves two Self targets, reject atomically rather than
  choosing or deleting one. Explain this limit and restore the visible mode.
- [x] Verify distinct physical mappings and exactly two owned history clears
  per new Self OP, with no cross-OP/group/manual/DSP interference. Live Depth,
  release, retrigger, steal and Code behavior retain their established policy.
- [x] Permit each active OP's own Self choice, reserve its Y tap, display all
  Self operators/Depth-Off state, retain every Self loop and compact UI.
- [x] Keep v8 for single Custom2 Self and v9 for single Custom4/6 Self. Add v10
  only for actual multiple-Self Custom4/6 graphs, with optional depths. Preserve
  old non-self formats and reject mis-versioned graphs after normalization.
  Update Code types/help and a fresh-project editable parallel-Self example.
- [x] Verify actual WASM against explicit independent native fixtures at
  44.1/48 kHz, prior 110 cases plus existing single Custom4/6 Self behavior,
  source receipts, muted source/ZIP browsers, readable packaging and local CI.

No general cross-OP cycle engine, external input into a Self target, variable
feedback delay/gain, core/common-runtime/WASM changes, npm publication/version
bump, commit/push/tag, other Synth or Tauri edits. Physical output stays muted.
The zero-slot-delay core is not full physical SCSP pipeline emulation.

Evidence: `build/scsp-multiple-self-20261118/`.

Completed checkpoint: backend/root/Code/types/browser sources frozen. Focused
backend 115/115, full Synth 409/409 and packaging 2/2 pass (411 overall).
New native tests cover all 78 nonempty Self subsets, including 68 multiple-Self
subsets, with 924 independent paired comparisons at 44.1/48 kHz and MDL 0/1/12.
Source Chromium/WebKit pass 60 grouped cases with physical output muted.
150 actual predecessor/current cases match. Source receipt object pin:
`81b4890696738eda52221af04b44fea955cd3e637947b2eeacfbbf521b3c036e`.
Candidate ZIP: `release/tetorica_scsp_synth_multiple-self-20261118_itch.zip`.
Source and exact-ZIP browsers pass 92 grouped cases at 48 kHz with permanent
mute. 88 proof tests, 17 recorder checks and both Mixer generators pass.
Independent actual-Git reconstruction and 150 rerenders match with zero
mismatches. All 382 ZIP entries, 153 comparable served files and 354 embedded
original inputs match. See the
[verification record](verification_scsp_fm_multiple_self_20261118.md).

Remaining manual/future work is listening, full physical pipeline comparison
and cross-OP cycles. No implementation remains for this bounded extension.
