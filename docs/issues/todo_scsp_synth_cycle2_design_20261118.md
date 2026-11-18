# SCSP Synth bounded two-OP cycle design - 2026-11-18

User approved preparing integration after the Playground prototype and Examples
registration. This step records the design and implementation TODO only.
Base `29d1dc14deaf3f5a41086263dc0f58aff7dfa443`; worktree was clean.

- [x] Inspect current graph routing, physical-slot allocation, Auto/Code/manual
  ownership, attack/release/Stop, preset versions and editor behavior.
- [x] Specify an explicit bounded two-OP order, current/return tap meanings,
  output/depth behavior and validation. Keep existing DAG and Self behavior.
- [x] Decide startup/reuse history, stealing and physical/manual interference
  using what the current core/API can guarantee. Mark any blocking limitation.
- [x] Specify minimal Code/UI/persistence integration and compatibility; list
  phased implementation and independent verification before enabling it.
- [x] Review the proposal against the existing code and measured prototype.
  Record what requires listening or real-hardware confirmation.

Do not change runtime/core/WASM, public APIs, UI, presets, gains or source
receipts during this design step. No package/version/release/commit/push/tag.

Design: [bounded Cycle 2OP](scsp_synth_cycle2_design_20261118.md).
Chosen shape: dedicated `fm.algorithm: 'cycle2'` for FM2, explicit outputs,
A-before-B mapping, fixed measured taps, four owned history cells initialized
only on a new grouped attack. Custom's existing DAG/Self rules remain intact.

## Implementation follow-up

- [x] Phase 1: config/planner/operator mapping plus group attack history policy,
  exposed through existing `setConfig()` and Code types. Test all 13 pairs,
  independent raw-register PCM, invalid-request preservation, live Off/On,
  release/reattack/steal, physical takeover and session Stop. Fault-test fatal
  classification for an unexpected write failure after the Cycle commit starts.
  Implemented separately in [the runtime/Code task](todo_scsp_synth_cycle2_runtime_20261118.md);
  portable v11 and the selectable Cycle UI remain Phase 2.
- [ ] Phase 2: version 11 portable presets, legacy rejection, dormant Custom
  and Cycle transitions, idle migration, fixed Cycle UI arrows/labels/outputs
  and a readable Synth example. Handle resampler cache reset when an
  outputs-only structural change actually resets the core. Preserve all prior
  default/preset behaviors, including group-only retirement with manual owners.
- [ ] Phase 3: actual Synth Code/UI muted-browser and package/default-parity
  checks at 44.1/48 kHz. Review only affected source receipts after final code.
- [ ] Human listening: startup, sustained feedback, release and initial audition
  level. Real-hardware fidelity is a separate question; do not claim it from
  an emulator/reference match.

No implementation prerequisite requires a new raw API, core delay model or
general graph scheduler. Listening remains pending while preparation can proceed.

Planning verification: independent lifecycle and API/UI reviews completed;
local documentation links and `git diff --check` pass. Only these design/TODO
documents and links from the earlier research are changed. No runtime tests
were added or run for this documentation-only step.
