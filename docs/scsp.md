# Experimental Saturn SCSP core

`Scsp` in [web/scsp.js](../web/scsp.js) provides a synchronous raw register,
RAM and PCM interface to the fixed SDK's MAME-derived SCSP instrument.
The same C++ core is available to Native callers as `tetorica::scsp` and
`<tetorica/scsp.h>`.

Each handle owns 32 physical slots and 512 KiB RAM. Output is fixed at 44,100 Hz.
The wrapper injects the generated WASM factory and creates no audio device.
There is no musical voice allocator, file decoder or output resampler here.
This is a local repository API: npm exports, Playground mode/Worklet/Inspector,
the dedicated Synth and Tauri Native audio routing are not integrated yet.
`createSoundChip('scsp')` is not an implemented package entry point.

## Generate original PCM without game files

From the repository root, run this as a Node ES module (`node --input-type=module`).
It returns PCM arrays; it does not play through speakers.

```js
import {readFile} from 'node:fs/promises';
import factory from './docs/generated/scsp_wasm.js';
import {Scsp} from './web/scsp.js';

const chip = await Scsp.create({
  moduleFactory: factory,
  moduleOptions: {wasmBinary: await readFile('./docs/generated/scsp_wasm.wasm')},
});
try {
  const bytes = new Uint8Array(128);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 64; i++) {
    view.setInt16(i * 2, Math.round(8192 * Math.sin(i * 2 * Math.PI / 64)), false);
  }
  chip.loadRam(bytes, 0x1000); // Signed PCM16, big-endian bytes.
  for (const [address, value] of [
    [0x400, 0x020f], // 512 KiB memory mode, master volume 15.
    [0x002, 0x1000], // Slot 0 sample byte address.
    [0x004, 0], [0x006, 64], // Loop start/end in samples.
    [0x008, 31], [0x00a, 0x3c1f], // Fast attack/release, no decay, KRS disabled.
    [0x010, 0], // OCT=0 / FNS=0: one source sample per output frame.
    [0x016, 0xe000], // Direct output level 7, center pan.
    [0x000, 0x1820], // Key-on + execute, forward loop, PCM16.
  ]) chip.write(address, value);

  chip.prepare(128); // Reserve WASM transfer buffers before real-time use.
  const pcm = chip.generateStereo(8192);
  console.log(chip.sampleRate, pcm.left.length); // 44100, 8192.
  chip.write(0, 0x1020); // Clear key bit and execute the release.
  const tail = chip.generateStereo(4410);
  console.log(tail.left.slice(-4)); // Silence after the programmed release.
} finally {
  chip.dispose();
}
```

At this pitch, a 64-sample cycle has a fundamental of `44100 / 64` Hz.
Musical sample tuning will belong to the higher-level Synth API.

## Raw API rules

- `write(byteOffset, value, mask = 65535)` writes selected bits of an aligned
  16-bit register. Addresses are relative byte offsets, not Saturn bus addresses.
- Supported ranges: slot words `0x000..0x3fe`, master `0x400`, DSP ring config
  `0x402`, monitor `0x408`, and ring/DSP reads `0x600..0xee2`.
  Ring/COEF/MADRS/MPRO writes end at `0xbfe`, excluding `0x7c0..0x7fe`.
  The underlying C API rejects unsupported words and master modes before mutation.
- PCM8 is signed. PCM16 RAM bytes are big endian; loop addresses count samples,
  and sample start addresses count bytes. Host RAM transfers reject out-of-range
  spans; internal chip reads wrap within its 512 KiB memory.
- `readRam` returns an owned copy. `renderInto(left, right, frames, offset)`
  requires nonoverlapping `Float32Array` destinations outside WASM memory.
  Inputs are checked before advancing the core. `nativeFrames` counts successful
  rendered frames; reset clears the counter.
- `reset()` resets slots/DSP and mutes the master while retaining RAM.
  `reset({clearRam:true})` clears RAM as well. `dispose()` is idempotent.
- `prepare(frames)` allocates transfer storage for later blocks up to that size.
  The C++ render does not allocate. The JS wrapper creates PCM views during
  transfer, and larger requested blocks can grow its WASM buffers.

## Verification and limits

The original PCM16 sine is bit-identical between Native and WASM for 8,192
stereo frames. Initial tests also cover signed PCM8, stereo pan/slot 31,
finite/clamped 32-slot mixing, release/reset, transfer bounds, partial writes,
owned-handle isolation and render-block partitioning.
These are compatibility/portability checks, not comparisons with real hardware.

FM/LFO/ring/DSP code is retained from the pinned MAME implementation but has not
yet been behaviorally verified. Noise uses a deterministic per-instance software
PRNG, not a verified hardware algorithm. CPU timers/IRQ, DMA, serial MIDI,
external inputs, SSF playback and game-tone import are not provided.
Upstream's EG/DSP approximations remain; raw DAC clipping is retained.

Build from the authenticated fixed SDK:

```sh
sh scripts/build_scsp_wasm.sh
node --test web/scsp.test.mjs
```

Source and attribution are retained in
[the fixed SDK component](../third_party/tetorica-soundchip-native/vendor/mame-scsp/README.md),
with its [BSD-3-Clause license](../third_party/tetorica-soundchip-native/vendor/mame-scsp/LICENSE).
The development checkout is not used by the root build recipe.
See [SCSP TODO](issues/todo_scsp_01.md) for the remaining integration stages.
