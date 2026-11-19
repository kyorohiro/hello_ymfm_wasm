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
