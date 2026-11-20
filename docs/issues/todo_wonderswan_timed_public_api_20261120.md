# WonderSwan timed public API rollout

Authorized 2026-11-20 while the user manually checks the ASWAN Synth.
Do not publish npm, change versions, push/tag, or import Tauri releases here.
Keep Synth noteOn/noteOff and software Envelope behavior unchanged during this rollout.

- [x] Add reusable runtime build/compile/snapshot/client modules for stereo
  volume/pan, frequency/note, Noise/Sweep and raw keyOn/keyOff. Keep Wave RAM,
  Voice PCM and Synth software notes outside the public recorder.
- [x] Add actual sample-clock Worklet execution using Performance Queue, coherent
  current capture, explicitly limited client snapshots, reset/reusable snapshots,
  execution-time shared R90 merging and repeated writes.
- [x] Preserve named replacement/cancel, Main/Worker, Run/Apply/Stop and per-loop
  ownership; a stale reservation release must not stop a newer keyboard/Gate.
- [x] Fence VGM timeline playback, reset, clock changes and stale ports; invalid
  reservations must leave current playback / valid reservations untouched.
- [x] Expose through primary and extra WonderSwan clients, shared browser/npm
  runtime and declarations. Native scheduling/capture must reject explicitly;
  local build/reset/client compilation stays available where state is complete.
- [x] Add editable Playground example, types and Main/Worker tests using real
  WASM at 44.1/48 kHz. Test parameter partial updates and gate cancellation.
- [x] Synchronize canonical runtime/served mirrors and verify a locally packed
  npm tarball, with no publication. Refresh provenance/calibration checks when
  changed shared inputs require it; do not weaken source validation.
- [x] Record muted browser endpoint/package verification and remaining limits.

## Implemented scope

The shared runtime provides `build`, `schedule`, `clearSchedule`, `compile` and
`captureState` on primary and extra WonderSwan clients. The public recorder
supports `setVolume`, `setPan`, `setFrequency`, `setNote`, `setNoise`, `setSweep`,
`keyOn` and `keyOff`. It reuses WonderSwanSynth register conversion and resolves
shared R90 partial updates against the actual state at execution.

`compile` defaults to authoritative Worklet state. `client`, `reset` and detached
same-instance/same-clock snapshots are also supported; incomplete client shadows
reject explicitly. Snapshots describe operation-resolution registers/RAM and
metadata, not oscillator/Sweep/LFSR playback state. R8E reset writes and raw Gate
writes are retained even when their values repeat.

Main and Worker use the same Performance Queue and acknowledged timed RPCs.
Run/Apply reservations stage atomically; failed Apply preserves existing ones.
Owner cancellation and replacement release only owned raw Gates, including held
one-shots, and never release a later manual/other-reservation Gate. Reset clears
patterns while preserving ordinary queued initialization and following writes.
Prepared VGM playback and clock transitions reject conflicting scheduling.

## Local verification

- `npm run test:wonderswan-timed`: **52 passed**, including production Worklet
  WASM, production Code Main/Worker lifecycle, 44.1/48 kHz, snapshots, partial
  writes, trace agreement, ownership and queued-reset regression.
- Final shared Performance Queue / WonderSwan / PS1 / HuC6280 regression batch:
  **171 passed** (`/tmp/ws-public-final-regressions.log`).
- Current policy, workflow baseline selection, source provenance and runtime
  Mixer regression batch: **129 passed** (`/tmp/ws-public-final-policy.log`).
- Existing ASWAN Synth suite: **226 passed**; this rollout does not edit the
  Synth's local runtime, software Envelope or release behavior.
- Muted Chromium/WebKit Main/Worker endpoints passed at both sample rates:
  **eight cases against a locally installed npm tarball**, as well as source.
  Physical outputs pass through permanent zero gain before routing/startup.
- Local npm candidate: **446 JSDoc declarations**, installed package/module/WASM
  checks and NodeNext/Bundler/browser type tests passed. Typed negative cases
  cover invalid methods, channels, asynchronous builders and snapshot mutation.
  A preexisting PS1 type-emission inference regression was repaired in the
  packaging helper without changing PS1 execution code.
- Editable example: `docs/playground/examples/wonderswan/ws-timed-registers.js`.
  It is included in the mode shortcuts and generated Files example catalog.
  Monaco declarations navigate to readable shared operation/client source.
- Source freshness requires new measured PS1/WonderSwan/POKEY/SCSP baselines.
  All **288 raw captures passed**, with immutable historical reports retained.
  All **288 independent policy verification captures also passed**: PS1 56,
  WonderSwan 56, POKEY 120 and SCSP 56, including Chromium/WebKit Main/Worker
  at 44.1/48 kHz and calibration anchors. Reports are
  `/tmp/ws-public-verify-{ps1,wonderswan,pokey,scsp}.json`; runner log is
  `/tmp/ws-public-verification-runs.log`. Policy generation, workflow baseline
  freshness and SID readable-source mirror checks pass.

PS1 and WonderSwan measured gains match the previous generated policy. POKEY
and SCSP generated values have only the small finite-window remeasurement
differences recorded in the new reports (not a new listening-balance policy).
No Synth-specific gain was edited.

The packed version remains **0.2.44** solely as a local candidate, not a new
registry publication. Tarball, install and muted browser evidence live under
`/tmp/ws-public-*`; no user release ZIP was replaced.

## Limits and follow-ups

- [ ] If desired, consolidate the Synth's hardware recorder onto the shared
  module after human testing; retain its software-envelope/owned-note layer.
- [ ] Separately measure high-rate reservation CPU/budget behavior before
  promising kHz hack workloads. Correct sample placement is not a throughput
  benchmark; the live resolver still copies authoring state for each operation.
- Native scheduling/authoritative capture are unsupported and reject explicitly.
  Native local build/reset/client compile is available only with complete state.
- Public recorded soft noteOn/noteOff, Wave RAM transfer and Voice PCM feeding
  remain out of scope. CH2 volume/pan reject Voice mode, where R89 is DAC data.
- No new synchronization of renderer state into the client shadow was added;
  `client` can lag scheduled/native changes. Use `current` or a captured snapshot
  for authoritative comparison. Manual UI and human listening remain separate.
- No commit, push, tag, npm publish, version bump, Tauri import or remote CI run.


## Later publication (2026-11-20)

The separate user-authorized publication task released **0.2.45**. The downloaded
registry archive matches the validated candidate exactly and `latest` is 0.2.45.
The earlier 0.2.44 candidate/no-publication statements describe the original
implementation slice. See [publication evidence](npm_wonderswan_timed_release_20261120.md).
