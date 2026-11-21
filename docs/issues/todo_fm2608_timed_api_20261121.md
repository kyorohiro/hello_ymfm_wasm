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

- [x] Standalone FM/SSG monitor mutes and Stop-level restoration now apply to
      reserved writes on the audio thread; the demo no longer needs a preset
      rebuild workaround. See the follow-up verification below.
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

## Completed follow-up — timed Mixer / Stop (2026-11-21)

- [x] Make the standalone audio thread the authority for FM TL / SSG level
      monitoring, retaining authored levels separately from software mute/Stop.
- [x] Apply the same monitor to immediate, timed and inspector writes; restore
      current authored FM levels at the next Key On on the audio clock.
- [x] Delegate FM/SSG UI mutes without replaying stale Main-thread levels;
      preserve Rhythm/ADPCM filtering and the existing ADPCM release guard.
- [x] Verify muted edits, unmute, Stop/Run, replacement ownership, both FM ports,
      SSG retained levels, source gains and default PCM parity at 44.1/48 kHz.
- [x] Check the real Code/Mixer flow in physically muted browsers and retain
      exact calibration review rather than changing historical gain reports.


Verification: 35 targeted monitor/timed/review checks, 220 OPNA tests and
28 calibration-chain checks passed. The npm build generated/checked 472 types.
Real WASM tests cover both FM banks, retained SSG levels, 44.1/48 kHz Gate-frame
restoration and exact default mixed FM/SSG/ADPCM PCM parity (4096 stereo frames).
Source and readable ZIP passed Chromium/WebKit with physical output muted;
FM/SSG muted peaks were zero and unmute / Key On-only Run used the latest levels.
`captureState()` remains a physical register snapshot; authored monitor levels
are private and no continuous UI synchronization was introduced.
[Evidence](verification_fm2608_timed_monitor_20261121.json).

## Completed follow-up — timed Rhythm (2026-11-21)

- [x] Record `rhythm.setVolume / setVoice / keyOn / keyOff` in the shared
      FM/SSG operation timeline; reuse the immediate register conversion.
- [x] Preserve packed per-voice pan/level fields, repeated R10 triggers and
      simultaneous masks. ROM uploads/reset and ADPCM remain outside recording.
- [x] Preserve per-drum ownership on replacement, cancellation and Stop,
      including stale multi-drum Offs after a newer manual/replacement Gate.
- [x] Integrate Rhythm with the standalone audio-thread monitor so mute does
      not lose authored pan/level; keep snapshots' register bytes physical.
- [x] Add types/completion, a fresh-Cassette example, real-ROM/WASM 44.1/48 kHz
      timing/parity tests and physically muted browser / readable ZIP checks.

Verification: 46 targeted real-WASM/monitor checks, 220 OPNA tests, 70 shared
processor/inspector/calibration checks and 102 YM2612 timed regressions passed.
The npm build generated and checked 472 declarations. Source and readable ZIP
passed physically muted Chromium/WebKit checks. Native execution, ADPCM timed
operations and scheduled-state Live UI remain separate; human listening is pending.
Fresh Cassettes include `examples/timed-rhythm.js`; restored user Cassettes are
not modified. [Evidence](verification_fm2608_rhythm_timed_20261121.json).
