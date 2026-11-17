# YM2612 timed operation API — 2026-11-17

User requested the next horizontal step after the YM2149 release and passing
CI. Add `build()` / `compile()` / `schedule()` to YM2612, beginning with Operator
partial updates and Key On / Off. Preserve immediate APIs and legacy
`scheduleWrites()`. Use the existing AY timed design / performance lifecycle.

- [x] Inspect YM2612 client / transport / register shadow and both Worklets;
  decide how immediate and recorded operations share the same chip resolver.
- [x] Add serializable state-free recording, current / client / reset /
  reusable-snapshot compilation and explicit unsupported-backend behavior.
  Preserve port numbers, repeated writes, partial updates and same-time order.
- [x] Connect bounded sample-timed reservations and authoritative state capture
  to ymfm / Nuked Worklets, retaining queue ownership, atomic replacement,
  cancellation and existing `scheduleWrites()` behavior.
- [x] Integrate Main / Worker and Synth Code Run / Apply / Stop, with declaration
  / completion support comparable to the existing AY timed API.
- [x] Add a readable example with independently timed melody and Operator TL /
  MULT motion plus an inspectable compiled trace, following existing Files
  preservation and `beat()` conventions. State that timing is software.
- [x] Verify register semantics, partial fields / Key masks, compilation versus
  execution, 44.1 / 48 kHz timing, both engines and lifecycle boundaries. Run
  muted real-browser checks and package / type / calibration freshness checks.
- [x] Record verification, implementation limits and restart information.

Completed evidence: [verification and usage](verification_ym2612_timed_api_20261117.md)
and [machine-readable results](verification_ym2612_timed_api_20261117.json).
Runtime 4033 / Synth 699 tests passed; 28 muted browser cases, installed npm
runtime / declarations, and all four affected distribution ZIPs passed.
The package remains unpublished at version 0.2.40. No commit or push was made.

Do not add Looper / Event Rec, PCM transfer / DSP scheduling, all-chip abstraction
or a new public musical `play()` API. Do not commit, push or publish unless asked.
The new feature must preserve exact existing default audio behavior and measured
source provenance; use targeted mirror synchronization / evidence rather than
blindly rewriting all runtime artifacts.
