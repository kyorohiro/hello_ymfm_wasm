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

- [x] Refresh calibration evidence and fix the existing historical dependency
  chain before recommending a new Playground distribution ZIP. This is separate
  from the now-working API connection; do not weaken the freshness guard.
- Prior failure (resolved by the new evidence below): the generator rejected changed `docs/js/huc6280synth.js`; current historical
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

## Calibration / CI repair

- [x] Produce new complete current-source PS1/WonderSwan/POKEY/SCSP baseline and
  verification reports, preserving all old reports and strict source checks.
- [x] Switch production generators to the new reports; verify rounded gains and
  listening policy, and keep their intended values unchanged.
- [x] Isolate old calibration regression tests using pinned test-only source
  snapshots; never use those substitutes to approve current production sources.
- [x] Run historical guard tests, generators and packaging checks. Record any
  remaining limitation explicitly; do not skip failing CI steps.

### Current-source evidence and local packaging (2026-11-19)

- New baseline / verification pairs: `ps1_huc_timed_chip_levels_01.json`,
  `wonderswan_huc_timed_chip_levels_01.json`,
  `pokey_huc_timed_chip_levels_01.json`, `scsp_huc_timed_chip_levels_01.json`
  and each matching `_verify_01.json`. All eight reports passed. Original
  historical reports and production freshness guards are unchanged.
- Complete Chromium/WebKit × Main/Worker × 44.1/48 kHz coverage, three
  pitches and primary/extra routes. Each non-POKEY report has 48 chip captures
  and eight FM anchors; POKEY has 96 captures, eight FM anchors, eight PSG
  anchors and eight dual-chip checks. Every physical destination stays muted;
  no listening was performed. PS1/WonderSwan verification was rerun completely
  after page-initialization timeouts under parallel browser load.
- Both mixer generators now use the new reports and pass `--check`. Target
  amplitude and listening factors remain unchanged; the independently measured
  rounded POKEY gain is 0.413033 (previously 0.413034), SCSP is 0.128826
  (previously 0.128825). The POKEY reference RMS has the corresponding small
  measurement variation. No native core or WASM change.
- Historical regression inputs are explicitly pinned in
  `test/fixtures/pre-huc-timed-calibration-inputs.json`, validated against their
  actual Git commits. Test-only detached module graphs exercise the real guard
  implementations with archived inputs. Raw post-source-mix and older reviewed
  inputs are distinct. This does not install global hooks, change live reads,
  or authorize current production sources with old reports.
- Playground packaging now includes all four HuC6280 timed-operation modules.
  Synced the SID source-kit processor copy with its canonical source.
- Browser packaging verifies 12 additional exact license duplicates and keeps
  their readable copies in `licenses/`; every original source-kit path and
  byte remains in `sources/corresponding-source.zip` and in the full download.
  The strict 1,000-entry limit is unchanged. The browser ZIP has 998 entries;
  the expanded-source download has 1,530. Both local ZIPs were generated.
- Local package version used only for verification:
  `huc-timed-calibration-verified-final2-20261119`; artifacts are in `release/`.
- HuC6280 Synth unit tests: 746 passed. Timed API tests: 89 passed.
  Archive integrity + browser packaging tests: 12 passed. Muted endpoint
  checks: all eight routes passed; receipt
  `huc6280_timed_calibration_endpoints_20261119.json`.
- Complete calibration regression run: 601 tests, 600 passed and one SID
  historical-reader failure. After isolating that remaining historical read,
  all seven SID tests passed on rerun. No production guard or assertion was
  relaxed for that fix. Logs:
  `/private/tmp/huc-calibration-all-regressions-complete.log`,
  `/private/tmp/huc-calibration-sid-final.log`. No other failing case remains.
- CI now checks archive integrity, new current-source reports and both
  generated policies in addition to the existing HuC6280 checks.
- No commit, push, release/tag or npm publication was performed.

- Both the canonical endpoint and actual packaged browser-stage JS passed all
  eight muted endpoint cases. Packaged receipt:
  `huc6280_timed_packaged_endpoints_20261119.json`. The temporary checker only
  substituted the import prefix `/tetorica_src/runtime/` → `/js/` and set the
  browser stage as the HTTP root; assertions, WASM and mute behavior were
  unchanged.
- HuC6280 Synth ZIP also generated successfully:
  `release/tetorica_huc6280_synth_calibration-verified-20261119_itch.zip`.
- Generator + archive-integrity tests: 36 passed.

- Final `git diff --check`, both generator `--check` commands and the actual
  browser ZIP entry/size validator passed. No remote Actions result is claimed;
  the workflow changes still need commit/push to run on GitHub.

## Follow-up: Linux Actions failures after push (2026-11-19)

- [x] ASWAN: replace macOS-only `/private/tmp` test scratch path with OS tmpdir.
- [x] SCSP: isolate the real-WASM historical DSP UI parity recorder's guard
  dependencies using the same test-only archived input graph.
- [x] HuC6280: reconcile the browser WAV-conversion keyboard expectation with
  the current empty-DDA behavior, then rerun the full packaged browser check.
- Failed runs on commit `15acfdc255ef1aafa802fda118ddb864288b7a36`:
  ASWAN `44530114446`, SCSP `44530114127`, HuC6280 `44530114489`.

### Actions repair verification

- ASWAN: OS-provided `tmpdir()` replaces the macOS-only scratch prefix. Both
  historical guards pass (8 tests); malformed receipt rejection is retained.
- SCSP: all nine real-WASM historical parity test files use the archived guard
  graph. Their original test bodies were added with actual Git provenance to
  the independently pinned test-only archive. Parity + archive tests: 20 passed.
- SCSP workflow retains every original `--check` assertion, now through a
  test-only CLI that rejects `--write` and escaping paths. All 14 historical
  receipt commands were verified (13 passed in the full sequence; the final
  navigation command passed after giving it the same AY-era reader already
  used by its unit test). Cycle2 Examples uses its exact Synth Cycle2 checkpoint
  reader; this keeps later measured gain-policy changes outside that old proof.
  No production guard, historical report, or recorder implementation changed.
- HuC6280 real defect: accepting a source before opening audio updated keyboard
  availability before updating `playbackPreset`. Refresh keys after accepting
  it as well. Empty DDA now disables keys immediately, Wave restores them,
  manual drafts remain passive. Added an offline regression. Product tests:
  747 passed; keyboard dispatch tests: 40 passed.
- HuC6280 browser import test now allows exactly the six newly imported
  `workingDelta.savedTextPaths` entries in its recovery manifest. Every earlier
  user file remains byte-identical; every other manifest field remains exact.
  Full packaged Chromium/WebKit browser check passed with physical output muted.
- Additional VGM workflow failure `44530114029`: SDK build test expected-export
  list omitted the existing `_ym2608_set_source_gains` export. Updated only the
  list, leaving exact matching in place. All 113 SDK build tests passed.
- Local HuC6280 and SCSP ZIP packaging passed. Both current mixer-policy
  generators still pass strict `--check`; no new measurement waiver was added.
- Relevant logs: `/private/tmp/actions-aswan-guards-final.log`,
  `/private/tmp/actions-scsp-all-parities-final3.log`,
  `/private/tmp/actions-scsp-historical-receipts-final.log`,
  `/private/tmp/actions-scsp-navigation-receipt.log`,
  `/private/tmp/actions-huc-browser.json`,
  `/private/tmp/actions-sdk-build-tests.log`.
- Repairs are local, not committed/pushed. Completed old failing runs cannot
  validate these new edits; a new push is required. Other old runs were still
  running at the last remote check.
