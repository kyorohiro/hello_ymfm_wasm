# Restart handoff — YM2149 timed operations, 2026-11-16

This is the current entry point for resuming this conversation. The user is
restarting the computer; this handoff records completed work and the proposed
next task. No new runtime work was started while preparing it.

## Checkpoint

- Repository: `/Users/kyorohiro/development8/wfm/hello_ymfm`, branch `main`.
- Implementation commit: `2e67ed9294eee111cc00083d8307c4e10d4b6b0d`,
  `feat(ym2149): add timed operation recording, scheduling, and compilation`.
- The working tree was clean before these handoff / TODO edits. The implementation
  is already committed; these new documentation edits are separate.
- Remote push / Actions status has not been checked for this checkpoint. Do not
  infer publication from the commit. No npm publication, new tag or Tauri release
  was performed for this work.

## Completed scope

Browser AY / YM2149 now exposes:

- `build(callback, { referenceSampleRate })`: records serializable operations;
  runs the callback once, without copying or changing live chip state.
- `schedule(operations, { name, repeatSeconds })` and `clearSchedule(name)`:
  compact named patterns on the existing AudioWorklet Performance Queue.
  Partial updates resolve against actual state at each occurrence.
- Awaitable `compile(operations, { initialState })`: concrete register writes
  from `"current"` (default), `"client"`, `"reset"`, or a captured snapshot.
- `captureState()`: detached, read-only registers and semantic metadata needed
  for operation resolution. It is not a full emulator save state. Existing
  `getState()` is unchanged. Snapshot reuse requires a compatible configuration
  and the same underlying chip instance.

Shared conversion preserves R7 partial fields, repeated R13 writes and operation
order. Main / Worker / Synth Code lifecycle is connected: successful Apply commits
entry reservations atomically; failed Apply preserves previous reservations;
loop removal and Stop clean up their work. Existing immediate APIs and YM2612
`scheduleWrites()` retain their behavior.

Primary references:

- [Runnable Code example and API behavior](../synth-ym2149-st/README.md#timed-register-operations).
- [Design](design_ym2149_timed_writes_api_20261116.md).
- [TODO](todo_ym2149_st_synth_20261116.md).
- [Verification and exact distribution artifacts](verification_ym2149_timed_api_20261116.md).
- [Muted Chromium / WebKit report](verification_ym2149_timed_browser_20261116.json).

## Verification already completed

- `npm run test:ym2149-timed`: 89 passing tests.
- `npm run test:ym2149-timed:browser`: real Chromium and WebKit passed, using
  Code / editor / Worklet with physical destination routes muted. Audio frames
  continued during state capture. This is not subjective listening evidence.
- Related selected runtime regressions passed (179-test and 386-test groups;
  they overlap and must not be added as a unique total).
- Historical calibration guards passed 464/464. Mixer default generation checks
  passed; this implementation did not change measured gains or rebuild WASM.
- SDK / source mirrors, standalone packaging and Playground module closure / ZIP
  checks passed. See verification notes for exact commands, hashes and counts.

Do not repeat the full suite merely because the computer restarted. Re-run the
checks relevant to any subsequent edits. Old local servers, browser tabs, test
processes, temporary files and ports must not be assumed to have survived.

## Important boundaries

- `"client"` uses existing local state without communication. It may precede or
  lag rendered state; incomplete metadata is rejected rather than guessed.
- `compile()` predicts writes for one baseline. It does not record other manual
  operations that interleave during actual playback, and does not pause audio.
- Cancellation removes future occurrences; it does not restore old registers.
- Timing is output-sample precision, not original Atari ST CPU / MFP cycle accuracy.
  The current periodic R13 example is a prototype, not proof of all ST techniques.
- Native supports valid local / reset inspection only. Native authoritative
  capture / timed execution and new OPN compilation / scheduling remain TODOs.
- No new continuous state synchronization, PCM transfer, DSP abstraction,
  Looper / Event Rec or complete Atari ST machine was added.

## Next task discussed, not started

The latest recommendation was to use the API for concrete YM2149 sound-making
examples before expanding it to other chips:

1. Extend the existing periodic Envelope retrigger example (Sync-buzzer): vary
   melody and retrigger motion independently; inspect R13 writes with `compile()`
   and compare sound / Waveform / Spectrum.
2. Add a timed volume-modulation example.
3. Explore sample playback through volume writes, with explicit timing / rate
   limits and hardware-versus-host-software explanations.

These are proposed follow-ups, not completed features. The user asked only to
record a restart checkpoint in the last turn. Resume implementation when the user
asks to continue. Leave the current default `index.js` and UI unchanged meanwhile.

## Editing and packaging cautions

- Runtime source is canonical under `tetorica_src/runtime/`, with served mirrors
  in `docs/js/`. Core new files are `ay8910_operations.js`,
  `ay8910_timed_state.js`, `ay8910_timed_client.js`, `ay8910_timed_processor.js`
  and `playground_ay_timed_lifecycle.js`.
- Source freshness is authenticated by
  [the AY timed source revision](ay_timed_operations_source_revision_01.json).
  Future runtime edits require the normal provenance / calibration review;
  do not rewrite old reports or weaken guards to hide a mismatch.
- The full web sync script also refreshes unrelated URL cache aliases. Review its
  diff before accepting those changes; the committed runtime / mirrors were
  already verified at this checkpoint.
- The Playground browser ZIP is exactly at itch.io's 1,000-file limit. Three build
  metadata JSON files are retained inside the complete `corresponding-source.zip`
  rather than as duplicate browser files. Runtime / application JS remains
  readable. Additional modules need a file-budget check; do not drop sources.
- Re-check `git status` after restart and preserve user / concurrent Codex edits.
  No cleanup, reset, automatic publish or unrelated repo changes are needed.
