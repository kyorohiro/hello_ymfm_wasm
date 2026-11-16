# YM2149 timed operation API — implementation verification

Implementation date: 2026-11-16. Scope: browser AY / YM2149 on the existing chip
and AudioWorklet, plus local client / reset inspection on supported Native AY
clients. No sound-core / WASM rebuild, npm publication or Tauri release.

## Behavior

- `build()` records cloneable timed method calls once without capturing live state.
- `compile()` is awaitable in all modes: authoritative `current`, local `client`,
  hardware `reset`, or a reusable read-only snapshot from `captureState()`.
- Shared AY conversion retains R7 partial fields, every R13 write and retained
  key-on levels. Immediate browser register batches include matching metadata.
- Named reservations use the existing Performance Queue and sample boundaries;
  repeating patterns store one upcoming event, not an expanded infinite stream.
- Entry changes stage until successful Apply, with atomic per-chip manifest
  replacement. Failed Apply retains previous work. Loop removal / errors cancel
  future work and release only owned scheduled Gates; global Stop preserves
  its existing output-fade ordering and newer manual notes.
- Runtime conversion failure stops its pattern and reports a nonfatal diagnostic;
  unrelated patterns, capture and ordinary note controls remain usable.
- Main / Worker and Synth Code use existing lifecycle contexts. Reservation
  mutations in detached callbacks without an identifiable entry / loop owner
  reject explicitly. `console.table()` displays bounded readable trace rows.

## Verification

Final source / mirror checks completed so far:

- `npm run test:ym2149-timed`: 89 passing tests, including recorder / compiler,
  real AY WASM / Worklet, Native inspection / rejection, lifecycle, types and
  navigation cases.
- Expanded selected queue / processor / sender / inspector group: 179 tests pass.
- Shared Code runtime, Synth audio / declarations and production Main / Worker /
  Native / SID regressions: 386 tests pass. These groups overlap; their counts
  must not be added as a unique-test total.
- `node --test scripts/package_itch_ym2149_st_synth.test.mjs`: all 3 tests pass,
  including a readable standalone ZIP, complete imports and authenticated sources.
- `node scripts/sync_runtime_artifacts.mjs --check`: 33 SDK builds, 68 outputs
  and 75 mirrors verified. DSP / WASM outputs and measured gains are unchanged.
- `npm run test:ym2149-timed:browser`: Chromium and WebKit pass with the real
  editor, Code UI and Worklet. Pre-mute RMS is about 0.024; after Stop it is 0.
  Failed Apply preserves the previous pattern, successful omission / loop
  removal cancels future work, and audio frames advance throughout capture.
- Formatting, code fences and local documentation links pass checks.

The browser cleanup check waits for the cancellation acknowledgement before
writing a sentinel and observing that no later write overwrites it. Cancellation
does not restore old register values; a last scheduled write that applied before
the acknowledgement is valid under the actual-order contract.

Existing calibration evidence is retained through the independently pinned
[AY timed source revision](ay_timed_operations_source_revision_01.json), which
reconstructs exact reviewed predecessor sources and authenticates new helper
dependencies. The two mixer-default generation checks pass. The 5 new exact
reconstruction / legacy-trace / tamper tests pass, and the complete historical
suite passes 464/464 (`node --test scripts/*mixer_calibration*.test.mjs`).
Historical fixture readers reconstruct the reviewed predecessor before testing
unchanged old hash / receipt / tamper assertions; two archival receipt creators
accept an optional source reader with unchanged defaults. No report, gain or
WASM was rewritten to hide a freshness failure.

Browser report: [muted real-browser checks](verification_ym2149_timed_browser_20261116.json).
Every automated physical destination route is muted with Gain 0; PCM is measured
before that mute. No subjective listening or physical hardware test is claimed.

The one-operation browser timing sample measured `current` at about 0.7 ms in
Chromium and 5 ms in WebKit; `client` was below available timer resolution.
These are single-run observations, not a latency promise or an upper bound.

## Playground distribution check

The existing Playground packager was exercised with version
`ay-timed-guard-verify`. All 35 packaging / source-preservation tests pass and
the built module graph resolves all 1,255 references. All four AY modules, the
AY lifecycle adapter and the updated logger are present and byte-identical to
their served sources.

- Download ZIP: `release/hello_ymfm_wasm_ay-timed-guard-verify_itch_playground.zip`,
  38,184,665 bytes, SHA-256
  `4305d7db69954bd3deae159acec8a92bc83ff24bd87ecd957e2c54936daa543b`.
- Browser ZIP: `release/hello_ymfm_wasm_ay-timed-guard-verify_itch_playground_for_run.zip`,
  38,536,984 bytes, SHA-256
  `07152cadfcf0859e85118d1c75ad88437f828d016c5192a97e8d751ba8fb1f55`.

Adding runtime dependencies crossed itch.io's browser file-count limit. The
browser archive keeps exactly 1,000 files and no directory entries by moving
only `sources/CDDA.json`, `sources/MSM5205.json` and `sources/POKEY-SDK.json`
into its complete byte-verified `corresponding-source.zip`. All runtime /
application modules remain readable and no source is discarded. Further
module additions need a file-budget review.

## Limits

- AY / YM2149 first. New OPN scheduling / compilation helpers are not exposed;
  legacy YM2612 `scheduleWrites()` remains unchanged.
- Native timed execution / authoritative capture are explicitly unsupported.
  Offline render-clock adapters and Native scheduling require separate work.
- Admission limits: 4,096 operations per pattern, 128 active patterns, 48,000
  aggregate repeated operations per second and the 65,536-command storage budget.
  These are bounds, not a maximum sustainable rate guarantee for every device.
- Direct scheduling lead is 128 output frames. Worker lead is applied once;
  staged entry reservations anchor when committed. No explicit-start option.
- Timing is host output-sample precision, not exact Atari ST CPU / MFP cycles.
  The README's periodic R13 example is a prototype, not a hardware-equivalence
  claim for every Sync-buzzer / digidrum technique.
- Client state may lag or precede rendering. Complete local state is required;
  no automatic readback, reset substitution or new constant synchronization.
- Compilation predicts writes for its selected baseline; it does not record
  manual operations that may interleave during live execution.

See the [design](design_ym2149_timed_writes_api_20261116.md),
[TODO](todo_ym2149_st_synth_20261116.md) and
[runnable example](../synth-ym2149-st/README.md#timed-register-operations).
