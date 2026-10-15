# MVP implementation and verification

Date: 2026-10-15. This record concerns the standalone DX7 project only.

## Implemented

| Area | Files / behavior |
| --- | --- |
| Upstream extraction | `vendor/msfa/`, pinned Google msfa source and Apache-2.0 notices |
| Native/WASM boundary | `native/dx7.cc`, fixed 44,100 Hz, existing SynthUnit allocator and DSP |
| Offline/Node API | `src/index.js` / `.d.ts`, owned mono Float32 PCM, renderInto, per-instance WASM memory |
| SysEx | `src/sysex.js` / `.d.ts`, one voice / 32-voice bank, validation, packing and self-authored INIT SINE |
| Browser API | `src/browser.js`, `src/dx7-worklet.js`, ready and load acknowledgement, ordered commands |
| Demo | `demo/`, file input, voice selection, pointer and PC keyboard, release-all and panic |
| Builds | `scripts/build-wasm.mjs`, `build-native.mjs`, Vite production demo |

Phases 1–6 of `issues/todo_01.md` are implemented within the documented MVP
boundaries. The investigation and adopted constraints are in `research.md`;
public API contracts and upstream limitations are in the README.

## Executed checks

- `npm test`: **27 tests passed**, including SysEx validation, both output
  rates, render partitioning, owned PCM, release, polyphony, and instance isolation.
- Native/WASM comparison: two self-authored voices (one-carrier sine;
  six operators with feedback and LFO), 44,100 output frames each, including
  Note Off at a non-64-frame boundary. **Maximum difference = 0, RMS difference = 0**
  in both cases. This compares the same minimally patched scalar msfa and adapter,
  not an uninitialized stock binary or real DX7 hardware.
- `npm run test:lifecycle`: AddressSanitizer and explicit C++ allocation tracking,
  **2,000 create/destroy and 1,000 panic cycles**, allocation delta **0**.
  Also verifies independent PCM and immediate panic silence.
- `npm run typecheck`: TypeScript API usage and negative type cases passed.
- `npm run test:browser`: **Chromium, WebKit and Firefox** passed actual
  AudioWorklet PCM generation at **44,100 and 48,000 Hz**, loading followed
  immediately by Note On, rejected-load preservation, ordered selection,
  panic silence and disposal. Source and production demos passed keyboard,
  pointer capture, blur-release, 32-voice import, INIT SINE download and narrow-layout checks.
- All three browser engines also passed failure cleanup checks: invalid WASM,
  fatal processor failure with a pending request, and AudioContext closure.
  Failed processors stop; pending operations reject and ports/listeners are released.
  Focused volume sliders retain musical keys while their arrow controls still work.
- Desktop and 390-pixel-wide screenshots inspected for layout.
- `npm run build`: WASM and static production demo built successfully.
- `npm run test:package`: locally packed tarball installed in an isolated
  directory. Bare package imports generated audible PCM at both output rates;
  consumer Vite builds resolved the public core/browser/Worklet/WASM exports.
  License, types and research documents were present. This consumer check itself does not publish.

Environment: macOS ARM64, Node.js 25.2.1, Emscripten 6.0.6,
Apple clang 17, TypeScript 5.9.3, Vite 7.3.7, Playwright 1.63.0.
The Firefox test used the matching Playwright Firefox 155.0 build.

## Limits and unverified environments

- Physical Safari/Chrome/Firefox applications and Windows/Linux hosts have not
  been separately tested. Playwright WebKit testing is not a claim of physical
  Safari verification.
- Apple AddressSanitizer has no supported leak detector. Its memory-access
  checks and the C++ allocation counter were used; Linux leak detection was not run.
- No DX7 hardware comparison. Full hardware fidelity is outside this MVP.
- Internal rate changes, stereo, channelized/multitimbral MIDI, Web MIDI input,
  sample-accurate scheduling and custom voice stealing are not implemented.
- The retained upstream engine does not apply all parsed parameters, including
  voice transpose and amplitude-modulation fields; see the README for details.
- The 48,000 Hz output uses continuous linear interpolation. It is not a
  high-order, band-limited resampler.
- No third-party voice banks, Dexed code, or existing Tetorica runtime dependency
  were introduced.

## Object preset API — 0.2.0 (2026-10-16)

- Added synchronous core setPreset/setOperator/setOperators/getPreset and
  acknowledged Promise equivalents for the browser and Playground.
- The selected slot and the rest of a 32-voice bank survive edits. Invalid
  objects and batches leave both patch data and held audio unchanged.
- Standalone Node suite: **41/41 passed**, including independent full-VCED
  fixtures, 44.1/48 kHz SysEx/Object PCM equality, held/future-note behavior,
  built-in-object rejection, cross-realm records and existing native comparison.
- Parent runtime/Playground example suite: **48/48 passed**.
- Standalone browser suite passed Chromium, WebKit and Firefox at 44.1/48 kHz:
  setter acknowledgements, FIFO, copied state, bank selection, rejected edits,
  pending-request disposal and source/production demo playback.
- Playground and an isolated installed FM npm tarball passed Chromium/WebKit
  in Main and Worker modes, with actual final PCM, mixer/FX, STOP/recreation.
  Monaco method/field completions and typed hover also passed.
- Standalone packed consumer passed Node PCM, strict public types and Vite
  public export/WASM/Worklet checks. Parent npm declarations passed
  NodeNext/Bundler and browser consumers without Node ambient types.
- Playground itch ZIP generation verified 357 local module/asset references.
  WASM/C++ and chip-clock behavior were unchanged. This API is packaged for
  standalone 0.2.0 and tetorica-fm2612 0.2.15. Physical Tauri/Windows/Linux were
  not tested.
- Operator, envelope and algorithm changes apply to future Note On. Applying a
  voice reconfigures the shared LFO while retaining its phase, which can affect
  held notes. This adds no live
  per-note operator editor, and retains upstream AM/transpose/sync limitations.

## Live parameters — 0.3.0 (2026-10-16)

- Operator outputLevel/mode/coarse/fine/detune and additive setFeedback affect
  sounding notes of the edited patch, including release tails. Identities isolate
  bank slots and replaced patches. No retrigger or phase reset; original captured
  scaling and ordinary unedited PCM are retained.
- **75/75 standalone tests** and **49/49 parent tests** passed. Six native/WASM
  comparisons (including four live-edit timelines) had **max/RMS error 0**.
- Live native probe, focused shift UBSan and ASAN lifecycle passed; native edits
  allocate no heap memory. Extreme legal frequency shifts are now well-defined.
- Final-engine Playwright Chromium/WebKit/Firefox at 44.1/48 kHz, actual Playground
  Chromium/WebKit Main/Worker, Monaco, and isolated standalone/FM npm consumers
  passed. FM checks validated 203 declarations and actual Main/Worker audio.
- 16-note/10-second offline medians: 64.570 ms without updates, 99.995 ms at
  60 updates/sec, 115.460 ms at 240 updates/sec. Excludes Worklet/OS scheduling.
- Full scope, performance method, fixed regressions and limitations are recorded
  in `issues/msfa-live-parameters/result.md`. Algorithm and general EG live edits
  are deferred; Tauri/physical hardware/Windows/Linux remain unverified.
- Release versions: 0.3.0 (standalone) / 0.2.16 (FM).

### Abrupt-change policy clarification — 0.3.1 (2026-10-16)

Frequency and feedback values apply directly with no new parameter smoothing,
interpolation, glide, crossfade or click suppression. Their waveform
discontinuities/clicks are accepted; non-finite input, corrupted amplitude,
divergence and crashes are not. Existing upstream gain interpolation and output
resampling are retained. A native/Worklet-path audit confirmed phase/EG/history
are not reinitialized by those edits; DSP, JavaScript and WASM were unchanged.

The suite now passes **77/77, skipped 0**. New 44.1/48 kHz regressions exercise
384 abrupt ratio/fixed-frequency and feedback0/7 changes on 16 notes, irregular
render chunks, NaN/Infinity rejection with preserved state/PCM, continuing slow
envelopes, recovery to an AC waveform, release and panic. No click-size limit or
new click-suppression requirement is imposed.

Release versions: standalone 0.3.1 / bundled FM 0.2.17. Runtime JavaScript,
declarations and WASM are byte-identical to 0.3.0; this release updates docs and tests.
