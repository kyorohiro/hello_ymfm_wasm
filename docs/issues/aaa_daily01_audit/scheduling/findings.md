# Scheduling / Main–Worker transport audit

Production files were read only. `probe.mjs` instruments a separate VM copy of actual source; chip DSP is stubbed. `operation-counts.json` contains deterministic counts rather than wall-clock/audio deadline measurements. Array subclass counters report semantic element operations; they do **not** measure engine heap bytes, actual memcpy bytes, GC or scheduling latency. Clock ticks are virtual 10 ms, render blocks are 128 frames at 48 kHz, Main explicit schedule lead is 250 ms, Worker performance lead is 500 ms.

## Normal single-voice workload

36 note gates of 0.8 seconds followed by 20/20/40 ms rests, total 29.76 seconds; preset/setup excluded from steady-state counts. Actual `createWorkerChip` → `createPerformanceSender` → `createPerformanceQueue`:

- 72 Worker → Worklet messages, 144 register writes (3 on + 1 off per note).
- 72 observer notifications for Main state/recording, 2,412 JSON character equivalents; 13,487 JSON character equivalents for chip envelopes. These are **serialization size proxies**, not browser structured-clone wire bytes.
- Peak pending: 4 commands in 2 batches. Final queue is empty after draining the 500 ms lead. The ideal-clock simulator applies at exact frame times; its late=0 is not evidence of actual browser timing quality.
- Main observer replay temporarily installs a no-op transport (`web/playground_runtime.js:1649–1664`), so it does not write audio commands a second time.
- Main `play` does not use the explicit write scheduler. The latter is only reached through `scheduleWritesSamples`/DAC helpers/MIDI scheduled batches. No recommendation to change ordinary voice scheduling based on these small counts.

## Candidate A: empty scheduled tracks repeat queue copying and sorting

Target `web/playground_audio_scheduler.js:47–50`, called by `web/playground_runtime.js:2359–2371`.

`enqueue([])` executes `pending.concat([])`, sorts the entire existing pending song and flushes. The actual exporter emits empty CH callbacks: an 8 kHz/10 s DAC-only VGM produces one nonempty global track and six empty CH tracks. With explicit raw DAC export, 80,000 events trigger 559,987 comparisons and 559,994 semantic concat-result elements, versus 79,999 comparisons and 80,000 concat-result elements for the single nonempty batch.

Potential improvement: skip the concat/sort for empty entries, **still calling `flush()`**, while preserving sample-clock initialization and validation behavior. This is an internal no-op fast path; do not remove empty liveLoop definitions or modify user-visible channel management. Benefit is strongest at startup for large explicit raw DAC scripts; ordinary note loops do not enter this path. Priority P2, low implementation risk when flush is preserved.

Risk: low when flush is preserved. `enqueue([])` currently doubles as a flush at current time; direct callers could rely on it. The benchmark fast path preserves this behavior and timer operations. Tests must preserve invalid-argument behavior, equal-time event order, Stop clear and timing updates.

## Candidate B: front removal work on large pending songs

Target `web/playground_audio_scheduler.js:20–27`. Every nonempty horizon flush uses `pending.splice(0,count)`. The source semantics shift the remaining song tail each time. Actual source simulated on the provided Popful Mail file (26.05 s including 250 ms lead; FM/PSG subset only, RF5C164 outside this exporter): 3,698 events, 846 dispatches, 1,525,741 semantic tail shifts. The same synthetic 8 kHz/10 s explicit raw DAC produces 1,001 dispatches and 40,039,000 semantic tail shifts.

Potential improvement: a head index with occasional compaction, and only sort/merge pending active events when new work arrives. Preserve stable ordering at equal times. The uninstrumented benchmark below demonstrates reduced elapsed processing time for raw inputs, but normal music workload benefit remains small. Priority P3 for large explicit raw inputs, below measured broad-path improvements.

Risk: medium. Out-of-order future batches, concurrent channel tracks, clock/timing changes and reentrant send callbacks must keep current semantics. The temp benchmark variants cover only observed order/identity, not full API conformance.

## Worklet compaction is bounded by the lookahead window in tested normal flow

Target `web/ym2612-worklet.js:277–291`. New scheduled batches with a consumed head cause `slice(head)`. Popful Mail subset: peak pending 202, 570 compactions, 22,208 semantic slice-result elements over 26.05 s. Explicit raw 8 kHz/10 s: peak 2,001 events, 976 compactions, 1,866,118 elements. This can be improved with a threshold only if out-of-order sort handling stays valid, but the observed normal subset is small; no independent high-priority recommendation from counts alone.

Default DAC export does **not** use this raw object stream: it generates a preloaded DAC bank plus one stream start. Synthetic default export produces 0 scheduled DAC entries and 1 DAC stream. The counts harness omits DAC bank audio generation and is not a processing-time comparison between default and raw playback. Do not portray the 80,000-event raw case as the default user path.

## Uninstrumented scheduler timings

`timings.json`: Node 26.12.0, actual unmodified scheduler source versus separate VM probe-only variants. Each condition has 5 warmups and 20 alternating-order runs; virtual 10 ms ticks, no GC forcing, no actual AudioContext/PCM/WASM/structured clone. All emitted events preserve the exact input object identity and stable chronological order for these inputs. These are **elapsed times to advance the virtual clock and process all events in Node**, measured with `process.hrtime.bigint()`, not process CPU time or playback duration. They can include preemption and GC. Per-callback `hrtime` overhead and sink arrays remain in all conditions; sub-microsecond values approach measurement noise. Max values alone do not identify their cause.

| Input | Original total median / mean | Empty concat/sort fast path (flush retained) median / mean | Fast path + head index median / mean |
|---|---:|---:|---:|
| Popful Mail FM/PSG, 3,698 events / 26.05 virtual seconds | 0.875 / 1.228 ms | 0.943 / 1.412 ms | 0.723 / 1.245 ms |
| Raw DAC, 80,000 events + 6 empty tracks / 10.25 virtual seconds | 14.332 / 15.581 ms | 6.944 / 7.182 ms | 1.419 / 1.530 ms |
| Raw DAC, 80,000 events in one batch / 10.25 virtual seconds | 7.060 / 7.641 ms | 7.088 / 10.419 ms | 1.411 / 1.453 ms |

For raw + empty tracks, original flush: mean 6.423 µs, p99 13.625 µs, max 3,718.917 µs. Head-index variant: mean 0.229 µs, p99 0.917 µs, max 255.083 µs. These callbacks execute on Main in this path. Original real-music flush: mean 0.167 µs, p99 0.541 µs, max 973.375 µs; median whole-song savings are only ~0.15 ms, with no average improvement. No basis to recommend a normal-workload scheduler rewrite as high priority.

There is an apparent 10.419 ms mean for the single-batch empty-fast-path variant although its median is unchanged at ~7.1 ms. This condition has **no empty entries**, so it should not improve; the observed tail spread reinforces that maximum/mean variability should not be attributed to the code branch without more evidence.

## Queue / lifecycle nonfindings

- `web/playground_performance_queue.js:44–65`: binary heap rather than whole-array sorting for each timed batch, O(log B) insertion/pop for B batches.
- `cancelOwner` rebuilds heap on lifecycle changes (`:68–80`), not per audio frame. Canceled owners are remembered for the active session; Stop/new session clears them. No normal-workload quadratic queue growth found.
- Capacity guard 65,536 applies to **performance commands only**. The probe fills exactly 65,536 in one batch, rejects the next command, then cancels the owner and reaches 0 pending with 65,536 discarded. The ordinary peak 4 is far below this stress condition.
- Plain `schedule-writes` and Main pending schedule do not share that cap. Their bounds in ordinary export are song size plus the Main lookahead behavior; no claim of a universal queue limit.
- `createDeadlineScheduler` (`web/playground_clock.js:35–130`) shares one deadline timer, dispatching late continuations via MessageChannel. It closes the channel when empty. `pending.sort`/`shift` is proportional to concurrent outstanding waits, normally one per active loop, rather than DAC write count in explicit scheduling mode. No measured reason to rewrite it here.
- `createPerformanceHost.control` uses a five-second acknowledgment timeout at attachment/start only, not a steady polling timer. Sender port disposal may defer close by lead+50 ms; additional device cleanup checks 10 ms until its reserved performance time has rendered. These are lifecycle-triggered, not permanent per-note loops.
- Existing Run/Stop and mode-switch cleanup checks are reused by the root audit; no lifecycle stress or graph ownership changes were made in this subtask.

Reproduce from repository root:

```sh
node /path/to/probe.mjs --root=. --out=/tmp/scheduling-counts --vgm='/path/to/01 - Backup Creation.vgz'
node /path/to/benchmark.mjs --root=. --out=/tmp/scheduling-timing --vgm='/path/to/01 - Backup Creation.vgz'
```

`--vgm` is optional; synthetic inputs are generated in memory and contain no third-party song data. The report artifact contains only file hash/counts, not song events or audio.
