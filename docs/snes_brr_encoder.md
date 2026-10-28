# PCM to SNES BRR

`encodeBrr()` converts normalized mono `Float32Array` PCM to SNES BRR sample
bytes. It is a synchronous, bounded JavaScript helper for browsers, module
Workers and Node.js; conversion needs no WASM or audio device. BRR compression
is lossy, and the returned metrics describe the reconstruction error.

```js
import {encodeBrr} from 'tetorica-fm2612/snes_brr_encoder.js';

// An original 128-frame sine cycle; no sample file is required.
const pcm = Float32Array.from({length:128}, (_, i) =>
  0.75 * Math.sin(2 * Math.PI * i / 128));
const encoded = encodeBrr(pcm, {loopStartSamples:0});
console.log(encoded.brr, encoded.metrics);
```

When serving this repository's `docs` directory, the browser or module Worker
import is `./js/snes_brr_encoder.js`. The same module works in Node.js. In
Playground scripts, `encodeBrr()` and `pg.encodeBrr()` are available in both
Main and Worker execution modes.

## Input, blocks and capacity

```js
const encoded = encodeBrr(pcm, {
  loopStartSamples:null, // Default: a one-shot. Use an aligned sample index to loop.
  maxBytes:64512,         // Default output-byte budget.
});
```

The input must be a nonempty mono `Float32Array` containing only finite values
in `[-1, 1]`. Conversion preserves the input array. It performs no channel
mixing, gain normalization, clipping or sample-rate conversion. Decode an audio
file, choose the mono channel or mix, and resample explicitly before encoding
when those operations are needed. Unknown option names are rejected.

Each BRR block stores 16 sample frames in 9 bytes. A one-shot adds zero padding
to its final block as needed. A looping input must already have a length that
is a multiple of 16, and `loopStartSamples` must be an integer multiple of 16
inside that input. The loop ends at the input's final frame. Loop positions
always use input/output sample indices, without conversion to bytes or seconds.

The encoder uses filter 0 for the first block and the loop-start block. This
makes those blocks independent of incoming predictor history, so later loop
laps reproduce the same raw PCM. It does not smooth a discontinuous loop seam.
Other blocks search filters 0 through 3 and shifts 0 through 12; hardware special
shifts 13 through 15 are never emitted. Only the final block has END, and it
also has LOOP when a loop was requested.

`maxBytes` accepts integers from 9 through 65,536. Oversized input is rejected
before conversion, with no truncation. The default 64,512-byte budget holds
7,168 blocks or 114,688 frames and fits an empty `SnesSynth`, whose directory
occupies the first 1,024 bytes of RAM. The helper does not inspect a synth's
existing allocations: callers must reduce the budget for samples already
uploaded and keep any custom directory or echo regions separate. Encoding
within the helper's budget does not reserve RAM in a synth.

## Upload and tune the sample

BRR has no stored sample rate or musical root note. At the native S-DSP
`PITCH=4096`, playback consumes 32,000 source frames per second. The generated
128-frame cycle therefore has a known frequency of 250 Hz at that pitch. This
is a declaration based on the source waveform, not inferred tuning.

The following complete Playground script uses the generated loop. Forward the
loop marker only when it is non-null; one-shot `loadBRR()` calls must omit it.

```js
const snes = await useSoundChip('snes');
const pcm = Float32Array.from({length:128}, (_, i) =>
  0.75 * Math.sin(2 * Math.PI * i / 128));
const encoded = pg.encodeBrr(pcm, {loopStartSamples:0});
const options = {baseFrequencyHz:32000 / pcm.length};
if (encoded.loopStartSamples !== null) {
  options.loopStartSamples = encoded.loopStartSamples;
}
const brrSample = await snes.loadBRR(encoded.brr, options);
snes.setPreset(0, {
  sample:brrSample, adsr1:0x8f, adsr2:0xe0,
  volumeLeft:80, volumeRight:80,
});
snes.noteOn(0, 'C4');
await beat(1);
snes.noteOff(0);
```

Keep explicit tuning and the loop marker alongside saved `.brr` bytes. When
using a prepared `SnesSynth` directly, the same `loadBRR()` options apply; see
the Node.js example below for WASM initialization and PCM rendering.

## Results and error metrics

| Field | Meaning |
| --- | --- |
| `brr` | New `Uint8Array` containing complete BRR blocks. |
| `sourceFrames` | Original PCM length. |
| `frames` | Decoded length, equal to `blockCount * 16` and the uploaded sample's `frames`. |
| `paddingFrames` | Added zero frames: `frames - sourceFrames`. |
| `blockCount` | Number of 9-byte blocks. |
| `loopStartSamples` | Validated loop index, or `null` for a one-shot. |
| `metrics.errorFrames` | Number of original frames compared; padding is excluded. |
| `metrics.rmsError` | Root mean square reconstruction error in normalized PCM units. |
| `metrics.maxError` | Largest absolute reconstruction error in normalized PCM units. |
| `metrics.signalRms` | Root mean square of the original PCM. |
| `metrics.snrDb` | `10 * log10(signal energy / error energy)`, or `null` for exact reconstruction or zero signal. |
| `metrics.exact` | Whether every compared source frame was reconstructed exactly. |

Metrics compare the source with exact raw BRR decoding, before S-DSP Gaussian
interpolation, pitch, envelopes, voice volumes, echo and mixing. They measure
codec error rather than the final sound from the DSP. All numeric metrics are
finite, and the metrics object can be saved directly with `JSON.stringify()`.

## Runnable examples

- [Browser Playground](playground/index.html): select the SNES
  `snes-pcm-brr` example and run it in Main or Worker mode. The
  [example source](playground/examples/snes/snes-pcm-brr.js) generates its own PCM.
- [Node.js example](../examples/nodejs/main_snes_pcm_brr.js): writes BRR bytes,
  JSON metadata and a stereo WAV rendered through the actual S-DSP core.

From the repository root:

```sh
node examples/nodejs/main_snes_pcm_brr.js /tmp/snes-pcm-brr
```

The encoder is BSD-3-Clause project JavaScript. SNES playback remains
experimental and uses the separately licensed LGPL-2.1-or-later `snes_spc`
core. This conversion helper introduces no DSP binary changes or bundled game
samples.
