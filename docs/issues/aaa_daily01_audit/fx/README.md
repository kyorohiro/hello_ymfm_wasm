# NativeFX / LiveFX audit probe

Production is read-only. Run sequentially from the repository root (or pass it as the final argument):

```sh
node --expose-gc /path/to/probe.mjs describe
node --expose-gc /path/to/probe.mjs prepare-js
node --expose-gc /path/to/probe.mjs build
node --expose-gc /path/to/probe.mjs compare
node --expose-gc /path/to/probe.mjs compare-js
node --expose-gc /path/to/probe.mjs timing
node --expose-gc /path/to/probe.mjs alloc
```

`build` requires locally installed `emcc`; it does not download toolchains or Docker images. It records compiler version and builds both an unmodified `rebuilt-baseline.wasm` and `candidate.wasm` with the same local compiler and repository build arguments. The candidate copies native DSP sources next to this probe and inserts a single guard in the copy of `noise.c`. It does not run the repository's build script or copy output into the repository. The guard skips a **created but inactive** noise voice only when all six parameter ramps and its envelope have zero remaining frames. Active voices and inactive ramps continue through the original processing code.

`compare` checks full stereo PCM bytes from shipped WASM, same-compiler rebuilt baseline and temporary candidate over 4,000 blocks, including all five noise types across 32 voices, creation without start, start/stop/restart, release, and cutoff/pan ramps during inactivity. This is coverage for a candidate, not a complete specification proof.

`prepare-js` creates temporary module copies with two narrow changes: move the rare `channels.map(() => new Float32Array(n))` allocation into a helper (avoiding a captured-`n` lexical context on every LiveFX.process entry), and test `ramps.size > 0` before creating its Map iterator. This preserves `hasProcessed` even with no live effects and still invokes noise/sample/graph processing. `compare-js` compares all eleven source/FX cases and dynamic registration/removal/context changes and gain ramps. It does not change production modules.

The independently measured `indexed` flavor changes only the finite-value validation from a Float32Array `for ... of` loop to an index loop. It keeps validation, bypass behavior, copies, clipping, fade, state and graph processing. It does not include the helper/empty-ramp changes above. This JS-only comparison does not require emcc:

```sh
node --expose-gc /path/to/probe.mjs prepare-js "$PWD" indexed
node --expose-gc /path/to/probe.mjs compare-js "$PWD" indexed
node --expose-gc /path/to/probe.mjs timing "$PWD" indexed
node --expose-gc /path/to/probe.mjs alloc "$PWD" indexed
node --import /path/to/indexed-hook.mjs --test web/custom_fx.test.mjs
```

The hook redirects only the repository's `web/custom_fx.js` import to the temporary indexed candidate. The original existing tests then exercise nonfinite samples, bypass/restore, valid and malformed channel replacement, frozen arrays, fades and Main/Worker worklet controls. Set `FX_AUDIT_REPO_ROOT` if invoking from elsewhere.

Artifact flavor labels: `timing.json`, `alloc.json`, `compare-js.json` use the **helper-guard** candidate; their `js-candidate` row label refers to the helper+empty-ramp changes. `timing-indexed.json`, `alloc-indexed.json`, `compare-js-indexed.json` use the independent **indexed** candidate; their `js-candidate` row label refers only to the finite-validation loop change. The environment field `jsCandidateFlavor` distinguishes them. `compare.json` is the C noise candidate comparison and does not use either JS candidate.

Generated temporary JS modules contain local absolute import URLs and need not be archived; `prepare-js` regenerates them from a selected repository checkout. The historical portable emcc command template is in `build-command-template.sh`; the concrete temporary build scripts and compiled WASM are not required for a fresh rerun.

`timing` runs the actual NativeFXProcessor and WASM with preallocated stereo input/output. Each case/variant gets 5,000 warmup blocks and 20,000 individually timed 128-frame blocks at 48 kHz, across three trials. Candidate ordering alternates. Noise cases include shipped, rebuilt baseline and candidate; all other cases measure shipped only. Statistics are in microseconds. Timer overhead is recorded separately and not subtracted. WASM compilation, setup, warmup, explicit GC, sorting and reporting are outside timed blocks. No profiler or GC observer runs during timing.

`alloc` is a separate 50,000-block pass per original case, with V8 HeapProfiler sampling at 1,024 bytes including objects collected by minor/major GC, plus PerformanceObserver GC records. Allocation sizes are sampled estimates. Inspector/harness activity can contribute to totals; `projectSampledAllocatedBytes` filters allocation-site URLs to repository `web/` or temporary copied modules. The profiler changes GC pressure, so those GC counts/pauses are not ordinary browser rates or latency guarantees.

This Node test measures elapsed processing time and allocation, not process CPU time, browser AudioWorklet deadlines, device underruns, audible noise, Main/Worker transport, or API call cost. Elapsed times can include preemption and GC. No improvement should be described as a noise fix.

Current common NativeFX PCM movement: two stereo channels copied into WASM and two out = 2,048 bytes per 128-frame render (768,000 bytes/s at 48 kHz), plus the native graph's input-to-output writes. These copies isolate WebAudio-owned buffers from WASM memory and feed noise/sample sources before the graph; removing them requires more than a chain-empty check.
