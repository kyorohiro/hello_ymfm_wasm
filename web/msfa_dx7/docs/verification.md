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
