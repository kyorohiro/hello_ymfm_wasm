# PCM to PlayStation SPU ADPCM

`encodePs1Adpcm()` converts normalized mono `Float32Array` PCM into complete
16-byte SPU ADPCM packets. It is a pure synchronous helper for Browser, Worker
and Node. It neither starts audio nor changes a Synth, Mixer or input buffer.
Run it during preparation, before starting a live loop.

In Playground it is available as both `encodePs1Adpcm` and `pg.encodePs1Adpcm`.
Module consumers can use either npm subpath:

```js
import {encodePs1Adpcm} from 'tetorica-fm2612/ps1_adpcm_encoder.js';
// Also exported as tetorica-fm2612/ps1_adpcm_encoder.
```

Select **PlayStation (PS1)** mode and open
`examples/ps1/ps1-pcm-adpcm.js` for an editable original sound. It encodes a
waveform, uploads it once through `livePrepare`, then plays a melody. No game
audio, ROM, BIOS or sample file is needed. For example:

```js
const period = 112; // Four 28-frame packets, interpreted at native 44,100 Hz.
const pcm = Float32Array.from({length:period}, (_, i) =>
  0.65 * Math.sin(2 * Math.PI * i / period));
const loopStartSamples = 0;
const encoded = encodePs1Adpcm(pcm, {loopStartSamples});
const instrument = await spu.loadADPCM(encoded.adpcm, {
  baseFrequencyHz:44100 / period,
  loopStartSamples,
});
spu.setPreset(23, {sample:instrument, volumeLeft:0.65, volumeRight:0.55, adsr2:8});
spu.noteOn(23, 'A4');
await beat(1);
spu.keyOff(23);
```

The codec performs no resampling, gain normalization or pitch estimation. Input
must be finite and within `[-1,1]`; out-of-range samples are rejected rather
than clipped. SPU ADPCM stores no sample rate or root note. Declare `rootNote`
or `baseFrequencyHz` separately when uploading it: the declared frequency is
the fundamental at native PITCH 4096, one source sample per 44,100-Hz frame.
Decode file audio to PCM and explicitly handle its channel mix, sample rate and
tuning before using this helper.

| Option | Behavior |
| --- | --- |
| `loopStartSamples` | `null` or omitted for a one-shot. Loops require an in-bounds start and input length both aligned to 28 source samples. |
| `maxBytes` | Integer budget from 16 to 524,288 bytes. Default 520,192 reserves the 4 KiB capture area in an otherwise empty `Ps1Synth`. |

One-shots receive encoded zero PCM padding to a complete 28-frame packet.
Loops are never silently padded or trimmed. The final packet has END; loops
also have LOOP and a matching LOOP START marker, including a single-packet loop.
The caller must account for samples already allocated in the 512 KiB RAM bank.
An explicit larger codec budget does not increase a Synth's available RAM.

The result contains `adpcm`, `sourceFrames`, `frames`, `paddingFrames`,
`blockCount` and `loopStartSamples`. `frames` includes padding. Byte data and
loop/tuning metadata should be saved together; the bytes alone cannot retain
that metadata. This codec is different from SNES BRR and Yamaha ADPCM-A/B.

`metrics` contains `rmsError`, `maxError`, `signalRms`, `errorFrames`, `snrDb`
and `exact`. It compares original frames with raw reconstructed signed 16-bit
PCM divided by 32768; padding is excluded. Metrics precede SPU interpolation,
envelopes, pitch, volume and effects. `snrDb` is `null` for an exact result or a
zero signal, with `exact` distinguishing those cases. All metrics are JSON-safe.

The encoder searches filters 0–4 and shifts 0–12, selecting the smallest packet
error with greedy nearest signed nibbles. First and loop-start packets use
filter 0 so their output is independent of prior decoder history. Candidates
requiring 16-bit overflow are excluded. It follows the pinned decoder's rounding
and packet order, but this is a lossy encoder rather than a globally optimal
codec or a hardware-accuracy claim. Working memory is output plus fixed packet
scratch arrays; conversion is preparation work, not an AudioWorklet operation.

For an actual SPU-rendered preview and reusable sample metadata:

```sh
node examples/nodejs/main_ps1_adpcm.js /tmp/ps1-adpcm
```

This writes `.loop.adpcm`, `.hit.adpcm`, `.json` and a stereo `.wav`; existing
files at the same prefix are overwritten. It does not play through an audio
device. Native and WASM decoder tests compare reconstructed PCM and actual
SPU output. The [PS1 Sample Editor](ps1_sample_editor.md) adds file/microphone
input, drawing, fixed-rate conversion, visible packet alignment, actual SPU
preview and reusable source/edit assets for Keyboard instruments.

## Short periodic waveforms

`encodePs1AdpcmCycle(pcm)` accepts exactly 112 Float32 samples and returns four
looping packets. It evaluates cyclic prediction using the last two source
samples as the initial history candidate. The candidate and the ordinary
independent-start encoding are scored against the SPU's repeated-cycle decode:
one initial pass followed by a pass using that decoder's final history.
An overflow in either pass rejects the candidate; the ordinary packets remain
the fallback when cyclic prediction does not reduce error. Returned metrics
describe the repeated pass. This keeps smooth waves such as Sine from acquiring
a coarse filter-0 staircase at every loop start. General recording encoding
with `encodePs1Adpcm` keeps its existing independent entry points and output.
