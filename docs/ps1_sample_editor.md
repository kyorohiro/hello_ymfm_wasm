# PlayStation SPU Sample Editor

The experimental **PlayStation (PS1)** mode can turn recorded, imported or drawn
audio into a 24-voice Keyboard instrument. The editor and instrument loader use
one conversion path: edited mono PCM at **44,100 Hz**, followed by PS1 SPU ADPCM.
This workflow currently uses **Web Audio**, including Main and Worker playback.
The Tauri Native audio adapter is future work.

## Record, edit and play

1. Select **PlayStation (PS1)** mode, then **Menu → Sample Editor…**.
2. Choose **Audio file**, **Record microphone**, or **Draw a cycle**. Recording
   requires microphone permission; file formats depend on the browser decoder.
3. Select **PS1 SPU · 24 voices** as the instrument. Choose a region, adjust gain
   and fades, or zoom in and use **Draw samples**. Set the **Root note** and
   **Tuning (cents)**; **Detect pitch** can suggest a starting point.
4. Compare the edited and decoded waveforms, then choose **Preview PS1 SPU**.
   For a sustained sound, enable **Loop** and inspect its requested/applied range.
5. Leave **Save in Cassette** enabled and save to
   `/samples/sampler.sample.json`. In the standalone editor the final button is
   **Save sample**; when a script opens the editor it is **Use audio**.
6. Run `examples/ps1/ps1-sampler.js`, open **Keyboard**, and play with Guitar,
   PC keys or the pointer. Selecting the saved `.sample.json` file opens it for
   further editing; Run the sampler again to apply the changes.

The example opens the editor if the saved sample is missing. Its essential code
is also usable in your own PS1 script:

```js
const audio = await inputAudio({
  asset: '/samples/sampler.sample.json', edit: false, target: 'ps1',
});
if (audio) {
  keyboard.bind('ps1-sampler', await createSampleInstrument(audio, {target: 'ps1'}));
}
```

## Conversion, loops and tuning

Selection, drawing, gain and fade edits refer to the original decoded audio.
Conversion mixes its channels to mono and resamples to 44,100 Hz. The PS1 rate
is fixed; changing root-note metadata does not destructively resample the source.

Each 16-byte ADPCM packet represents **28 PCM frames**. For a loop, the converter
first maps the loop markers into the resampled selection, then moves the start
up and the end down to complete packet boundaries. The intro before the loop
is retained; the tail after the applied loop end is omitted. A range with no
complete 28-frame loop is rejected. The editor shows both requested and applied
ranges, seconds and omitted tail frames. Your original recording and edit
markers remain unchanged. A one-shot keeps its selected frames and zero-pads
only the final packet; the padding count is displayed.

The declared source frequency at SPU PITCH 4096 is
`440 * 2 ** ((rootMidi - 69 + tuneCents / 100) / 12)`. Keyboard notes use this
metadata to calculate hardware pitch. A positive cents value describes a source
above the chosen root, so playing that root applies the corresponding downward
correction. Arbitrary recordings are not assumed to contain a single cycle.

The comparison plots show the PCM before encoding and the **raw reconstructed
ADPCM PCM**, with RMS/max error and SNR. Their display data is bounded to 256
points per waveform. These measurements precede SPU pitch interpolation, ADSR,
volume and effects. **Preview PS1 SPU** instead renders an isolated real SPU
instance for 0.85 seconds at the same root key used by Keyboard, including cents
correction. It uses the default voice level, no additional Mixer compensation,
and short endpoint fades. The private instance is released after rendering;
preview does not change the live SPU or its sample bank.

## Saved source and RAM limits

The Cassette stores `/samples/sampler.wav` as neutral Float32 PCM WAV and
`/samples/sampler.sample.json` as source metadata and non-destructive edits.
The WAV preserves the decoded source PCM, not the original compressed file's
bytes. PS1 ADPCM is regenerated from these assets when preparing the instrument;
the source asset remains reusable by other supported instrument targets.

An empty `Ps1Synth` has **520,192 bytes** for sample uploads after its 4 KiB
capture area. The whole selected region must fit the conversion budget before
resampling, even when a short loop would later omit a long tail. This bounds
temporary PCM allocation. Shorten the selection if requested; the rest of the
recording remains available. The default budget permits about 20.64 seconds at
44,100 Hz, before considering other samples in the live bank.

The live upload separately checks the bank's actual remaining space. The mode's
initial sample and previous uploads share that bank. Repeated Run/Stop reuses
an existing sample only when its tuning, loop metadata and **actual current RAM
bytes** match. Changed audio needs a new allocation; Stop preserves the bank.
`spu.reset({clearRam:true})` explicitly clears all uploaded samples when a fresh
bank is needed.

## Module helpers

The source-tree npm package build includes these helpers; package publication
is a separate step:

```js
import {renderPs1Sample, renderPs1SampleComparison}
  from 'tetorica-fm2612/playground_sample_ps1.js';
import {renderPs1SamplePreview}
  from 'tetorica-fm2612/playground_sample_ps1_preview.js';

const converted = renderPs1Sample(audio, editSettings);
const comparison = renderPs1SampleComparison(audio, editSettings);
const preview = await renderPs1SamplePreview(audio, editSettings, {
  moduleFactory, moduleOptions: {wasmBinary},
});
```

Conversion and comparison are pure synchronous preparation helpers. Preview
requires the generated PS1 WASM factory, renders owned stereo PCM offline and
opens no audio device. `renderPs1Sample()` accepts `{maxBytes}` as its third
argument; preview accepts the same limit alongside its factory options.

See [the encoder format and metrics](ps1_adpcm_encoder.md) and
[the experimental SPU's scope and accuracy](ps1_spu.md).
