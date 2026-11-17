# Playground SCSP DSP execution — 2026-11-18

User approved applying assembled DSP programs in Playground, live coefficient
updates and editable short Gain / IIR examples. Work in the normal main checkout
from c2ba69cb. Keep existing immediate sound APIs and audio behavior intact until
DSP is explicitly configured; no publication, version bump, commit or push.

- [x] Inspect the Synth's checked DSP profile, Playground audio / Native owners,
  sample allocator and lifecycle; record the smallest supported execution scope.
- [x] Reuse validated field / coefficient logic and add explicit per-instance DSP
  program application, readback and coefficient changes. Reject invalid setups
  atomically; coefficient edits preserve held voices and filter history.
- [x] Wire Main / Worker ordering and ownership, reset / disposal behavior, and
  Web Audio / Native capability handling without silently dropping operations.
- [x] Add accurate types, completion / implementation navigation and readable
  Files examples with beat-based notes and independent coefficient motion.
- [x] Test real DSP output and invalid requests, instance isolation, Main / Worker,
  lifecycle and 44.1 / 48 kHz behavior; inspect source and standalone distributions
  in isolated browsers with physical audio permanently muted.
- [x] Run relevant package / source / calibration checks and record remaining
  limits and manual listening tasks.

Do not add a DSP language, scheduler, broad cross-chip abstraction or UI effect
editor. Pure assembly remains separate from program validation and application.

Verification: [verification_playground_scsp_dsp_execution_20261118.md](verification_playground_scsp_dsp_execution_20261118.md).
Main / Worker Web Audio, source and both standalone distributions are verified.
Native DSP transport and RAM-backed programs remain outside this first profile.
