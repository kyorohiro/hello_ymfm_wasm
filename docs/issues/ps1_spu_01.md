# Experimental PS1 SPU foundation — 2026-10-28

Base: `5a746b00` (`NeoGeoのPCM → ADPCM-A変換`). Scope and next milestones:
[todo_ps1_01.md](todo_ps1_01.md). Public usage: [../ps1_spu.md](../ps1_spu.md).

## Implemented

- `native/ps1/`: actual CPU-free MAME SPU adaptation, C++17, 24 voices, 512 KiB
  instance-local RAM and 44,100 Hz stereo float PCM. C API exposes lifecycle,
  register access, raw RAM transfer and pull rendering. It needs no MAME runtime,
  CPU, BIOS or game asset.
- Pinned MAME revision `a64a5d6602b19f67e091a4491f0c851a9dacf79d`; five original
  BSD-3-Clause files by pSXAuthor / R. Belmont retained verbatim with SHA256SUMS.
  Adaptation details and license are included beside the core.
- `web/ps1_spu.js` and docs mirror: explicit factory-injected `Ps1Spu`, owned
  PCM/RAM results, validated inputs, caller-buffer rendering, instance isolation,
  retain/clear RAM reset and idempotent disposal. Heap-backed sample inputs are
  stabilized before transfer allocations can grow WASM memory.
- `scripts/build_ps1_spu_wasm.sh`: shared four-unit Emscripten build, input
  snapshots before/after compilation and exact output receipt. Complete source,
  upstream snapshots, recipe, WASM and notices are included in full-runtime/npm
  staging separately from the fixed SDK inventory.
- `examples/nodejs/main_ps1_spu.js`: authored filter-0 loop and one-shot hit,
  voices 0/23, 3-second melody. Saves WAV, metadata and both packet banks; no
  Mixer override. Local output `/private/tmp/ps1-spu-foundation.wav`.
- Added native/WASM core tests and Chromium/WebKit Window/Worker checks to the
  existing itch web CI. Remote CI has not been run for this change.

## Verification

- 15 actual-core tests passed, zero skips. Independent native C++ and shipped
  WASM agree exactly on stereo PCM, registers and RAM after all 24 voices,
  predictor/pitch/loop/ADSR/stereo cases, irregular render chunks, cache updates,
  key-off and reset. Additional owned-input regression forces actual WASM memory
  growth during RAM upload and preserves the original data.
- Corrected inherited cache ownership / RAM-wrap lookahead, effective pitch and
  PMON bounds, voice-zero PMON handling, and zero-pitch endpoint interpolation.
  The final native core passed ten offline audio/cache cases under AddressSanitizer,
  UBSan and float-cast-overflow, plus 256 authored random fixtures × 24 voices.
  LeakSanitizer is unavailable in this macOS environment; no leak-check claim.
- Chromium and WebKit × Window and DedicatedWorker: all four conditions passed.
  Each checks voice 24, real frequency doubling, stereo, ownership/isolation,
  key-off, retain/clear RAM reset and disposal, and exactly matches the Node WASM
  baseline. No AudioContext was created and no physical audio was played.
- Original example: 132,300 stereo frames / 44,100 Hz / 3 seconds; peak
  `0.09563624858856201`, RMS `0.030548302688986836`, no clipping/non-finite values,
  final 1,024 frames exactly silent. Human listening has not been performed.
- All 18 source/recipe input hashes and both generated output hashes match the
  final receipt; JS mirror is byte-identical. Actionlint and `git diff --check`
  passed.

- Final package: 969 files, 322 runtime modules, 28 fixed-SDK chip pairs plus the
  separate experimental SPU, and 372 checked declarations. Isolated npm
  pack/install, both SPU import forms, actual authored ADPCM playback/release,
  source/license audit, existing engine checks and NodeNext/Bundler/Browser
  positive/negative type fixtures all passed. No version bump or publication.
- The packaged four-unit C++ source compiles and passes its C API selftest
  without repository source fallback. Its unchanged standalone WASM recipe
  rebuilds without an SDK checkout and produces byte-identical JS and WASM.
  Full receipts are in the accompanying [JSON](ps1_spu_01.json).

## Limits and next work

This is an experimental instrument core, with upstream linear interpolation,
floating envelope approximations and preset-matched approximate reverb. ADSR
updates apply on next key-on. Standard RAM mapping, aligned packets and fixed
volumes are supported; volume sweeps and other RAM mappings are rejected.

Rendering may allocate sample caches. Real-time callback guarantees, scheduling,
resampling, Synth/transport API, PCM encoder, audio endpoints, Playground mode,
Keyboard, inspection tab and Tauri integration are future milestones. CPU DMA/IRQ,
PSF playback and external XA/CD streaming are not exposed. Do not infer hardware
accuracy or game soundtrack compatibility from Native/WASM agreement.

The fixed SDK, existing Playground modes/audio path, Mixer defaults and VGM
package were not changed. No commit, push, tag, npm publication, SDK release,
Tauri import or itch.io upload was performed.
