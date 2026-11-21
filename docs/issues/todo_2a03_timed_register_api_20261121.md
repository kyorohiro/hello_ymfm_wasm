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
