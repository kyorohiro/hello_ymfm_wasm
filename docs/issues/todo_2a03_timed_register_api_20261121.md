# NES/FDS timed operation API

Authorized 2026-11-21 after the persistent Code workspace port.

## First slice: Pulse / Triangle / Noise

- [x] Lightweight serializable recorder, shared immediate converter, isolated compile.
- [x] Current/client/reset/reused immutable snapshots; explicitly reject incomplete client shadows.
- [x] Audio-clock queue, bounded repeats, named atomic replacement, cancellation and Code Run/Apply/Stop ownership.
- [x] Preserve $4015 companion bits and same-value length/envelope trigger writes. Reject DMC/FDS/memory/frame-counter operations outside this slice.
- [x] Shared Web Audio Main/Worker and borrowed standalone Code connection, types and example.
- [x] Actual WASM 44.1/48 kHz timing/PCM, manual-interleaving/failed Apply and muted readable-ZIP browser verification.

DMC playback, DPCM memory uploads, FDS wave/modulation RAM and Native scheduling are separate follow-ups. Raw hardware gates and existing immediate APIs retain their behavior. No npm publication or Tauri update is requested.

## Follow-up slices

- [x] DMC playback controls for previously loaded DPCM, with a detached selection
      descriptor and active/ended playback distinction; memory transfer remains
      outside recording and cannot restart another channel's sample implicitly.
- [ ] FDS register operations and partial halt/frequency/volume updates; scope
      wave/modulation RAM batches and phase/cursor side effects explicitly.
- [ ] Rate-limited visible-panel scheduled-state UI, separately from scheduling.
- [ ] Native authoritative capture/execution (currently explicitly rejected).

Verification: 290 NES tests include 15 actual-WASM/client/timing/parity tests
and 2 exact revision checks. Shared processor/sender/calibration tests: 81 pass.
The npm build copies 414 modules and checks 477 declarations. Source and readable
ZIP pass physically muted Chromium/WebKit with actual Monaco and fallback;
failed Apply retains the previous pattern. Immediate manual PCM matches the
exact pre-change source at 44.1/48 kHz (4096 stereo frames, maximum difference 0).
Human listening is pending. No npm/Tauri/publication/remote CI/commit was run.
[Evidence](verification_2a03_timed_api_20261121.json).

## Completed follow-up — prepared DMC playback

- [x] Record existing `dmc.play({rate,loop,level})` and `dmc.stop()`; allow DMC Off and raw rate/DAC writes without recording memory transfers.
- [x] Retain detached selected `{address,length}` metadata separately from active/ended playback and physical register bytes; reject play with no prepared selection.
- [x] Publish selection after acknowledged Web Audio sample uploads; keep Native immediate APIs unchanged and handle stale/reset/raw uploads explicitly.
- [x] Resolve sample selection at admission/execution; preserve repeated disable/config/enable writes and companion channel enables.
- [x] Extend per-channel ownership through DMC retrigger, stale Off/cancel, manual audition and Run/Apply/Stop; retain standalone software click guard and raw generic Worklet behavior.
- [x] Add types/completion and a transfer-outside-build example; verify actual DPCM, 44.1/48 kHz timing/PCM, failure atomicity and muted source/readable ZIP browsers.

DMC verification: 307 NES tests (including 30 timed tests and four exact revision
checks), 83 shared processor/sender/calibration checks, 414-module / 477-declaration
build. Source and readable ZIP pass physically muted Chromium/WebKit with fallback
and real Monaco. Existing immediate manual DMC PCM matches the exact predecessor
at 44.1/48 kHz (4096 stereo frames, maximum difference 0).
Compilation does not simulate elapsed DMC one-shot counters; snapshots retain
selection metadata, not RAM bytes. Human listening remains pending.
[Evidence](verification_2a03_dmc_timed_20261121.json).

## Completed FDS control slice

- [x] Record FDS pitch, fixed volume and gates with existing conversion; raw envelope/modulation controls, excluding Wave RAM and modulation-table writes.
- [x] Preserve FDS capability checks, partial timer updates, configured gain and Gate ownership.
- [x] Verify compile/schedule parity and actual WASM at 44.1/48 kHz; types, example and readable ZIP.

FDS controls are implemented in shared Web Audio Main/Worker and standalone
Code; Wave RAM and modulation-table transfers, Native execution and Live UI
remain follow-ups. Fresh Cassettes include `examples/timed-fds.js`.
[Verification](verification_2a03_fds_timed_20261121.json).

FDS verification: 316 NES regressions and 85 shared/calibration tests pass.
Actual WASM compile/write/frame parity is checked at 44.1/48 kHz on both
shared and standalone endpoints. Readable ZIP passes physically muted
Chromium/WebKit performance and real Monaco checks; build checks 477
declarations across 414 modules. Human listening remains pending.

## Completed FDS table transfer slice

- [x] Record full setWave/setModulation tables as detached bounded data; reuse immediate conversion.
- [x] Execute each upload without rendering/interleaving inside its register batch; retain Gate ownership and stop/restore order.
- [x] Verify compile parity, RAM/table effects, malformed replacement rejection, types and muted ZIP browsers.

FDS full-table recording/execution is implemented. The existing timed-fds
example now switches a self-authored sine to saw mid-note. Raw RAM-port
edits remain excluded, as do DMC memory transfer and Native scheduling.
[Verification](verification_2a03_fds_tables_20261121.json).

Table-transfer verification: 323 NES tests and 87 common/calibration checks pass.
The actual WASM tests cover both shared and standalone endpoints at 44.1/48 kHz,
ordered full-table writes, applied Wave RAM and modulation frequency, retained
Gate ownership and rejected replacement retaining the previous repeat.
Generated build: 414 modules / 477 declarations. Human listening is pending.
