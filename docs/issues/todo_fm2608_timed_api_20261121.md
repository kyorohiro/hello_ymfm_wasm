# YM2608 timed FM / SSG operations

- [x] Lightweight serializable recorder using the existing FM/SSG immediate
      methods; compile current/client/reset/reusable state without live writes.
- [x] Track both register banks, committed FM pitch/latches/key masks and SSG
      retained levels. Resolve partial register changes at application time.
- [x] Execute compact named reservations on the AudioWorklet sample clock,
      retaining existing Performance Queue ownership, atomic replacement,
      Run/Apply/Stop and cancellation. No JS timer-based audio execution.
- [x] Connect shared Main/Worker client and the borrowed FM2608 Synth client;
      provide types, completion and a runnable example.
- [x] Verify admission/ordering/state isolation, partial operators/mixer,
      repeated key/envelope writes, ownership and 44.1/48 kHz timing with native
      WASM and silent browser tests. Preserve existing OPNA regressions.

This slice targets FM and SSG. Rhythm, ADPCM memory transfers, Native timed
execution, timer/CSM authoring and nonstandard prescaler helpers are separate;
unsupported paths must fail explicitly. No npm publication or release requested.

## Follow-ups

- [ ] Extend standalone Synth per-channel monitor mutes and Stop-level restoration
      coherently to reserved writes. Until then use the included explicit patch
      setup; do not claim all UI software helpers are identical to chip APIs.
- [ ] Consider Rhythm / ADPCM register scheduling separately, retaining memory
      upload admission and decoder/ROM semantics; Native remains separate.
- [ ] Scheduled-state UI polling belongs to the shared visible-panel plan.

See [API usage and limits](../synth-fm2608/TIMED_API.md). Tests use real unchanged
WASM, not an audio-device recording. No npm/Tauri/release/commit/push performed.

## Verification — 2026-11-21

- 21 API / exact-review checks, 212 existing OPNA tests, 102 existing YM2612
  timed checks, 88 shared connection/definition checks and 24 prior calibration
  review checks passed. Type checking and npm package construction passed
  (409 modules; 472 generated and checked declarations). No publication.
- Three real-WASM processors at 44.1/48 kHz preserve authored order, repeated
  events, compile/playback parity, intervening edits, atomic replacement and
  cancellation. Default shared FM/SSG PCM matches authenticated predecessors
  exactly (4096 stereo frames compared, maximum difference zero).
- Source and readable ZIP passed Chromium/WebKit: four muted browser cases,
  including current/client/reset/reused snapshots, Run/Apply, failed-Apply
  rollback, Stop and the distributed example. Human listening is pending.
- The exact reversible review preserves historical calibration reports and
  rejects later source/dependency changes; calibration data/gains are unchanged.
- [Evidence](verification_fm2608_timed_api_20261121.json).
