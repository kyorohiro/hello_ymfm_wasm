# HuC6280 timed register API implementation

Follow the [shared contract](todo_synth_timed_register_api_20261119.md).

- [x] Implement and test the serializable recorder and isolated register
  resolver/compiler, sharing Huc6280Synth's existing conversion logic.
- [ ] Add detached coherent snapshots and current/client/reset/reused-state
  compilation. Reject incomplete client state and incompatible configuration.
- [ ] Connect compact reservations to Performance Queue and Worklet render
  boundaries, preserving selection, partial updates, event order and LFO reset.
- [ ] Connect acknowledged clients and Run/Apply/Stop/loop ownership. Explicitly
  distinguish the hardware Huc6280Synth operations from Synth's software
  envelope/DDA noteOn/noteOff wrapper; do not silently change immediate methods.
- [ ] Add types/completion, Main/Worker routes and Synth examples. Native routes
  must report unsupported capabilities explicitly until implemented.
- [ ] Verify live/manual interleaving, atomic replace/cancel, repeated writes,
  compilation parity and 44.1/48 kHz timing on muted source/readable ZIPs.

First bounded component: register-only recording/resolution. Sample transfer,
bulk Wave RAM uploads and software DDA feeding are outside this component.
No public Code scheduling capability is complete until the subsequent Worklet,
ownership, snapshot and declaration steps are all verified. No release/publish.

Recorder/compiler foundation: `tetorica_src/runtime/huc6280_operations.js` and
its byte-identical browser mirror, verified by `test/runtime/huc6280_operations.test.mjs`.
The internal resolver reuses Huc6280Synth; it does not expose a new public Synth
Code capability. Its noteOn/noteOff operations describe the hardware API only,
not the Synth software envelope wrapper. That boundary must be resolved in the
Worklet/client phase before advertising those methods to Code users.

Foundation verification: 726 HuC6280/package/runtime tests pass, including six
new recorder/compiler cases. No audio device or public scheduling route was
started. Log: `/private/tmp/huc-timed-foundation-tests-20261119.log`.
State-dependent admission (notably writeDda while DDA is already enabled) must
use authoritative execution state rather than treating reset-based argument
validation as proof of live validity in the upcoming scheduler integration.

## Current bounded Worklet component

- [x] Add a HuC6280-specific Performance Queue adapter and detached state captures.
- [x] Validate reservations against the applied state, then resolve partial writes
  again at each execution; never cache compiled register values for playback.
- [x] Test atomic replacement, staged commit/abort, owner cancellation and Stop,
  ordering and 44.1/48 kHz rendering without an audio device.
- [x] Connect Synth Code with explicit register-only gates; reconcile hardware gates
  with existing software envelope/DDA ownership without changing immediate methods.

Internal Worklet component verification: 750 HuC6280/package/AY timing tests and
54 shared queue/ownership/inspector tests pass. Twelve new cases render the real
HuC6280 WASM core through the shared queue into arrays; no audio device is opened.
Logs: `/private/tmp/huc-timed-worklet-tests-20261119.log` and
`/private/tmp/huc-timed-queue-regressions-20261119.log`.

Integration contract for the next component:

- `createHuc6280TimedProcessor` is now instantiated by the Synth Worklet
  and exposed by its Code client. Playground Main/Worker remain pending.
- The host must route `huc6280Timed` requests, dispatch
  `applyHuc6280TimedOperation` through the adapter, use
  `huc6280TimedCommandCost` in Performance Queue, and clear staged data on Stop.
- The host must supply a complete applied-state mirror; passing the UI/client
  shadow as current state is not sufficient. Native Wave RAM read pointers can
  advance while rendering: establish pointer provenance or explicitly reject
  incomplete state before allowing raw Wave RAM edits/capture compilation.
- The detached snapshot is operation-resolution state, not an oscillator phase,
  native save-state or transport restoration facility. Live/client/reset/snapshot
  compile options remain to be connected at the public client boundary.
- Hardware gate operations must coexist with software-envelope voices without
  changing existing immediate noteOn/noteOff behavior. Preserve manual ownership
  for parameter writes, protect newer gates from old releases, and validate this
  with the actual Synth processor before exposing the capability.

## Synth Code connection (next bounded component)

- [x] Attach acknowledged build/schedule/compile/captureState/clearSchedule to
  the Synth Code client and render queue; preserve Run/Apply/Stop transactions.
- [x] Preserve software-envelope/DDA immediate methods. Scheduled register-only
  programs use setNote + keyOn/keyOff; reject noteOn/noteOff with guidance rather
  than silently changing their Synth semantics. Raw Wave RAM writes are outside
  this component; allow R6 only when virtual applied state has DDA enabled.
- [x] Current compilation reads applied Worklet state. Reset/snapshot paths do
  not request state; client compilation explicitly rejects the absent mirror.
- [x] Cover manual ownership, software-envelope edits, real processor rendering,
  declarations, examples and readable package graph without speaker output.

Synth connection verification: 746 HuC6280/package/runtime tests pass, including
8 actual Synth processor/Code runtime cases and strict declaration checks.
Readable ZIP tests require the new operation/compiler/client/processor/state
modules in the packaged graph. Chromium and WebKit source checks pass with
physical output muted; both exercise capture/compile, reservation playback,
atomic Apply replacement and Stop on the existing one-chip route. No listening,
release or npm publication was performed.

- Node log: `/private/tmp/huc-timed-code-tests-20261119.log`
- Muted browser receipt: `/private/tmp/huc-timed-code-browser-20261119.json`
- Example: `docs/synth-huc6280/cdrom2_examples.js` adds
  `/examples/huc6280-timed.js` to Files without replacing existing user examples.
- Browser regression expectations now follow existing accepted-author restoration
  on Stop and the named + Instrument dialog; product behavior was not changed
  to satisfy those formerly stale checks.

Remaining: user listening, Playground Main/Worker, npm/common type exposure and
Native capability reporting. Synth client compilation intentionally rejects the
incomplete local mirror. Bulk Wave RAM transfer/software DDA feeder scheduling
and Software Envelope note aliases are excluded with explicit diagnostics.

## Playground Main / Worker connection

- [x] Attach the shared timed client to primary and independent HuC6280 clients.
  Reuse existing entry/loop transactions and sender timestamps in Main/Worker.
- [x] Add Worklet applied-state capture and compact operation dispatch. Clock
  changes affect conversion/oscillator rate, never output scheduling time.
- [x] Enable current/client/reset/snapshot compilation; client means the existing
  local authoring shadow, not current audio state. Reject raw Wave RAM transfers
  until playback-pointer provenance is available; preserve ordinary immediate APIs.
- [x] Update common Playground declarations/completion and an editable example.
  Native must explicitly reject authoritative capture/scheduling, without losing
  local build/compile facilities. No npm publication in this component.
- [x] Verify real WASM timing/order at 44.1/48 kHz, Worker ownership/context,
  atomic Apply, cancellation, manual interleaving and muted browser playback.

Main/Worker verification (2026-11-19): actual HuC6280 WASM/Worklet tests cover
primary and independent clients, applied/client/reset/reused snapshot baselines,
44.1/48 kHz order/trace agreement, clock changes, live partial updates, DDA mode
changes after admission, invalid replacement, Stop, production Main/Worker
transaction ownership, and explicit Native capability rejection. Existing
immediate methods retain their behavior; noteOff is now a raw keyOff alias in
the shared chip class (matching the recorder's already listed operation).
`npm run test:huc6280-timed` includes declaration/source-navigation/example checks.

- Editable example: `docs/playground/examples/pc-engine/pce-timed-registers.js`
  (PC Engine and PC Engine CD mode catalogues).
- Product regression log: `/private/tmp/huc-playground-timed-tests-20261119.log`
  (845 passed before adding the served-mirror check).
- Muted Chromium/WebKit endpoint receipt:
  `huc6280_timed_playground_browser_20261119.json` (Main/Worker × 44.1/48 kHz).
- Fresh muted level measurements: `huc6280_timed_playground_levels_20261119.json`;
  all six HuC6280 primary/extra × 220/440/880 Hz peaks match the original report.
  Gains, mixer policy, native core and WASM were not changed.

## Required follow-up before packaging Playground

- [ ] Refresh calibration evidence and fix the existing historical dependency
  chain before recommending a new Playground distribution ZIP. This is separate
  from the now-working API connection; do not weaken the freshness guard.
- Current generator rejects changed `docs/js/huc6280synth.js`; current historical
  calibration tests also reject updated runtime dependencies such as
  playground_performance_sender.js. API/source tests do not grant calibration
  freshness approval. The three calibration regression files used by the HuC6280
  workflow currently fail; log:
  `/private/tmp/huc-playground-calibration-regressions-20261119.log`.
- An isolated HEAD-only read of the pre-task YM2608 measured-policy context also
  fails on its pinned dependency
  `scripts/mixer_calibration_scsp_output_level_new_cassette_revision.test.mjs`.
  This predates the present API edits. Preserve old reports and test-only
  historical fixtures; do not promote their FM application substitutions into
  production freshness approval. A proposed normalization was discarded.
- No release, tag, push or npm publication was performed.
