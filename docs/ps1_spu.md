# Experimental PlayStation SPU

`Ps1Spu` is a standalone, CPU-free MAME-derived SPU instrument core for
Browser, Worker and Node. The same C++ sources expose a C interface for Native
hosts. Each instance owns 24 voices and 512 KiB of RAM and renders stereo PCM
at **44,100 Hz**. It does not open an audio device or resample its output.

The Browser Playground now has experimental **PlayStation (PS1)** mode with
`spu`, 24 physical Keyboard targets and an SPU voice tab. An original sample is
assigned to every voice when audio is prepared; no game files are needed.
Web Audio Main and Worker playback share the same AudioWorklet core. In the
Tauri app, **Audio engine → Native (experimental)** uses the same fixed SDK
C++ core directly, including 24-voice Keyboard audition, PCM/ADSR/reverb editing
and independent additional SPUs. Web Audio remains the default. For normalized mono
PCM, [encodePs1Adpcm](ps1_adpcm_encoder.md) produces the required ADPCM packets.
The package-root low-level `createSoundChip()` factory is a separate API.

## Playground and instrument API

Select **PlayStation (PS1)** from Mode. **Prepare audio** makes Keyboard usable
without Run. The SPU tab selects voices 1–24 and edits their sample, left/right
volume, pitch, named ADSR controls and reverb. Use **Hold to play**, **Play 1
second**, or **Use Keyboard** with the shared Guitar/PC Keyboard to hear the
selected voice. **Sustain play** leaves a manual note held so both hands are
free to edit controls. Its next click or **Release** starts the programmed
release stage. Changing voice, hiding the tab or leaving the window also
releases manual notes. Transport **Stop** immediately clears voices and reverb
tails, including notes whose release rate would otherwise hold indefinitely.
Snapshots update on entry, Refresh and edits; this tab adds no periodic
audio-state polling.

The **PCM cycle → SPU ADPCM** editor draws one looping waveform for the selected
voice. Choose Sine, Triangle, Saw or Square, drag the waveform, or edit one
sample by its index and signed value. Each cycle has 112 normalized PCM samples
in `[-1,1]`. A completed stroke applies once; cancelling a stroke or changing
voice leaves the applied sound intact. **Sustain play** and Keyboard audition
use this waveform with the voice's existing ADSR, pitch, volumes and reverb.

The UI encodes PCM on the preparation side into four SPU ADPCM packets (64 bytes)
and loops them from the first sample. At PITCH 4096 the cycle's fundamental is
`44100 / 112` Hz; note audition uses that tuning automatically. This provides
a wavetable-style editing workflow over PS1 sample RAM. The drawn PCM is the
source, and the resulting sound includes ADPCM quantization and the SPU's
interpolation. An arbitrary uploaded ADPCM instrument has no original PCM in
this editor: choose a shape to replace only the selected voice, or use the
[Sample Editor](ps1_sample_editor.md) for a longer recording.

Each voice lazily obtains one dedicated 64-byte waveform slot. Later edits
reuse its ID and RAM address; other voices and the shared initial sample are
preserved. A slot can be assigned only to its owning voice. Ordinary uploaded
samples remain shareable. Stop and ordinary reset retain waveform RAM;
`reset({clearRam:true})` discards the complete sample bank. When a drawn waveform
is selected, **Copy voice JavaScript** includes its PCM, ADPCM encoding and
upload, tuning and voice settings so the copied instrument can be recreated
in a fresh project.

The ADSR section provides five rate/level controls and four mode switches:

| Control | Accepted values |
| --- | --- |
| `attackRate` / `sustainRate` | Integer `0..127` |
| `decayRate` / `sustainLevel` | Integer `0..15` |
| `releaseRate` | Integer `0..31` |
| `attackExponential` / `sustainExponential` / `releaseExponential` | Boolean |
| `sustainDecrease` | Boolean; decrease toward zero, or increase toward full level |

Rates are the experimental core's raw table indexes, not milliseconds: zero is
fastest and higher codes slow or stop a stage. Sustain level is `(code + 1) / 16`.
Release codes `27..31` hold indefinitely in this implementation. The envelope
drawing is a schematic of the programmed stages, not a measured timing plot.

The enabled-by-default **Apply ADSR / PCM edits while playing** option applies
ADSR edits to the selected sounding voice without restarting its sample or resetting
the current envelope level, including a Release tail after a key is released.
Changing Release rate from `31` to `0` therefore fades out an indefinitely
releasing voice. A rate change affects the active stage; changing
Attack while already sustaining therefore affects the next attack. Disable it
to defer ADSR changes until the next note. PCM edits still restart only this
editor's held audition. Live ADSR edits also update the selected script-owned
voice without changing its note owner. Other voices are unaffected.
With live editing disabled, manual key-off retains the note's latched release
rate just like `keyOff()`; it does not apply pending ADSR register edits.
The next Note On or a changed explicit live ADSR edit applies those settings.
Manual note transitions use a 128-native-frame ramp (about 2.9 ms at 44,100 Hz)
and a minimum fast-release duration to reduce abrupt discontinuities. Longer
programmed releases, including indefinite releases, remain intact. Transport
Stop still silences immediately.
Pitch, fixed volume, reverb sends and reverb return levels affect held voices
without retriggering. **Raw ADSR words and voice JavaScript** retains direct
register editing and provides **Copy voice JavaScript** for use in a script.

For reverb, enable **Selected voice uses reverb**, choose a **Shared reverb
preset** and adjust the independent left/right **Shared return** levels. The
seven supported effects are Room, Studio Small, Studio Medium, Studio Large,
Hall, Space Echo and Half Echo. Each voice has its own send switch, while the
preset and return levels belong to the whole SPU. Return levels add wet sound
to the dry signal; they are not a dry/wet crossfade or Mixer gain. Off bypasses
reverb while retaining the requested return levels for the next preset.
Existing tails are cleared by Stop/reset, rather than by changing presets.

The mode's original default sample has ID 0:

```js
spu.setPreset(23, {sample:0, volumeLeft:0.7, volumeRight:0.4, adsr2:8});
spu.noteOn(23, 'A4');
await beat(1);
spu.keyOff(23);
```

`spu` and `pg.spu` borrow the primary SPU. Playground `useSoundChip('ps1')`
borrows it in PS1 mode; `createSoundChip('ps1')` creates an independent Browser or Native
instance. The primary lifetime belongs to the mode. Each independent instance
has its own 512 KiB sample RAM and 24 voices and is released on Stop.

`loadADPCM(bytes, {rootNote:'C4'})` uploads complete SPU packets with explicit
tuning and returns a sample descriptor. Use exactly one of `rootNote` and
`baseFrequencyHz`. For a loop, supply `loopStartSamples` at a 28-frame packet
boundary with matching packet flags. The helper validates predictor, shift,
packet length, final END, loop markers and available RAM before writing.
Uploads do not resample PCM or encode WAV. The four bundled examples demonstrate
independent stereo voices, an original hand-authored triangle ADPCM sample,
PCM conversion with `encodePs1Adpcm`, and a saved Sample Editor instrument
played from Keyboard. The [PS1 Sample Editor guide](ps1_sample_editor.md) covers
file/microphone input, drawing, loop alignment, actual SPU preview and saving.

`setPreset` / `setChannel` accept sample ID or descriptor, signed normalized
`volumeLeft` / `volumeRight` in `[-1,1]`, raw `adsr1` / `adsr2` words, pitch and
a per-voice boolean `reverb` send. `setEnvelope(channel, partial)` changes named
ADSR fields while preserving the other raw bits. Changed ADSR words update the
current envelope stage without resetting its level or sample position. This
works while Attack, Decay, Sustain or Release is active. Attack settings do not
restart an already-sustaining voice, and Sustain Level remains the Decay target.
`setEnvelope(channel, partial, {live:false})` skips this live refresh. The same
optional third argument works with `setPreset()` and `setChannel()`. Volume-only,
pitch-only, sample-only and unchanged ADSR edits do not refresh pending values.
A later explicit live ADSR edit refreshes the complete registered envelope.
`setReverb({preset, volumeLeft, volumeRight})` changes the shared effect; its
return levels accept `0..1`. Both APIs accept partial updates. Defaults are
`preset:'off'`, requested returns `0.25` on each side, and sends disabled.

```js
spu.setEnvelope(0, {
  attackRate: 35, decayRate: 8, sustainLevel: 10,
  sustainRate: 127, sustainDecrease: true, releaseRate: 13,
});
spu.setPreset(0, {reverb:true});
spu.setReverb({preset:'room', volumeLeft:0.3, volumeRight:0.3});
spu.noteOn(0, 'C4');
```

`ps1_parameters.js` exports `decodePs1Envelope`, `encodePs1Envelope`,
`patchPs1Envelope` and the read-only `PS1_REVERB_PRESETS` list. `getState()`
includes the shared `reverb` settings and each voice's `envelopeParameters`;
its numeric `envelope` field remains the current ENVX register value.
`setFrequency` and `setNote` use the sample's tuning. `getState`, `getPreset` and
`snapshot` are asynchronous on the Playground client. `reset({clearRam:false})`
retains samples and resets voice settings; `clearRam:true` discards the bank.
Stop clears the running decoder/envelopes and reverb tails for immediate silence
while retaining samples, voice presets, sends and shared reverb settings. Reset
restores Off and disables all sends. A host reset also clears resampler history.

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

## Mixer reference level

The Playground **System built-in** preset uses a measured PS1 gain of
`0.128832` for both the primary PS1 and additional `createSoundChip('ps1')`
instances. The optional npm **calibrated** Mixer preset carries the same gain.
This is a Mixer setting: raw SPU/Synth output and explicitly authored or saved
Mixer values are unchanged. Direct rendering still works without a Mixer.

The measurement uses a dedicated original looping sine, one held voice, full
voice volume and sustain, and no reverb. Its filter-0/shift-0 ADPCM reference
has a decoded peak of `0.875`; calibration accounts for that codec headroom and
retains the existing YM2612-based target. The quiet starter uses shift 4, with
sixteen times less amplitude at the codec input, and remains quieter under
this preset.

These are digital single-voice output units, not perceived loudness, multivoice
normalization or measured console hardware volume. Browser captures and offline
Native/WASM comparisons are recorded separately; no physical Native audio
device is measured. See the [PS1 Mixer measurement record](issues/ps1_chip_levels_01.md)
for exact coverage, results and limits.

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
hashes and the fixed SDK release pin, including its source commit, archive hash
and release-manifest hash.
The build verifies the complete fixed snapshot before compilation. Native hosts
compile the four C++17 units listed in [the core README](../third_party/tetorica-soundchip-native/vendor/mame-ps1-spu/README.md)
and include [ps1_spu.h](../third_party/tetorica-soundchip-native/vendor/mame-ps1-spu/ps1_spu.h).

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

The port uses PS1 four-point Gaussian voice interpolation with the documented
512 hardware coefficients and phase bits 4..11. Each signed product is shifted
separately before summing; the previous three decoded frames start at zero on
KON/reset and survive packet/loop boundaries and skipped source frames. Noise
bypasses the filter. This replaces the former linear default without an API
switch. The post-mix device-rate resampler is a separate stage. See
[PSX-SPX](https://psx-spx.consoledev.net/soundprocessingunitspu/#4-point-gaussian-interpolation).
The port retains MAME's floating-point ADSR rate approximations and preset-based
approximate reverb. It is experimental and does
not claim hardware-exact sound or game soundtrack compatibility. Raw ADSR
register writes retain the original core's key-on-latched behavior; the public
Synth ADSR setters explicitly use `refreshEnvelope()` to update a running
stage. Pitch and fixed volumes can also update active voices. The editor uses
`auditionKey()` for smooth manual transitions and preserves its own live-edit
checkbox independently of the normal API default. These are instrument extensions, not hardware register modes.
In this pinned implementation's rate tables, index zero is fastest; higher
indexes are slower or stop. Hardware ADSR presets should not be assumed to
produce cycle-accurate envelopes through these approximations.
Reverb recognizes the pinned core's named register presets; arbitrary reverb
register patterns do not synthesize new effect configurations. Its delays use
private buffers in this approximation and do not reserve hardware reverb space
from the sample RAM allocator. Upstream Echo and Delay entries have no effect
configuration, so they are omitted from the named API and editor.
Standard RAM mapping and fixed volume are supported; unsupported RAM layouts,
volume sweeps and unaligned packet addresses are rejected.

The underlying core may allocate decoded sample caches during rendering; there
is no real-time allocation guarantee. The Browser adapter handles scheduling
and sample-rate conversion with reused buffers.
CPU/DMA/IRQ timing, PSF playback and external XA/CD audio input are not exposed.

The individually BSD-3-Clause-licensed SPU files by pSXAuthor and R. Belmont are
pinned at MAME revision `a64a5d6602b19f67e091a4491f0c851a9dacf79d`.
Pristine upstream files, hashes, notices and adaptation details are retained in
[fixed SDK PS1 sources](../third_party/tetorica-soundchip-native/vendor/mame-ps1-spu/README.md). Binary distributions include their license
and the full standalone source/build recipe.
