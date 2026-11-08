# SID Player Worklet performance experiment

This repository-only tool compares the ordinary SID Player with diagnostic
observers. It uses local files from `ww/C64Music` and two original test programs.
It does not distribute music, firmware or recorded audio. Every physical output
is muted before playback. Listening remains a separate check.

## Reproduce the experiment

From the repository root:

```sh
node scripts/sid_worklet_perf_plan.mjs --check docs/issues/sid_worklet_perf_plan_02.json
node scripts/check_sid_worklet_performance.mjs --validate-only
node scripts/check_sid_worklet_performance.mjs --out release/sid-performance-new.json
```

The full plan has 80 runs and takes roughly ten minutes, depending on the
machine. WebKit and Chromium run sequentially, with one page and AudioContext at
a time. Keep other workloads stable. The tool records browser/OS/CPU identity,
load averages, source and input hashes, and saves a checkpoint after each case.
It does not upload files. Playwright's two browsers must already be installed.

Use `--engines webkit` to run only the WebKit subset, or `--limit 4` with a new
output file for a pilot. These remain partial experiments and cannot produce a
full-plan summary. Keep the plan's engine order when specifying both engines.

An existing output is never silently overwritten. To continue an interrupted
run, use exactly the same inputs, sources, selection and output:

```sh
node scripts/check_sid_worklet_performance.mjs --resume --out release/sid-performance-new.json
```

Completed cases, including failures, are retained. An unfinished case is recorded
as abandoned before its retry. Changing sources or input identity rejects
resume. Ctrl-C requests a stop after the current case. Preserve the old report
and use a new plan/output when intentionally changing the experiment.

## What the four conditions mean

| Mode | Producer | Ordinary Player display |
| --- | --- | --- |
| `ordinary` | Original processor bytes, without a per-block observer | Normal polling and visualization |
| `timed` | Original `process()` plus a wall-clock timer and fixed-size aggregates | Normal polling and visualization |
| `capture` | Same timer plus the earlier full-stereo PCM inspection loop | Normal polling and visualization |
| `quiet-ui` | Same timer and aggregates as `timed` | Main-thread 200 ms polling and animation callbacks suppressed for this experiment |

Instrumentation is added only to the checker's HTTP responses. Product modules,
WASM, DSP, gain and calibration values are unchanged. The ordinary mode serves
the original processor bytes. The quiet condition keeps the audio/analyser
graph: it tests suppression of display reads/drawing, rather than removal of
the entire analyser graph.

The instrumented conditions begin their window before playback starts. At
44,100 Hz, 345 warmup blocks are followed by 1,723 measured 128-frame blocks.
The measured producer interval is exactly frames 44,160 through 264,704,
exclusive at the end. Boundary snapshots compare producer position, cycle /
IRQ / NMI / play counters and target metadata. They do not compare full CPU
registers, RAM, SID registers, Envelope, phase or complete PCM.

Ordinary mode deliberately has no such Worklet observer. It waits approximately
one second and then five seconds on the main thread, recording actual RPC
bookend positions. It is an untimed progress control, with no per-block cost or
identical-PCM-window claim. Its absent timing metrics are not zero.

The capture mode scans warmup plus measurement: 264,704 frames. Its finite,
stereo, peak and squared-sum aggregates cover that whole interval; timing
histograms describe only the 220,544 measured frames. Other modes use sparse
independent analyser samples at boundaries, rather than recording PCM.

## Interpret the measurements

The timer surrounds the original producer `process()` call, including
`renderInto()` and its stereo copy. The capture mode's second span additionally
includes its PCM scan. Aggregate updates and boundary-state reads are outside
those spans. These are wall-clock spans, including possible OS descheduling;
they are not pure WASM execution or CPU utilization.

AudioWorklet may provide only `Date.now`. Its integer-millisecond observations
are coarse compared with the approximately 2.902 ms block duration at 44.1 kHz.
A recorded 3 ms span cannot establish an actual missed audio-device deadline.
The report distinguishes raw threshold counts from quantization-sensitive
counts, using an explicitly assumed 1 ms allowance. That allowance is not a
measured clock-error bound. Callback-start deltas also do not establish timer
resolution or device gaps. Audio `currentTime` and `currentFrame` measure
logical progress, not elapsed processing time.

Histogram intervals describe observed timer deltas. A narrow histogram bin
does not improve the timer's precision. Warmup, measurement-window maxima,
ordinary progress and capture aggregates remain separate.

Each case repeats twice with reversed mode order. Paired differences can show
the direction and range of these observations; two repetitions and an
uncontrolled desktop scheduler do not establish a general causal effect or
performance guarantee. Successful execution, finite boundary samples and
timing counts do not establish glitch-free device playback, long-term
stability, whole-song compatibility or real-hardware sound.

For a completed full experiment:

```sh
node scripts/summarize_sid_worklet_performance.mjs \
  --report release/sid-performance-new.json \
  --plan docs/issues/sid_worklet_perf_plan_02.json \
  --out release/sid-performance-new-summary.json
```

The summary rejects missing/duplicate/failed cases, incorrect window scopes
and observed counter/position drift between the instrumented conditions. It retains
ordinary mode's unavailable timing values. The historical 8580 experiment and
its limitations remain in [the previous result](issues/sid8580_real_worklet_result_01.md).
