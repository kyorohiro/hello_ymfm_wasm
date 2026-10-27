# Atari POKEY standalone SDK core and dual-chip support

Date: 2026-10-27.

The editable `w/tetorica-soundchip-native` SDK now contains an independently
owned four-channel POKEY core, a Native CMake target, a low-level WASM ABI,
and a dual-chip WAV example. Two chips are two handles, not one global
eight-channel device. Their register writes, clocks, counters, polynomial
phase, RANDOM reads, mute masks, resets and lifetimes are independent.

## Source and license

The implementation adapts the explicitly BSD-3-Clause
[`emu/cores/pokey.c`](https://github.com/ValleyBell/libvgm/blob/61b62d64455e039de2a1d01498afa9e9b5f1cb88/emu/cores/pokey.c)
from libvgm, a C port of MAME's POKEY 4.9 implementation. The original file
and credits are retained under `vendor/libvgm-pokey/upstream/`.
Its SHA256 is `f90898d3f8b774f7e7ffefafa47f61ffeea893599582f32bed08c83542757ef9`.
Separate libvgm framework headers without file-level license declarations
were not imported. Original standalone glue replaces their integration.
The vendor LICENSE, README and snapshot manifest record this boundary.

## Native and WASM contracts

Native users include `<tetorica/pokey.hpp>` and link `tetorica::pokey`.
Each `tetorica::Pokey(clock, sampleRate)` owns its state. The WASM build
exports `pokey_create/destroy/reset/write/read/mute/generate`, plus allocation
functions; several handles can coexist within the same module.

Registers use local offsets `0..15`. Reads return the hardware read-side
map, not write-register shadows. Output is raw mono duplicated to planar
left/right floats. It retains the legacy integer gain 744, per-chip clipping
at 32767 and `/32768` conversion, including its DC component. No Mixer
adjustment, centering or board filter was added to the core.

The host-rate renderer integrates native-clock intervals with an integer
remainder and 64-bit weighted sums. Rendering and reset allocate no memory;
block boundaries do not discard native ticks. Monitor mute masks the final
sum without changing the emulated counters or polynomial phase and takes
effect on the next output sample, including held volume-only output.

Accepted clocks are whole Hz `1..100000000`, sample rates `8000..384000`.
The C ABI rejects invalid configurations. The direct C++ constructor follows
the existing SDK fallback convention; callers can reject inputs with
`validConfiguration()` first. The general default clock is 1,789,790 Hz.

## Dual POKEY and Atari Tetris

The [MAME Atari Tetris driver](https://github.com/mamedev/mame/blob/39eb9e44c394df9aec8186f2d2ef7517ace232e1/src/mame/atari/atetris.cpp)
creates two POKEYs at `14,318,181 / 8` and routes both to mono at `0.50`.
The SDK example uses the nearest whole-Hz clock, 1,789,773 Hz. It mixes two
independent chips at `0.5` each. An explicit `--stereo` option demonstrates
host routing of one chip per side; stereo is not an extra POKEY register.

The three-second sketch is original synthetic music. Its optional speaker
processing belongs to the example: a 20 Hz DC blocker and endpoint fades.
It does not change raw core output or claim to reproduce a Tetris board's
analog circuit. No game ROM or music is included.

## Validation

- Native POKEY CTest passed, including independent dual-chip lifetime,
  partition, held-DAC mute and allocation checks.
- Real Native/WASM parity: 57 cases, two block layouts, 235,091 compared
  stereo frames, maximum difference zero. Independent DAC/clipping,
  divide-by-28/divide-by-114/high-clock pitch, configuration and dual-handle
  assertions provide 32 specified checks.
- WASM smoke: 1,524,102 rendered frames, including multiple clocks/rates,
  exact render partitioning and independent handles in the same module.
- Address/undefined-behavior sanitizer execution passed.
- Extracted source ZIP: all 21 Native libraries built, all 26 CTests, 20 WAV
  examples and 10 JavaScript reference checks passed. The POKEY fixture ran
  3,055,137 assertions; its 2,048 hot blocks made no tracked C++ `new`
  allocations (direct `malloc` interception was not part of that counter).
- Release-harness unit tests: 70 passed. A fresh extracted POKEY WASM rebuild
  matched the supplied module pair byte for byte; both variants passed the
  smoke and Native parity checks above.
- Final source/WASM archives were audited. Only four Markdown files changed
  after the isolated rebuild; all 286 Native source/header/CMake files match
  the archive used by the full Native build and tests.
- CI now includes POKEY in its WASM matrix and discovers the Native fixture
  through CMake's target metadata for both parity comparisons. No new remote
  workflow run was triggered.

Commands, scope distinctions and final artifact hashes are recorded in
[atari_pokey_core_01.json](atari_pokey_core_01.json).

Tests compare software outputs and specified digital behavior. Human
listening, physical POKEY comparison and remote Windows/Linux CI execution
were not performed in this step. Known inherited boundaries include
immediate STIMER reset and stub external paddle/keyboard/serial I/O.

## Build and reproduce

Run inside `w/tetorica-soundchip-native`:

```sh
cmake -S . -B build/pokey -DCMAKE_BUILD_TYPE=Release
cmake --build build/pokey --target tetorica_pokey_fixture tetorica_pokey_wav
ctest --test-dir build/pokey -R pokey --output-on-failure
sh scripts/build-wasm.sh pokey build/pokey-wasm
node tests/pokey_wasm_smoke.mjs build/pokey-wasm
node tests/check_pokey_core.mjs --fixture build/pokey/native/tetorica_pokey_fixture \
  --wasm-dir build/pokey-wasm --out build/pokey-report.json
build/pokey/native/tetorica_pokey_wav build/dual-pokey.wav
```

The fixed SDK 0.1.4 snapshot in the main repository, existing generated WASM,
Playground/Tauri runtime, Mixer presets and published npm packages are
unchanged. This is an unreleased addition to the editable SDK; a new SDK
release and import will be needed before main-runtime integration.
The next integration work is the JS raw/Synth API, followed by the
Playground mode and VGM Analyzer route, with dual-chip routing preserved.
