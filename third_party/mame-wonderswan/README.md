# Standalone WonderSwan sound core

This is a BSD-3-Clause adaptation of Wilbert Pol's MAME WonderSwan sound device.
It builds as ordinary C++14 or Emscripten WebAssembly, without MAME's device,
CPU, cartridge, BIOS, stream, logging, or save-state infrastructure.

## Source and license

The exact upstream files are retained in `upstream/`:

- [`wswansound.cpp`](https://github.com/mamedev/mame/blob/d0f1c15a0f6df2dd51a754cb46e6175b7079c8f2/src/mame/shared/wswansound.cpp)
- [`wswansound.h`](https://github.com/mamedev/mame/blob/d0f1c15a0f6df2dd51a754cb46e6175b7079c8f2/src/mame/shared/wswansound.h)

Revision: `d0f1c15a0f6df2dd51a754cb46e6175b7079c8f2`.
Both files declare `license:BSD-3-Clause` and `copyright-holders:Wilbert Pol`.
See [LICENSE](LICENSE) for the upstream license and adaptation copyright.
No libvgm implementation or support code is included.

| File | SHA-256 |
|---|---|
| `upstream/wswansound.cpp` | `4c1c9ae39968c0dfc8230519d06439c403e387fa2b250c1dbb06b0663845bc20` |
| `upstream/wswansound.h` | `a4edef627dbc3fd47def5bdc0f2ebeeb25f1ba63396f5952796df3c3ff81bef3` |

## Supported sound functions

- Four 32-point, 4-bit wavetable channels with independent 4-bit left/right volumes.
- Channel 2's direct unsigned 8-bit voice mode, supplied by host register writes.
- Channel 3's signed frequency sweep.
- Channel 4's eight noise tap configurations and readable noise shift register.
- The stereo headphone output, with headphones permanently connected.
- Owned 16 KiB waveform RAM and the original 64-byte-aligned waveform-bank selector.
- Host mute for each of the four channels; muting suppresses output while the
  channel, noise generator, and sweep continue to advance.

The host writes absolute **byte addresses**, rather than MAME's word offsets.

| Byte address | Function |
|---|---|
| `0x80..0x87` | Four little-endian 11-bit frequencies (`period = 2048 - frequency`) |
| `0x88..0x8b` | Four left/right volumes; `0x89` is also the voice-mode PCM latch |
| `0x8c` | Signed sweep step |
| `0x8d` | Sweep interval, `8192 * ((value & 31) + 1)` clocks |
| `0x8e` | Noise type, reset strobe, and noise generator enable |
| `0x8f` | Wave RAM base, `value * 64` |
| `0x90` | Channel enables and voice/sweep/noise modes |
| `0x91` | Output control; bit 3 enables headphones, read-only bit 7 is always set |
| `0x92..0x93` | Noise shift register |
| `0x94` | Left/right voice-mode routing and half/full volume |
| `0x96..0x9b` | Read-only output monitors |
| `0x9e` | Stored WSC system-volume setting; no output effect, as in upstream |

Unimplemented registers in `0x80..0x9f` read zero and ignore writes. Addresses
outside this range also read zero and ignore writes. Wave RAM's public API
accepts `0x0000..0x3fff`; out-of-range accesses read zero or ignore writes.
The internal waveform fetch wraps on the original 14-bit address bus.

## PCM and timing policy

The default clock is 3,072,000 Hz. The sound engine retains MAME's integer
`floor(clock / 128)` update cadence (24,000 updates/second at the default clock).
For non-divisible caller-supplied clocks, the same truncation applies. An integer phase
accumulator converts that cadence to the requested output rate using sample and
hold. Output and chip state are identical for the same ordered writes and frame
count, regardless of how `generate()` calls are divided into blocks.

PCM follows the upstream headphone DAC path: each active wavetable channel
contributes `volume * unsigned_sample`, and each output is the sum divided by
1024, equivalent to MAME's `(sum << 5) / 32768`. **It is unipolar PCM and contains
DC.** This core does not center it, apply a high-pass filter, normalize channels,
or add a hidden gain. A speaker adapter may apply an explicit DC policy later;
Native/WASM comparisons must use the same raw PCM. At full volume, one waveform
channel spans `0..225/1024`, four channels sum to at most `900/1024`.

After reset, the headphone output is disabled. Set register `0x91` to `0x08`,
load the packed waveform, set frequency and volume, then enable the desired
channel in `0x90`. At the default clock, a 32-point waveform's fundamental is
`clock / (32 * (2048 - frequency))`. The retained integer cadence makes the
effective clock `128 * floor(clock / 128)` for other requested clocks. Wave RAM
stores the even sample in the low nibble and the odd sample in the high nibble.

## Differences and limits

- `reset()` is a deterministic cold reset: all registers, waveform RAM, host
  mute flags, resampling phase, and cached PCM are cleared. MAME's device reset
  leaves several register values and externally owned machine RAM intact.
- Headphones are permanently connected. The internal mono speaker's wrapping,
  attenuation, and disconnect behavior are not implemented. Speaker-control
  bits round-trip, but only headphone-enable bit 3 affects rendering.
- HyperVoice (`0x64..0x6b`), sound DMA, CPU timers, interrupt behavior, cartridge
  mapping, test registers, save states, and system-volume gain are not provided.
  The host can schedule direct voice-byte writes, but this is not DMA emulation.
- The upstream source labels its emulation preliminary. This adaptation keeps
  its current behavior, including known differences from hardware documents:
  writing `0x8d` does not reset the sweep counter; direct voice mode requires
  both channel-2-enable bit 1 and voice-mode bit 5 of `0x90`; reading a negative
  sweep step preserves upstream's signed-promotion behavior in the high byte.
- No analog output filter, interpolation, or anti-aliasing is added. Hardware
  accuracy beyond the retained upstream behavior has not been established.

The [WSdev sound reference](https://ws.nesdev.org/wiki/Sound) is useful for
comparing the register definitions and known hardware differences. It is a
documentation reference; this adaptation's code comes from the pinned MAME files.

The C++ constructor accepts clock values `128..100000000` and output sample
rates `8000..384000`; an invalid C++ configuration falls back to the defaults.
The C ABI instead returns null for invalid configurations or allocation failure.
All C ABI entry points tolerate a null chip pointer. Register writes and sample
generation allocate no memory after construction.

From the repository root, build with:

```sh
sh scripts/build_wonderswan_wasm.sh
sh scripts/build_wonderswan_wasm.sh /absolute/output/directory
```

`EMXX` can select an installed Emscripten C++ compiler. The build first verifies
the complete fixed SDK snapshot, then delegates to its offline WonderSwan recipe
in `third_party/tetorica-soundchip-native`. This directory is retained as the
original adaptation and provenance reference; the current build uses the
byte-identical adaptation included in SDK 0.1.4.

The synchronous JavaScript wrapper is [web/wonderswan.js](../../web/wonderswan.js).
From the repository root, run the native/WASM checks and optional browser checks:

```sh
npm run test:wonderswan
npm run test:wonderswan:browser
```

The browser check uses Chromium and WebKit in both Window and DedicatedWorker
contexts, without creating an audio device. These checks verify the raw core;
Playground Mode and Tauri audio backend integration have separate checks.

The output's central `build-info.json` now records WonderSwan alongside the
other 27 SDK artifacts, with the compiler version and SHA-256/size of every
cataloged recipe input and generated output. The native/WASM check verifies
these inputs against the fixed SDK release manifest before loading the module.
The full SDK pin also covers license and provenance files.

For comparison with an archived standalone build, preserve its original
`wonderswan_build-info.json` and all eight recorded source inputs. The checker
keeps the original full source/receipt audit when explicitly given that tree:

```sh
node scripts/check_wonderswan_core.mjs --wasm-dir /archive/docs/generated --source-root /archive
node scripts/check_wonderswan_wasm_sdk.mjs --legacy-dir /archive/docs/generated --sdk-dir /new-build
```

The second command compares the actual old/new WASM ABI, stereo PCM, registers,
wave RAM, chunk partitioning, reset replay, all noise types, sweep and voice PCM.
It also reuses the raw-core check's independent DAC, LFSR, sweep and pitch
expectations. It does not open an audio device or alter output gain.
