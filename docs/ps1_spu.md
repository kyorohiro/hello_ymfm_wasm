# Experimental PlayStation SPU

`Ps1Spu` is a standalone, CPU-free MAME-derived SPU instrument core for
Browser, Worker and Node. The same C++ sources expose a C interface for Native
hosts. Each instance owns 24 voices and 512 KiB of RAM and renders stereo PCM
at **44,100 Hz**. It does not open an audio device or resample its output.

The Browser Playground now has experimental **PlayStation (PS1)** mode with
`spu`, 24 physical Keyboard targets and an SPU voice tab. An original sample is
assigned to every voice when audio is prepared; no game files are needed.
Main and Worker playback share the same AudioWorklet core. The Native audio
backend, general PCM encoder and fixed soundchip SDK adoption are future work.
The package-root low-level `createSoundChip()` factory is a separate API.

## Playground and instrument API

Select **PlayStation (PS1)** from Mode. **Prepare audio** makes Keyboard usable
without Run. The SPU tab selects voices 1–24 and edits their sample, left/right
volume, pitch and raw ADSR words. Use Hold to play, Play 1 second or the shared
Guitar/PC Keyboard to hear the selected voice. Snapshots update on entry,
Refresh and edits; this tab adds no periodic audio-state polling.

The mode's original default sample has ID 0:

```js
spu.setPreset(23, {sample:0, volumeLeft:0.7, volumeRight:0.4, adsr2:8});
spu.noteOn(23, 'A4');
await beat(1);
spu.keyOff(23);
```

`spu` and `pg.spu` borrow the primary SPU. Playground `useSoundChip('ps1')`
borrows it in PS1 mode; `createSoundChip('ps1')` creates an independent Browser
instance. The primary lifetime belongs to the mode. Each independent instance
has its own 512 KiB sample RAM and 24 voices and is released on Stop.

`loadADPCM(bytes, {rootNote:'C4'})` uploads complete SPU packets with explicit
tuning and returns a sample descriptor. Use exactly one of `rootNote` and
`baseFrequencyHz`. For a loop, supply `loopStartSamples` at a 28-frame packet
boundary with matching packet flags. The helper validates predictor, shift,
packet length, final END, loop markers and available RAM before writing.
Uploads do not resample PCM or encode WAV. The two bundled examples demonstrate
independent stereo voices and an original hand-authored triangle ADPCM sample.

`setPreset` / `setChannel` accept sample ID or descriptor, signed normalized
`volumeLeft` / `volumeRight` in `[-1,1]`, raw `adsr1` / `adsr2` words and pitch.
`setFrequency` and `setNote` use the sample's tuning. `getState`, `getPreset` and
`snapshot` are asynchronous on the Playground client. `reset({clearRam:false})`
retains samples and resets voice settings; `clearRam:true` discards the bank.
Stop clears the running decoder/envelopes for immediate silence while retaining
samples and presets. A host reset also clears resampler history.

On the Playground client, `reset()` is immediate preparation rather than a
scheduled note event. It clears prior queued notes; subsequent voice commands
retain their normal Worker lead. If an upload was already in flight, its promise
rejects with `AbortError` after reset. Its sample remains available when RAM is
retained; `clearRam:true` discards it. Bank IDs stay consistent for later uploads.

For direct Node/Browser rendering, construct `new Ps1Synth({core:spuCore})`
from `ps1synth.js`, upload `createPs1InitSample().adpcm`, assign it and render
through the Synth or a `Ps1Resampler(synth, outputRate)`. Synth operations are
synchronous when directly attached to the core; the Playground client uses
ordered messages. The resampler reuses buffers, preserves phase between quanta,
and batches only the frames needed for the current segment. Output at 44.1 kHz
uses direct blocks with no resampling. No Mixer compensation is applied by the
Synth or starter.

## Build and run

With Emscripten and Python 3 installed:

```sh
sh scripts/build_ps1_spu_wasm.sh
node --test web/ps1_spu.test.mjs
node examples/nodejs/main_ps1_spu.js /tmp/ps1-spu
```

The example authors a looping sine and a one-shot percussion sample, plays a
melody through voices 0 and 23, and saves a three-second stereo WAV, metadata
JSON and two raw ADPCM samples. It uses no BIOS, ROM, game recording or external
sample. The output prefix is optional; without it, files are written beside
the script. Existing output files with the same names are overwritten.

`docs/generated/ps1_spu_build.json` records the exact source, recipe and output
hashes. The build rejects sources changed during compilation. Native hosts
compile the four C++17 units listed in [the core README](../native/ps1/README.md)
and include [ps1_spu.h](../native/ps1/ps1_spu.h).

## JavaScript interface

Inject the generated ES-module factory. No AudioContext is created:

```js
import {Ps1Spu} from './js/ps1_spu.js';
import moduleFactory from './generated/ps1_spu_wasm.js';

const spu = await Ps1Spu.create({moduleFactory});
try {
  // Four filter-0 packets: one 112-frame sine period, low nibble first.
  const sample = new Uint8Array(64);
  for (let block = 0; block < 4; block++) {
    const start = block * 16;
    sample[start] = 4; // Predictor 0; shift 4.
    sample[start + 1] = block === 0 ? 6 : block === 3 ? 3 : 2;
    for (let i = 0; i < 28; i++) {
      const n = Math.round(7 * Math.sin(2 * Math.PI * (block * 28 + i) / 112));
      sample[start + 2 + (i >> 1)] |= (n & 15) << ((i & 1) * 4);
    }
  }
  spu.loadRam(sample, 0x2000);
  spu.write(0x180, 0x3fff); spu.write(0x182, 0x3fff); // Master L/R.
  spu.write(0x1aa, 0xc000); // Enable and unmute.
  spu.write(0, 0x3fff); spu.write(2, 0x3fff); // Voice 0 L/R.
  spu.write(4, Math.round(4096 * 440 / (44100 / 112))); // A4.
  spu.write(6, 0x2000 >> 3); spu.write(14, 0x2000 >> 3);
  spu.write(8, 0x000f); spu.write(10, 8); // Fast attack, short release.
  spu.write(0x188, 1); // Key on voice 0.
  const {left, right} = spu.generateStereo(44100);
  // Send these owned arrays to an audio host configured for 44,100 Hz,
  // or explicitly resample them to the host rate.
  spu.write(0x18c, 1); // Key off; continue rendering for the release.
  const release = spu.generateStereo(4410);
} finally {
  spu.dispose();
}
```

For Node, pass `moduleOptions:{wasmBinary:await readFile(wasmUrl)}` as in the
example. The npm subpaths are `tetorica-fm2612/ps1_spu.js` and
`tetorica-fm2612/generated/ps1_spu_wasm.js`.

| Operation | Behavior |
| --- | --- |
| `write(byteOffset, value)` / `read(byteOffset)` | Even register offsets `0..0x3fe`, relative to `0x1f801c00`; values are unsigned 16-bit. |
| `loadRam(bytes, address)` | Copy already encoded SPU ADPCM/raw RAM bytes. It does not encode PCM or decode WAV. |
| `readRam(address, length)` | Return an independently owned RAM copy. |
| `generateStereo(frames)` | Return owned `{left,right}` Float32 arrays. Maximum 1,048,576 frames per call. |
| `renderInto(left, right, frames, offset)` | Write into caller-owned, nonoverlapping Float32 ranges. |
| `sampleRate` / `nativeFrames` | Fixed rate and generated frame count since creation/reset. |
| `reset({clearRam:false})` | Reset voices, registers, effects and frame count; retain RAM by default. |
| `dispose()` | Release the instance. Previously returned arrays remain valid. |

Voice registers use a 16-byte stride. Start/repeat register values count eight
bytes, but this port requires **16-byte packet alignment**. Put samples at or
above RAM address `0x1000`; lower RAM contains capture buffers written during
rendering. SPU ADPCM has 16-byte packets yielding 28 PCM frames; its format is
different from SNES BRR and Yamaha ADPCM-A/B.

Pitch `0x1000` advances the sample at its original 44,100 Hz rate. For a waveform
containing exactly one period of N decoded frames, use
`round(4096 * targetHz / (44100 / N))`. Arbitrary recorded samples need explicit
root-note/tuning metadata. Raw ADPCM stores no sample rate or root note.

## Scope and accuracy

The port retains MAME's linear interpolation, floating-point ADSR rate
approximations and preset-based approximate reverb. It is experimental and does
not claim hardware-exact sound or game soundtrack compatibility. ADSR changes
apply at the next key-on; pitch and fixed volumes can update active voices.
In this pinned implementation's rate tables, index zero is fastest; higher
indexes are slower or stop. Hardware ADSR presets should not be assumed to
produce cycle-accurate envelopes through these approximations.
Standard RAM mapping and fixed volume are supported; unsupported RAM layouts,
volume sweeps and unaligned packet addresses are rejected.

The underlying core may allocate decoded sample caches during rendering; there
is no real-time allocation guarantee. The Browser adapter handles scheduling
and sample-rate conversion with reused buffers.
CPU/DMA/IRQ timing, PSF playback and external XA/CD audio input are not exposed.

The individually BSD-3-Clause-licensed SPU files by pSXAuthor and R. Belmont are
pinned at MAME revision `a64a5d6602b19f67e091a4491f0c851a9dacf79d`.
Pristine upstream files, hashes, notices and adaptation details are retained in
[native/ps1](../native/ps1/README.md). Binary distributions include their license
and the full standalone source/build recipe.
