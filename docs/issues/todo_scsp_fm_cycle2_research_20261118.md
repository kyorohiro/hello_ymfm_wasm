# SCSP two-operator cross-cycle research/prototype — 2026-11-18

Base `553c59bbf05f601b38ee24196a8d570105c5c1db`; worktree was clean.
User approved investigating A -> B -> A using Code and real WASM before choosing
a model or extending the Synth UI/preset format.

- [x] Compare SEGA's physical slot pipeline and latest/past selectors with the
  pinned zero-slot-delay core. Derive age of cross-slot taps under either slot
  order and distinguish same-bank future-slot reads from previous-frame reads.
- [x] Build independent raw/native recurrence experiments for a bounded 2OP
  cycle: current/previous/history-average alternatives, slot placement/order,
  MDL 0/1/low/high, startup/stale history, live Off/On, release/retrigger/Stop,
  and 44.1/48 kHz output. Do not validate a plan using its own routing helpers.
- [x] Create a reproducible Node probe/test and a readable runnable Code example
  using existing low-level SCSP APIs. The FM2612 Playground SCSP client exposes
  raw physical modulation; current Synth Code's logical performance facade does
  not. Document the exact destination rather than claiming Synth support.
- [x] Decide the bounded candidate from measurements: explicit operator order,
  exact tap ages and register words, initial-history policy, external output
  mixing and limits. Record what remains unproven about physical hardware.
- [x] Verify the example with physically muted browsers, record evidence and
  preserve production Synth/runtime/core/WASM/gains and historical JSON bytes.
  Add a follow-up implementation proposal only after experiment results.

Research/prototype only. Do not unlock Synth cycles, add a preset version,
modify common runtime/core timing, make a generic cyclic graph engine, publish
npm/itch, bump versions, commit/push/tag or edit Tauri/other Synth apps.
No sound is sent to a physical output device.

Evidence: `build/scsp-cycle2-20261118/`.

Completed: candidate `current-forward-average12`, physical A6 before B7.
A reads B's previous one/two stored generations (X33/Y1), B reads current A
(X63/Y63). At MDL8 the requested words are 0x8841 / 0x8FFF. The new example is
`docs/playground/research/scsp-cycle2-prototype.js`, outside the generated
example catalog. Create a JavaScript text file in Playground SCSP mode and
paste it; Run reevaluation preserves preparation, Stop -> Run starts fresh.

Native evidence: 600 steady +40 lifecycle +10 center +10 carrier cases, two
wrong-history counterexamples, and a dedicated history-policy probe. Tests:
11 native +3 example pass. Browser: 64 checks across both engines, execution
modes and host rates, with permanent physical mute. Independent actual-Git,
selector, artifact and scope audit passes. Existing production receipt still
passes; only CI test/artifact commands change among previously tracked files.
See [research](scsp_fm_cycle2_research_20261118.md) and the
[verification record](verification_scsp_fm_cycle2_research_20261118.md).

Next implementation decisions (not performed here): bounded Synth cycle2
operator order/output model; atomic validated attack and owned-history policy;
steal/manual/Code ownership; UI and explicitly versioned persistence; listening.
Separately investigate whether Files' binary-import path should create editable
text for JavaScript. The verified prototype path is new text file + paste.
