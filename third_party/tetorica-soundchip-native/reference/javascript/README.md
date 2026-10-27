# JavaScript ADPCM reference engines

This directory contains the existing Tetorica JavaScript implementations of MSM5205 and OKIM6295. They are synchronous PCM renderers with no audio-device, browser, npm, or other repository dependency. The two engine files are copied byte for byte from the main Tetorica source tree; their packaged hashes and origins are recorded in [the source inventory](../../catalog/source_inventory.json).

These engine files remain unchanged JavaScript references with the direct APIs below, rather than `createSoundChip()`. MSM5205 also has a separate [C11 Native/WASM module](../../vendor/tetorica-msm5205/README.md), preserving the raw register/FIFO behavior and adding a distinct PC Engine RAM playback helper. That compiled module appears under the catalogs' `applicationAudio` entries, not the generic chip factory. OKIM6295 remains reference-only, with no compiled SDK target. Independently pinned upstream C/C++ originals remain separate provenance/reference material, not automatically linked providers.

## Run the example

Use Node.js 22 or later from the SDK root:

```sh
node reference/javascript/examples/render-adpcm.mjs
```

The example writes `msm5205-synthetic.wav` and `okim6295-synthetic.wav` to `build/adpcm-reference/` under the current working directory. Supply an output directory as the optional argument:

```sh
node reference/javascript/examples/render-adpcm.mjs ./my-audio
```

Both files contain two seconds of 22,050 Hz, 16-bit stereo PCM. Each engine is mono, so the left and right channels are identical. The example synthesizes its ADPCM nibbles and OKIM6295 sample table in memory; no game ROM or recorded audio is needed. It prints the output paths, frame counts, and peaks. Its WAV writer clips values to the PCM16 range without changing the engine implementations.

The local `package.json` enables ES module imports and marks this reference directory private. No `npm install` is required.

## Shared rendering API

```js
import {Msm5205AudioEngine} from './msm5205audioengine.js';
import {Oki6295AudioEngine} from './okim6295audioengine.js';
```

Both constructors accept `clock`, `outputSampleRate` (default 44,100), and `masterVolume` (default 1). Each engine provides:

| Method | Behavior |
| --- | --- |
| `sampleRate()` | Returns the configured output frame rate. |
| `processFrames(frames)` | Returns newly allocated `{left, right}` `Float32Array`s. Control writes take effect before the next call. |
| `setMasterVolume(value)`, `getMasterVolume()` | Sets or reads gain, clamped to 0–3.8. |
| `reset()` | Resets decoder and timing state, retaining gain and mute settings. |
| `dispose()` | Releases sample storage held by the engine. |

Mute controls silence the output while decoder timing continues. Rendering and all register writes are synchronous; the caller supplies data and places writes between render calls. Output is not limited to ±1, especially when several voices or attached engines are summed.

## MSM5205

```js
const engine = new Msm5205AudioEngine({
  clock: 384_000,
  flags: 7, // Four-bit ADPCM, external VCLK mode.
  outputSampleRate: 22_050,
});
engine.writeMsm5205(1, 3); // Queue one nibble.
engine.writeMsm5205(2, 0);
engine.writeMsm5205(2, 1); // Rising external VCLK edge decodes it.
const pcm = engine.processFrames(6);
engine.dispose();
```

The chip clock must be an integer from 1 to `0x3fffffff`; the output rate must be an integer from 8,000 to 384,000. `flags` defaults to 4: bits 0–1 select divisors 96, 64, 48, or external VCLK, and bit 2 selects four-bit ADPCM instead of three-bit ADPCM.

`writeMsm5205(register, value)` accepts registers 0–7 and values 0–15. Implemented controls are:

| Register | Control |
| --- | --- |
| 0 | Reset line. A nonzero value silences the output and clears the nibble FIFO. |
| 1 | Queue an ADPCM nibble. The FIFO holds seven entries; writes while full are discarded. |
| 2 | External VCLK line. A low-to-high transition decodes one nibble in external-clock mode. |
| 4 | Prescaler selection, using the low two bits. |
| 5 | ADPCM width: zero selects three bits, nonzero selects four bits. |

Registers 3, 6, and 7 are accepted without an effect. Automatic modes consume queued nibbles according to the chip clock and divider. An empty FIFO holds the decoder's current sample. `setMsm5205Muted(boolean)` controls output mute. `reset()` clears the FIFO and restores the constructor's divider and bit-width selection.

## OKIM6295

```js
const engine = new Oki6295AudioEngine({
  clock: 0x80000000 + 1_000_000, // Bit 31 selects pin 7 high.
  outputSampleRate: 22_050,
});
// rom includes a sample table at byte 0 and ADPCM data at its addresses.
engine.loadOki6295Rom(rom);
engine.writeOki6295(0, 0x80); // Select sample 0.
engine.writeOki6295(0, 0x10); // Start voice 0, volume-table index 0.
const pcm = engine.processFrames(256);
engine.writeOki6295(0, 0x08); // Stop voice 0.
engine.dispose();
```

The constructor's `clock` is an unsigned 32-bit value: the low 30 bits specify a nonzero clock, bit 31 sets pin 7, and the dual-chip flag in bit 30 is rejected. Output rates from 8,000 to 384,000 are accepted. The decoder rate is `clock / 132` with pin 7 high or `clock / 165` with pin 7 low.

`loadOki6295Rom(data, offset = 0, size = offset + data.length)` accepts a `Uint8Array` and a total ROM size of at most 64 MiB. A patch preserves other bytes only when the total size stays unchanged. Changing `size` allocates a new ROM filled with `0xff` before applying the supplied bytes. `clearOki6295Rom()` removes the ROM. `reset()` retains the ROM; `dispose()` removes it.

The ROM sample table uses eight bytes per sample. The first three bytes give the start address and the next three give the inclusive stop address, both big-endian and masked to 18 bits. A sample starts only when its start address is less than its stop address. Nibbles are decoded high first.

`writeOki6295(register, value)` accepts byte values. Register 0 is the command port:

- First write `0x80 | sampleIndex` for sample 0–127, then write a voice mask in the high nibble and a volume-table index in the low nibble. Voice masks are `0x10`, `0x20`, `0x40`, and `0x80`. Selected voices that are already playing are left alone.
- With no pending sample command, a value with bit 7 clear stops voices using masks `0x08`, `0x10`, `0x20`, and `0x40`.

Registers 8–11 update the chip clock as four little-endian bytes, committing when register 11 is written. Register 12 sets pin 7, register 14 sets NMK banking mode, register 15 selects the basic ROM bank, and registers 16–19 select the four NMK banks. Other registers throw an error. `readStatus()` returns `0xf0` plus the four playing-voice bits. `setOki6295Muted(boolean)` controls mute. `supportsState()` returns `false`; this implementation has no state-snapshot API.

## Attaching to an existing engine

The named exports `attachMsm5205(engine, msm)` and `attachOki6295(engine, oki)` mutate an existing renderer with `processFrames`, `reset`, `dispose`, and `getMasterVolume` methods. They sum the ADPCM PCM into its output, apply the primary engine's master volume to that contribution, and extend reset and disposal to both engines. `attachOki6295` also disables combined state snapshots. These helpers do not create an audio device or select a Native/WASM backend.

## Sources and licenses

The retained source headers identify the original authors and BSD-3-Clause licensing. MSM5205 ADPCM/FIFO behavior was adapted from libvgm; OKIM6295 ADPCM and command behavior was adapted from MAME/libvgm. The SDK contains the corresponding notices and license texts:

- MSM5205: [source notice](../../vendor/libvgm-msm5205/README.md), [BSD-3-Clause license](../../vendor/libvgm-msm5205/LICENSE).
- OKIM6295: [source notice](../../vendor/mame-okim6295/README.md), [BSD-3-Clause license](../../vendor/mame-okim6295/LICENSE).

Those component guides also link the included upstream C/C++ originals, commit pins, and hashes. Only upstream files with explicit BSD declarations are collected. Unmarked libvgm support files are omitted; they are not dependencies of these JavaScript engines. The upstream snapshots are not claimed to be the historical port baseline or standalone SDK C/C++ targets.

The engine headers retain historical paths from their source repository to preserve the imported bytes. The links above are the locations within this SDK. New SDK example and documentation code is covered by the root [BSD-3-Clause license](../../LICENSE).
