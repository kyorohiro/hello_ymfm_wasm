# PCM to Neo Geo ADPCM-A

`encodeAdpcmA()` converts normalized mono Float32 PCM to Yamaha ADPCM-A bytes
for the six one-shot sample voices on YM2610 and YM2610B. The same bounded,
synchronous JavaScript helper works in browsers, module Workers and Node.js.
Conversion itself needs no audio device or WASM. ADPCM-A compression is lossy.

```js
import {encodeAdpcmA} from 'tetorica-fm2612/adpcm_a_sample.js';

const decodedRate = 8000000 / 432;
const pcm = Float32Array.from({length:Math.ceil(decodedRate * 0.1)}, (_, i) => {
  const time = i / decodedRate;
  const fade = Math.min(1, i / 20, (Math.ceil(decodedRate * 0.1) - 1 - i) / 80);
  return 0.5 * Math.sin(2 * Math.PI * 220 * time) * Math.exp(-time * 30) * fade;
});
const encoded = encodeAdpcmA(pcm);
console.log(encoded.bytes.length, encoded.metrics);
```

In Playground, use the global `encodeAdpcmA()` or `pg.encodeAdpcmA()` in Main
or Worker execution. When serving the repository's docs directory directly,
module consumers can import `./js/adpcm_a_sample.js`.

## Source rate, memory and playback

ADPCM-A has a fixed decoded rate of `chipClock / 432`; at 8 MHz this is
approximately 18,518.52 samples per second. This differs from the core's PCM
output rate and from the browser audio device rate. The helper preserves every
source frame and does not resample, mix channels, normalize, clip, infer tuning,
or introduce pitch or hardware loop controls. For decoded recordings, choose or
mix a mono channel and resample explicitly to the intended decoded rate first.
Changing the chip clock also changes ADPCM-A playback speed and duration.

The input must be a nonempty `Float32Array` of finite values in `[-1,1]`. It is
never modified. Options accept only `maxBytes`, an integer from 256 through
`0xfff00` (1,048,320), also the default. Oversized input is rejected before
encoding, without truncation. The limit is per sample and is strictly below the
current voice API's 1-MiB range limit; it does not allocate or reserve ROM.

One byte holds two samples, high nibble first. Sample start and exclusive end
addresses must be multiples of 256 bytes. The helper adds zero PCM to the next
512-frame / 256-byte boundary and encodes it with the continuing predictor.
Writing zero compressed bytes would not produce silence. Even encoded zero
PCM has a small quantization floor; EOF or key-off stops output completely.
Padding may extend playback by up to 511 decoded frames. The helper does not
fade or smooth source endpoints; prepare fades explicitly when wanted.

Pack samples into non-overlapping aligned ranges within the caller-managed
16-MiB ADPCM-A ROM space. Each sample begins with codec state zero, as on
hardware key-on. All six voices share this A memory, while ADPCM-B uses a
separate ROM and a different codec. The new helper is for Neo Geo sample ROM
playback; it does not replace YM2608's fixed rhythm sounds.

This complete Playground script runs in either Neo Geo mode:

```js
const rate = fm.clock / 432;
const count = Math.ceil(rate * 0.1);
const pcm = Float32Array.from({length:count}, (_, i) =>
  0.4 * Math.sin(2 * Math.PI * 220 * i / rate) *
  Math.min(1, i / 20, (count - 1 - i) / 80));
const encoded = pg.encodeAdpcmA(pcm);
await adpcmA.loadMemory(encoded.bytes, 0);
adpcmA.setSample(0, {start:0, end:encoded.bytes.length});
adpcmA.setVolume(56);
adpcmA.setVoice(0, {volume:27, left:true, right:true});
adpcmA.keyOn(0);
await sleep(encoded.frames / rate + 0.02); // Includes the padded hardware range.
adpcmA.keyOff(0);
```

Uploading at address zero replaces any existing A samples there. Choose a bank
layout when retaining multiple samples. A channels are numbered 0 through 5;
`keyOn([0, 2, 5])` triggers several, and each ends at its selected range.

## Results and quality

| Field | Meaning |
| --- | --- |
| `bytes` | New `Uint8Array`, a multiple of 256 bytes. |
| `sourceFrames` | Original PCM frame count. |
| `frames` | Decoded padded frame count, equal to `bytes.length * 2`. |
| `paddingFrames` | `frames - sourceFrames`. |
| `metrics.rmsError` | Raw reconstruction RMS error, normalized to signed 12-bit PCM / 2048. |
| `metrics.maxError` | Largest absolute raw normalized error. |
| `metrics.signalRms` | Original normalized signal RMS. |
| `metrics.errorFrames` | Original frames compared; padding is excluded. |
| `metrics.snrDb` | Signal/error energy ratio in dB; `null` for exact reconstruction or zero input. |
| `metrics.exact` | Whether all compared source frames reconstruct exactly. |

Metrics are finite or `null`, so the object can be saved directly as JSON.
They measure the codec before hardware attenuation, stereo gates, mixing and
output resampling. Sound and error depend on the source: rapid changes and
noise can have more distortion than slowly changing waveforms.

For every source or padding frame, the encoder searches all 16 nibbles using the
ymfm ADPCM-A decoder's integer arithmetic, 49 step values, and wrapping signed
12-bit predictor. Ties prefer the lower unsigned nibble. This is a deterministic
greedy encoder; it does not claim globally optimal encoding.

## Runnable examples

- [Playground six-voice percussion](playground/examples/neogeo/neogeo-adpcm-a-drums.js):
  select either Neo Geo mode and create a New Cassette to obtain the bundled
  Example. Original PCM drums are generated at `fm.clock / 432`, packed into
  one ROM and played through the primary chip, without a Mixer override.
- [Node example](../examples/nodejs/main_neogeo_adpcm_a.js): writes a packed
  `.adpcma` bank, range/conversion JSON, and an actual YM2610/B-rendered stereo WAV.

```sh
node examples/nodejs/main_neogeo_adpcm_a.js /tmp/neogeo-drums ym2610
node examples/nodejs/main_neogeo_adpcm_a.js /tmp/neogeo-b-drums ym2610b
```

The helper and examples use the project's BSD-3-Clause licensing, with ymfm
attribution retained. No game recording, instrument ROM, or DSP binary change
is included. Sample Editor integration remains a separate task.
