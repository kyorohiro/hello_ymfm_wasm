# SCSP Synth single-operator feedback prototype — 2026-11-18

User approved the next bounded step: investigate sound-stack history, verify a
single self-feedback OP in 2OP using Code/real WASM, then expose only the proven
configuration in Custom UI/persistence. Base `412d1d28`; worktree was clean.

- [x] Inspect the pinned zero-delay core's read/write order, 64-entry stack and
  native 44.1 kHz timing; distinguish this implementation from physical SCSP.
  Confirm against primary source/documentation where available.
- [x] Build independent native/reference experiments for offset-zero feedback,
  MDL 0/low/high, first-sample history, live changes, note release/retrigger,
  Stop/steal, slot placement and separate-group/manual/DSP ownership.
- [x] Decide and document the minimal supported graph after evidence: one
  self-feedback OP in Custom2, no general multi-OP cycle/4OP/6OP feedback.
  Avoid silently changing core timing or existing non-feedback sound.
- [x] If verified, integrate Code configuration, bounded Custom input choice,
  diagram/role/help and explicit feedback-capable preset version. Preserve
  prior versions/default exports and atomic rejection of unsupported graphs.
- [x] Verify native PCM/reference equivalence and legacy calibration, same
  native timing at 44.1/48 kHz output, releases, owners and preset roundtrips.
- [x] Verify muted source/ZIP Chromium/WebKit, CI, provenance and durable
  restart evidence. Keep limitations explicit if evidence blocks UI exposure.

The [research and adopted contract](scsp_fm_self_feedback_research_20261118.md)
distinguish the physical six-slot pipeline from this core's zero-delay slot
writes. Self uses X32/Y0, two stored generations, not an instantaneous loop.
The existing adapter's Depth 0 remains Off. Only a new owned Auto / Code self
attack clears its two history cells; live edits, other owners and raw physical
CH retain their histories. Supported self graphs save as v8; old non-self
exports stay v4–v7. Fresh / New projects include `examples/self-feedback.js`;
existing projects are not overwritten.

Restart evidence: `build/scsp-self-feedback-20261118/`. Synth/packaging
389/389, proof 74/74, legacy exact parity 66 cases, 13 recorder checks and both
Mixer generators pass. Source Chromium/WebKit pass 8 grouped cases each at
48 kHz, permanently muted. Source receipt object SHA-256:
`b64fdce7df322bb76466c898f6dd7638c0cba8b4c177b5c2547c5bb2067570c5`.
The tested candidate ZIP is
`release/tetorica_scsp_synth_self-feedback-20261118_itch.zip`.
Exact ZIP Chromium/WebKit each pass all 8 grouped Self cases and the unchanged
6-case multi-OP suite. Independent reverse-hunk/Git/hash audit has zero
mismatches; historical JSON/runtime/native/WASM/gains/vendor/packages retain
their base bytes. All 380 ZIP entries, 151 comparable served files and 352
embedded original inputs match. See the
[verification record](verification_scsp_fm_self_feedback_20261118.md).

Remaining manual/future work: listening, physical pipeline comparison, general
multi-OP cycles and higher-operator feedback. CI commands passed locally;
GitHub-hosted execution awaits a user push. No required implementation remains
for this bounded prototype.

No generic cyclic graph engine, arbitrary feedback delay/gain, DSP feedback
changes, npm publication/version bump, core rebuild, parent commit/push/tag,
other Synth or Tauri changes. Existing common SCSP runtime/WASM/gains and
historical JSON remain unchanged. Browser output stays physically muted.
