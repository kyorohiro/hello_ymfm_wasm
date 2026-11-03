# Result

Completed 2026-10-16 within the adopted MVP scope. Release versions:
standalone 0.3.0 / bundled FM 0.2.16.

## Public behavior

| API | Live fields / timing |
| --- | --- |
| `setOperator(op, patch)` | Changed outputLevel, mode, coarse, fine, detune on the edited patch's sounding notes and release tails |
| `setOperators(entries)` | Same, atomically for a validated unique tuple batch; [] stays a no-op |
| `setFeedback(value)` | New setter, raw integer 0..7, same patch's sounding/future notes |
| `setPreset(preset)` | INIT defaults plus object replace the selected slot for future notes, with a fresh identity |
| `loadSysex(bytes)` | Replace the bank, assign fresh identities, select slot 0; old notes retain the old patch |
| `selectVoice(index)` | Select a slot for future notes; selecting it again retains its identity |

Core methods are synchronous; browser/Playground methods acknowledge with
Promises. No channels or explicit refresh API were added. Values retain DX7
units and validation. The next ungenerated 64-internal-frame block sees the edit;
generated leftovers, output resampling and device buffers are not bypassed.

Ordinary live level changes adopt the captured EG's current progressing state
as a fixed reference, then change per-operator attenuation. Initially clamped
operators have a parallel full-level reference. Mute does not end attack/release
early, and finished releases stay finished. Frequency changes retain phase.
Original velocity/key scaling, EG shape/key state, allocation and mono routing
are retained. Live edits do not reconfigure the shared LFO.

Selection/replacement retains the previous documented shared-LFO side effects.
General EG/rate/scaling/algorithm edits remain future-note-only. Raw feedback
retains its history. Abrupt feedback/frequency changes and their discontinuities
or clicks are explicitly accepted API behavior. Values apply directly with no
automatic parameter smoothing, interpolation, crossfade, slew or click
suppression. Existing upstream gain interpolation and output resampling remain.
NaN/Infinity reject; corrupted output, divergence and crashes are unacceptable.
No general live EG editor or hardware-fidelity claim was added.

Supported operator edits changing held notes is an intentional behavior change
from published 0.2.0. Existing signatures and ordinary no-edit PCM are retained.
Extreme legal frequency combinations formerly caused an undefined shift beyond
the LUT's range. They now use defined modular phase increments and alias rather
than clamp into audible range; existing in-range arithmetic stays identical.

## Verification

- Standalone `npm test`: **75/75 passed**, no skipped native comparisons.
  Includes old-WASM PCM hashes at 44.1/48 kHz, attack/sustain/release, level0
  recovery, carrier/modulator edits, captured scaling, phase, ratios/fixed/detune,
  feedback, 16-note partitioning, private patch identities, invalid atomic edits,
  no-op PCM, panic, and extreme legal frequency boundaries.
- Native/WASM: **six actual PCM comparisons**, two original and four live-edit
  timelines at non-block boundaries, including Note Off and the high-frequency
  case. Maximum difference **0**, RMS difference **0** in every case.
- Native live probe and focused shift UBSan passed. ASAN lifecycle passed
  **2,000 create/destroy and 1,000 panic cycles**, allocation delta **0**;
  native edits performed no heap allocations.
- Standalone Playwright **Chromium / WebKit / Firefox × 44.1/48 kHz** passed
  real Worklet PCM, live/release restoration, ordering, selection metadata race,
  cleanup and source/production demos against the final rebuilt engine.
- Actual Playground **Chromium / WebKit × Main/Worker** passed live changes,
  Monaco completion/hover, mixer, STOP/recreation and initialization guards.
- Parent direct-port / SoundChip lifecycle / examples suite: **49/49 passed**.
- Standalone isolated npm consumer passed Node PCM at both rates, strict public
  core/browser types, and Vite exported Worklet/WASM builds. The Vite check now
  distinguishes raw default assets from bundled processors without depending
  on hashed filename order.
- Isolated FM tarball passed **203 generated declarations**, NodeNext/Bundler
  and browser type consumers, 15 chip renderers / 23 WASM engine loads, plus
  Chromium/WebKit Main/Worker live PCM, SysEx, mixer and STOP/restart checks.
- Playground static ZIP built; 357 module/asset references verified.
- Type checks, syntax checks and `git diff --check` passed.

The regressions caught and fixed two real audio problems: muting a release used
to complete its EG early, and adopting a full-level trajectory on the first
slow-attack edit could make a one-step level increase reduce the amplitude.
An earlier request acknowledgement also no longer overwrites a newer optimistic
voice selection; ordered read snapshots remain unchanged.

## Measured load

macOS ARM64 / Node 26.7.0, fixed 44,100 Hz, 16 voices, 10 seconds of audio,
five interleaved runs after warm-up. Three operators change level/frequency and
feedback changes with each update. No machine-dependent performance assertion.

| Updates/second | Median elapsed processing | Fraction of audio duration |
| ---: | ---: | ---: |
| 0 | 64.570 ms | 0.646% |
| 60 | 99.995 ms | 1.000% |
| 240 | 115.460 ms | 1.155% |

Direct no-edit engine comparison: old 63.682 ms / new 65.353 ms (+2.62%, about
0.017 percentage points of real time). These are offline throughput figures,
not guarantees about Worklet deadlines, message queues, UI load or OS audio.
Reproduce with `npm run perf:live -- 10 /path/to/archived-original.wasm`.

## Main changed files

- Native: `native/dx7.{h,cc}`, `vendor/msfa/synth_unit.{h,cc}`,
  `dx7note.{h,cc}`, `env.{h,cc}`, `freqlut.cc`, `fm_core.cc`; rebuilt WASM.
- API: `src/index.js/.d.ts`, `browser.js/.d.ts`, `dx7-worklet.js`.
- Integration: parent `web/playground_dx7*.js`, checked-in web/docs engine
  snapshots, ambient Monaco types and explicit `sync_dx7_runtime.mjs --wasm`.
- Examples/docs: English/Japanese README, research/provenance, this issue and
  `docs/playground/examples/dx7/dx7-live-parameters.js` in the parent repository.
- Tests: standalone PCM/native/browser/type tests, native probes, performance
  harness, parent direct-port/browser/installed-package tests.

## Limits

No physical DX7 comparison, Tauri application launch, physical browser/device
audition or Windows/Linux host validation was performed. Playwright WebKit is
not a claim of physical Safari testing. Apple ASAN's allocation counter was used
alongside memory checks; Linux leak sanitizer was not run.

Algorithm live switching and general EG automation are deferred. The original
AM/transpose/oscillator-sync limitations and simple 48 kHz resampler remain.
The new live-level model preserves time through mute but does not promise exact
DX7 hardware EG timing after arbitrary parameter edits. No GPL source was copied;
see `license-review.md` and the retained upstream notices.

## Abrupt-change policy clarification — 0.3.1 (2026-10-16)

The user explicitly accepts waveform discontinuities/clicks caused by abrupt
frequency/feedback edits. README/specs now state direct parameter application
and prohibit adding automatic smoothing, interpolation, glide, crossfades or
click suppression. The existing implementation already follows this policy:
native edit assigns base pitch / feedback shift directly, retaining phase, EG
and feedback history. Upstream gain interpolation and PCM output resampling
remain as existing signal-processing behavior. No DSP or runtime code changed.

Two regressions bring the standalone suite to **77/77, skipped 0**, testing
16 voices / 384 sharp changes at each of 44.1/48 kHz, small irregular chunks,
atomic NaN/Infinity rejection, EG continuation, waveform recovery and normal
release/panic. Audible steps are not test failures. Non-finite/corrupted output,
divergence, crash and unnecessary phase/EG resets remain failures.

This clarification is packaged as standalone 0.3.1 / bundled FM 0.2.17.
Runtime JavaScript, declarations and WASM remain byte-identical to 0.3.0.
