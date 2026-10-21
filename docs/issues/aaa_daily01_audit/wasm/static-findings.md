# WASM / PCM static evidence (read-only audit)

No production files changed. Timing and allocation results are in the adjacent JSON when run.

## Existing clean paths

- `web/ym2612.js:423` / `web/segapsg.js:191`: borrowed views are cached using WASM buffer identity, pointer and capacity, keeping public owned PCM semantics. `web/ym2612-worklet.js:505` uses both borrowed views. Buffer capacity is reserved during initialization (`:166`). Numeric bindings already bypass `cwrap` where a numeric export exists (`web/ym2612.js:543` / `web/segapsg.js:250`). Do not repeat this existing fix.
- `web/ym2203.js:267`, `web/ym2608.js:337`, `web/ym2610b.js:204`: borrowed PCM views already exist and are used by the corresponding Worklets (`web/playground_opn_worklet.js:129`, `web/ym2203-worklet.js:122`, `web/ym2608-worklet.js:150`, `web/ym2610b-worklet.js:140`). Numeric bindings are still `cwrap`, so only the binding cost remains a candidate.
- `web/spc.js:119`: `renderInto()` uses cached native views, copies into caller-owned output and does not create intermediate PCM arrays once memory has stabilized. Native call already uses a numeric export directly. Snapshot/trace copies are outside the steady render path.
- `web/huc6280audioengine.js:135`: native generation already calls `module._huc6280_generate` directly; no numeric binding candidate here.

## Candidate: internal reusable PCM on non-OPN transports

Public `generateStereo()` / `processFrames()` deliberately promise independent owned data. Preserve that contract and add/use an internal borrowed view or caller-owned destination only inside the Worklet.

- Game Boy: `web/gameboyapu.js:117` returns two `Float32Array` copies and a result object after two `HEAPF32.subarray` views (`:128`), then `web/playground_gameboy_worklet.js:82` copies both PCM arrays again into Worklet outputs. Per unsegmented 128-frame block: 2 payload allocations (1,024 B), 2 source views, 1 result object, and 2 stereo copy passes (2,048 B moved). At 48 kHz / 128 frames = 375 blocks/s: 384,000 B/s payload allocations, 750 PCM arrays/s, 750 source views/s, 375 result objects/s. This excludes the generated numeric wrapper allocations. Event segmentation may increase object counts but not source PCM bytes per audio second.
- YM2413: `web/ym2413.js:203` has the same owned allocation/copy pattern (`:209`), consumed by `web/playground_ym2413_worklet.js:107`. There is one intermediate stereo copy before the necessary resampler output loop. Native rate is clock/72 (~49,715 Hz), so payload allocation ~397,720 B/s at default clock regardless of 128-frame output block splitting, plus per-call views/objects. Retain identical additions/remainders, native-frame count, IRQ hooks, pointer invalidation on memory growth and mute/audition behavior.
- YM2151: same pattern `web/ym2151.js:238`; real Worklet `web/playground_ym2151_worklet.js:134`. RF5C164 also copies (`web/rf5c164.js:210`, `web/rf5c164-worklet.js:54`). AY8910, OPL/OPLL and several optional chips share it. They are corroborating static scope, not separate benchmarks in this bounded audit.
- HuC6280: `web/huc6280audioengine.js:123` allocates two PCM arrays using `Float32Array.from(..., v => v * this.volume)` (`:139`), two source views, two mapper functions and one result object. Then `web/playground_huc6280_worklet.js:143` copies the intermediate arrays to the output. Default volume=1 allows a diagnostic internal borrowed-view pass; a product implementation must also preserve arbitrary master volume, Float32 rounding and the public owned result lifetime. `processInto()` is a more general safe shape than aliasing the public API.
- OPL3/YMF262 already offers `generateStereoInto(left,right,frames)` (`web/ymf262.js:219`), but shared `web/playground_opl_worklet.js` still chooses owned `generateStereo()` in `renderFrames()`. This is a connection candidate, not evidence that every chip has the destination API.

## Candidate: numeric-only direct binding beyond Genesis

- `web/ym2413.js:52` and several OPN/PCM wrappers bind numeric functions through Emscripten `cwrap`. **This is generated-build dependent**: YM2413's generated glue implements `cwrap` as a rest-argument lambda to `ccall`; each call constructs argument arrays, converter/return closures, and a converter object before reaching the numeric export. No strings or array parameters are needed on `generate(handle,leftPtr,rightPtr,frames)`.
- **Game Boy is already clean for numeric bindings**: although source `web/gameboyapu.js:40` calls `cwrap`, the current generated build detects all-numeric arguments/return and returns `getCFunc()` once during setup. A manual direct binding is not recommended. HuC6280 also calls native exports directly.
- Current generated-build classification: ccall route remains in YM2203/YM2608/YM2610B/YM2413/RF5C164; YM2612/Nuked/PSG generated glue also has it, but wrapper direct binding already bypasses it. Numeric fast path already exists in YM2151/YM3438/Game Boy/AY8910/OPL2/OPL3/Y8950/YMF278B/PCM-side optional cores. Do not propose a project-wide `cwrap` replacement from its spelling alone.
- Diagnostic changes only `api.generate` to `module._<name>_generate.bind(module)`; does not bypass Emscripten assertion wrapper or change native/WASM code, numbers, clock, envelope or frequency math.
- Product implementation should follow the existing YM2612/PSG helper: preserve cwrap-only injected factories and optional native export absence. Do not change public APIs, IRQ notifications or state serialization.

## Benchmark bounds

- Four representative real processor implementations: Genesis baseline, Game Boy, YM2413, HuC6280; sustained sound; no event scheduling, output monitoring, UI or Worker traffic. Native generated JS/WASM and full `processor.process` code run in Node VM.
- Timing: 48,000 Hz, 128 output frames, 1,500 warmup blocks, 5,000 measured blocks, 5 sequential trials per condition; reused output arrays. Mean/p95/p99/max are per process call and include VM boundary + two high-resolution timer calls. Timing is an offline throughput comparison and cannot establish Safari/Tauri device deadlines.
- Allocation sampling is a separate run using V8 HeapProfiler at 1,024-byte interval. Approximate sampled bytes, natural GC counts and instrumented native malloc/free/generation counts are reported separately. Sampling adds substantial overhead and is never used as a render-time result. V8 sampling does not comprehensively account for external ArrayBuffer backing stores; PCM payload/copy bytes above are derived from source frame counts, and must not be mistaken for a subset or exact total of the sampled allocation bytes.
- Correctness uses real processor PCM from fresh native instances and mixed segment sizes (1/127/128/257/4096/31/256), comparing SHA256 of each block's left then right output arrays against current behavior. It covers fixture PCM determinism, not the entire public chip API or all voice modes.

## Measured result and priority

1. **HuC6280 mapped `Float32Array.from` -> indexed owned copy** is the strongest low-risk candidate: preserve two owned PCM arrays, multiplier and Float32 stores; remove iterable/mapper machinery. Allocation-only repeat sampled 130,132,600 -> 3,502,832 B per 5,000 blocks (~97.3% reduction), while source PCM payload allocations remain 5,120,000 B and one intermediate stereo copy remains. Five current trials had seven natural minor GCs each; indexed trials had none. Timing mean 89.06 -> 79.62 us, median trial p99 111.33 -> 103.71 us, but indexed max 11.61 ms OS/VM outlier means no worst-case/deadline improvement claim. Both volume=1 and 0.7 outputs match SHA256 over 68,000 varied frames. A product change should also test zero frames, other finite gains, disposal, mixed channels, waveform/noise/LFO and engine partitioning.
2. **Internal reusable PCM for Game Boy / YM2413 / HuC6280** removes repeated owned PCM payload allocation and an avoidable intermediate copy. Game Boy sampled 3,920,808 -> 665,344 B; steady mean 53.08 -> 52.94 us is essentially unchanged, so allocation/copy reduction is established but reduced processing time is not. Public owned results must stay unchanged. Borrowed prototypes for GB/HuC cache by requested frame length, so two view objects can still be rebuilt when segment lengths change; YM2413 caches capacity-sized views like existing OPN. The fixed 128-frame steady test is not an all-segmentation allocation-zero claim.
3. **YM2413 numeric generate binding** alone sampled 8,930,008 -> 5,562,128 B; mean 34.44 -> 34.76 us offers no timing improvement evidence. Combined borrowed views + direct numeric generation sampled 1,328,584 B. Priority is below the stronger HuC mapped-copy issue; preserve injected factories/ABI/IRQ hooks.

All ten conditions had zero steady native malloc/free calls and zero WASM buffer replacements in the allocation-only pass. These particular sustained fixtures did not trigger buffer growth after warmup. Sampled bytes remain nonzero even for already optimized Genesis because generated assertion wrappers, JS/VM call plumbing and profiler/counter overhead remain; no universal allocation-zero claim is made.

The initial timing run's allocation free counter included final disposal due to a harness ordering mistake. **Use the archived `report-results.json`**: it combines the original timing/PCM results with a corrected isolated allocation pass that snapshots counters before disposal. Timing and PCM results from the first run are unaffected. The superseded temporary logs are not archived.

### Independent HuC same-realm confirmation

Because VM/JIT/cross-realm call shapes can inflate absolute allocation counts, the highest-priority HuC candidate was independently rechecked with direct ESM engine/factory imports and no VM. See `huc-same-realm.mjs` / `huc-same-realm-results.json`. Five AB/BA trials, 1,500 warmup and 5,000 measured blocks at 48k/128, separate profiler pass:

- Sampled current allocation 129,504,504 B -> owned-indexed 2,200,232 B (~98.3% reduction). The dominant current sites remain iterator `next` (72.14 MB), `from` (32.57 MB), mapper callbacks (20.35 MB total). Both still allocate 5,120,000 B of stereo PCM payload per 5,000 blocks, which is accounted separately from V8 sampled totals.
- Current mean by trial 89.11/88.90/90.95/108.22/99.37 us, indexed 80.26/76.96/77.09/76.65/77.18 us; medians 90.95 and 77.09 us respectively. Aggregate means 95.31 and 77.63 us. Current max60.04 ms, indexed max0.417 ms; these are offline observed extrema, not a guaranteed deadline comparison. Current p99 median208.29 us, indexed99.00 us.
- Natural GC current31/31/31/15/15 vs indexed0/0/0/0/0; counts depend on V8 heap size/threshold and are observations of this run.
- Volume1/.7, zero-frame and varied segment correctness: 67,872 output frames each, bitwise hashes match per volume. Steady native malloc/free/memory replacement all0.

This crosscheck confirms the allocation issue outside the VM and strengthens the mapped-copy recommendation. It does not justify using absolute VM allocation samples as Safari or Tauri byte counts, nor claiming a noise fix.
