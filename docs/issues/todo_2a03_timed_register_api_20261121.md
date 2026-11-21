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

## Next slices (not implemented)

- [ ] DMC playback controls for previously loaded DPCM, with a detached selection
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
