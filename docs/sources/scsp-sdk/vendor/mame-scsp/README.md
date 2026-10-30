# Experimental standalone SCSP instrument

CPU-free Sega/Yamaha YMF292-F (SCSP) port of MAME by ElSemi and R. Belmont,
with upstream fixes credited to kingshriek. BSD-3-Clause; see [LICENSE](LICENSE).
Original files are pinned at MAME revision
`a64a5d6602b19f67e091a4491f0c851a9dacf79d`, under `src/devices/sound/`.
Pristine `scsp.cpp`, `scsp.h`, `scspdsp.cpp`, `scspdsp.h` plus hashes and revision
are retained in [upstream/](upstream/). No game program, BIOS or sample is included.

## Interface and build

`<tetorica/scsp.h>` exposes `scsp_*`. Compile `scsp_instrument.cpp`, `scsp.cpp`
and `scspdsp.cpp` as C++17, or use the CMake target `tetorica::scsp`.
The same sources build WASM with `sh scripts/build_scsp_wasm.sh /tmp/scsp-wasm`.
Each independently owned handle has 512 KiB sound RAM and 32 physical slots;
output is fixed at 44,100 Hz, with caller-owned stereo float buffers.
No allocation, audio-device operation or file I/O occurs during rendering.

Register addresses are even byte offsets, not Saturn absolute addresses.
Writes accept a 16-bit mask: set bits select the bits being written. PCM8
is signed, and PCM16 RAM bytes are **big endian**. Internal chip addresses
wrap within 512 KiB; host upload/readback validates the entire transfer first.
Loop addresses count samples, while sample start is a byte address.
Use the key-execute bit to apply the programmed key bits across all slots.

Reset mutes the master, resets voices, DSP and deterministic noise state;
`scsp_reset(handle,0)` retains RAM, and `1` clears it. It does not allocate a
replacement core. Handles are not thread-safe and must not be copied.
No host resampling, automatic musical voice allocation or arbitrary-length
software PCM bank is provided. Raw DAC clipping is retained.

## Adaptation and limitations

- Replace MAME device, sound-stream and ROM interfaces with private byte RAM,
  endian-explicit word access and a stack-only output adapter.
- Retain original PCM interpolation, loops, envelopes, gain tables, LFO,
  slot modulation/ring-buffer path and DSP implementation. Monitor state is
  updated every sample so caller block partitioning cannot change it.
- Remove CPU IRQ/timer, DMA, serial MIDI and framework save-state code.
  Their register accesses are rejected by the public C API, before mutation;
  no placeholder implementation claims to execute those functions.
- Fix Saturn 512 KiB memory mode and 44.1 kHz output. Master configuration,
  DSP ring configuration, monitor and slot/ring/DSP access are documented in
  [scsp_instrument.h](scsp_instrument.h); reserved and unsupported writes fail.
- Replace the framework random source with per-handle deterministic xorshift32,
  including the LFO noise table. This is an approximation, not a hardware noise
  algorithm. External DSP inputs are zero; there is no external-input API.
- Compile with wrapping signed arithmetic, no strict aliasing and no FP
  contraction, matching the existing PS1 portability approach.
- Upstream identifies sound/DSP/EG inaccuracies and uses zero-slot FM delay.
  No cycle-accurate Saturn or complete hardware fidelity is claimed.
- Initial verification covers original PCM16 sine and PCM8, slot 31, stereo
  pan, 32-slot finite/clamped mixing, release/reset, invalid inputs, instance
  independence and block partitioning. **FM, LFO and DSP are retained but not
  yet behaviorally verified.** There is no SSF player, CPU or game-tone importer.

## Reproduce the initial verification

```sh
cmake -S . -B /tmp/scsp-build -DBUILD_TESTING=ON -DTETORICA_NATIVE_BUILD_EXAMPLES=OFF
cmake --build /tmp/scsp-build --target tetorica_scsp_fixture
ctest --test-dir /tmp/scsp-build -R tetorica.scsp --output-on-failure
sh scripts/build_scsp_wasm.sh /tmp/scsp-wasm
node tests/scsp_wasm_smoke.mjs --wasm-dir /tmp/scsp-wasm --native-fixture /tmp/scsp-build/native/tetorica_scsp_fixture
```

The integer sine needs no recording or downloaded assets. The smoke test
compares 8,192 stereo frames bit for bit between Native and WASM and checks
partitioning, release, reset and handle isolation. This confirms portability
for those inputs, not agreement with real hardware. No listening was performed.
