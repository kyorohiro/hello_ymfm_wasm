# Play! PSF1 machine subset

This directory contains the readable source subset used by Tetorica's independent
PSF song-preview CPU and HLE BIOS. Audio now uses the same fixed MAME-derived
SPU as Tetorica's keyboard and Code modes, without modifying that DSP source.
Play!, Framework and CodeGen are licensed under BSD-2-Clause; their original
license texts are included in the corresponding directories.

- [Play!](https://github.com/jpd002/Play-), commit `1f27232772e484bfb79364b751b84f41f4c87481`.
- [Framework](https://github.com/jpd002/Play--Framework), pinned submodule `587f278917acc0026bf5fc34b39f995fc26bd015`.
- [CodeGen](https://github.com/jpd002/Play--CodeGen), pinned submodule `a5009f7dca062695b8e5aebbd71e67b4ddfa9251`.

The PS1 BIOS is Play!'s handwritten high-level emulation (`Source/psx/PsxBios.cpp`).
No Sony BIOS image, game executable, game sample or game music is included.

`sources.json` lists the compilation units. Included headers retain their upstream
paths. Tetorica's adapter lives in `tetorica_src/wasm/psf_player/psf_player.cpp`.
Rebuild with Emscripten installed:

```sh
node scripts/build_psf_player.mjs
```

The adapter runs synchronously, produces 44,100 Hz stereo PCM, and
uses the Wasm code generator. It needs neither SharedArrayBuffer nor a separate
BIOS file. Browser playback and scheduling are implemented separately in JS.

Local changes to upstream:

- `deps/CodeGen/src/WasmModuleBuilder.cpp`: import ordinary unshared Wasm memory
  in generated CPU blocks, matching the renderer without pthreads.

- `Source/Ps2Const.h`: select the PS1 2 MiB RAM size, retaining its four RAM mirrors.

- `Source/iop/Iop_SubSystem.{h,cpp}`: remove the PS2 `IopBios.h` dependency and reject
  PS2 construction; omit two unrelated PS2 SIO2 DMA callbacks. Add an optional
  external SPU IRQ source so inactive Play! SPU objects cannot clear its line.
  Only PSF1 is exposed.
- `Source/MemoryMap.{h,cpp}` and `Source/MemoryUtils.cpp`: add optional width-aware
  PS1 SPU bus callbacks for
  byte, halfword and word reads/writes. The old generic function handler does not
  carry access width. Preserve the full CPU register value for even byte stores
  (the SPU drives its low 16 bits); odd byte stores are ignored by the host.
  Other mappings and users without callbacks are unchanged.

PSF2, PSP PSF, RAR, native sound output, networking and the emulator GUI are not
part of this subset.

## Preview limits

This is a PSF1 reference-preview engine, not full PlayStation emulation. Its HLE
BIOS implements a subset of PS1 services; some game drivers may fail or differ.
The CPU/HLE remains Play!, but its SPU renderer is inactive. The audio core is
`third_party/tetorica-soundchip-native/vendor/mame-ps1-spu/`, built from the same
fixed BSD-3-Clause source as the Synth. PMON, Noise, main-output and reverb-return
volumes therefore use that core instead of Play!'s ignored-register paths.

The private host adapter routes the full `0x1f801c00..0x1f801fff` register range,
DMA4 both ways, and the latched SPU IRQ status into PS1 interrupt line 9. It
advances at 768 CPU cycles per 44.1-kHz frame, carrying executor overshoot into
the next frame. Play!'s CPU executes basic blocks: this is bounded sample-level
synchronization, not cycle-exact CPU/SPU timing. Transfer IRQs are checked
against the accessed RAM word; exact sub-sample transfer IRQ timing is not
claimed. The standalone core's FIFO has
no CPU timer, so the host drains it when full, before transfer-mode/address
changes, or at the next sample boundary, only while manual transfer is enabled.
Words queued while stopped remain queued until manual transfer is enabled.
DMA retains Play!'s bounded progression (at most 256 write or 16 read blocks
per callback, resumed by its 10,000-tick DMA service). There is no Play! SPU double mix,
software mixer headroom, audition/click guard, host PCM bank, or software
release smoothing in song playback.

Inherited core restrictions fail explicitly with a register address/value:
volume sweeps, nonstandard RAM-control modes, and sample start/repeat addresses
that are only eight-byte aligned. The Play! DMA channel supports incrementing
request-mode DMA4; manual, linked and decrementing transfers fail explicitly
rather than silently moving the wrong data. CPU data-port reads retain the core's
nondestructive register readback; no undocumented manual RAM-read operation is
invented. Overflowing a stopped manual FIFO fails explicitly.
The fixed core still has approximate ADSR and
preset reverb; unrecognized reverb register configurations are not guaranteed
to match hardware. This does not add a full PlayStation BIOS or CPU environment.

## Private numerical diagnostics

The backend reports ABI 3 (`psf_abi_version`) and core model 1 (`psf_spu_model`,
fixed MAME-derived SPU). Read-only `psf_spu_read`, `psf_spu_read_ram`,
`psf_cpu_read_ram` and `psf_spu_frames` support fixtures without another audio
path. `psf_spu_key_gates` returns the CPU KON/KOFF request mask, while
`psf_spu_active_mask` reads the DSP active-voice mask. Neither changes decoder
state. Gate request, current ENV, active state and ENDX are separate: an ENDX
loop marker does not mean a voice stopped. The browser's `observe()` builds a
bounded all-channel snapshot, with at most four ADPCM packets per distinct
programmed sample start. Those first 112 decoded samples use zero initial
history and are a source preview, not the current audible decoder output, a
whole sample or inferred root tuning. Live transport retains bounded snapshots
and selects only one at or before the consumed audio frame. Live Off stops
observation, and Pause retains the frozen audible snapshot.

Optional `psf_trace_start(handle,maxEvents)` enables a bounded trace
(maximum 262,144 events; zero disables it). `psf_trace_count`, `psf_trace_read`
and `psf_trace_overflow` expose four little-endian uint32 fields per event:
`{frame,kind,address,value}`. Kind 1 is a 16-bit register write (byte offset),
kind 2 an actual PIO/DMA 16-bit physical RAM write, and kind 3 a transfer read.
Events occur before the named frame is rendered. DSP replay skips kind-1
writes to FIFO data `0x1a8` and loads kind-2 RAM words directly, avoiding duplicate
FIFO transfers. Tracing is disabled by default and overflow is explicit.

The application Master control still scales preview playback. Sample/ADSR/reverb
settings in the Synth editor do not rewrite the running game driver. PSF2 is not
accepted. Loading a VAB bank alone cannot play a song; a PSF1 entry with its
required libraries and executable game sound driver is needed.
