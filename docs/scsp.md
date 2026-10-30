# Experimental Saturn SCSP core

`Scsp` in [web/scsp.js](../web/scsp.js) provides a synchronous raw register,
RAM and PCM interface to the fixed SDK's MAME-derived SCSP instrument.
The same C++ core is available to Native callers as `tetorica::scsp` and
`<tetorica/scsp.h>`.

Each handle owns 32 physical slots and 512 KiB RAM. Output is fixed at 44,100 Hz.
The wrapper injects the generated WASM factory and creates no audio device.
There is no musical voice allocator, file decoder or output resampler here.
This is a local repository API. The Web Audio Playground mode/Worklet and initial
slot inspector / PCM and envelope editor are integrated. npm exports, the dedicated Synth UI and Tauri
Native audio routing are not integrated yet.
`createSoundChip('scsp')` is available inside Playground; this is not an npm package entry point.

## Try it in Playground

Open [Playground in Saturn mode](playground/index.html?mode=scsp). Choose **SCSP →
Prepare audio**, then **Hold to play**, or choose **Saturn SCSP / PCM slot 32** in
Keyboard and play with the computer keyboard. Opening the mode alone creates no
audio device. The slot inspector shows all 32 configurations and sample RAM use;
the editor supports waveform drawing, PCM8/16 conversion and hardware EG codes.

1. Select a physical slot, then an existing PCM or **Sine / Triangle / Saw / Square**.
2. Draw on the single waveform canvas. Set root frequency, source sample rate,
   format and loop start (`-1` means one shot), then click **Apply PCM to this slot**.
3. Play a new note. PCM assignment and EG edits take effect at the next keyOn;
   TL / direct level / pan are explicit live controls.
4. **Copy voice JavaScript** exports the applied PCM, tuning, loop, EG and mix.
   Paste it into Code and Run to recreate the voice without private bank IDs.
   The generated text is also available when clipboard permission is unavailable.

Waveform drawing is a software authoring tool. Dragging does not write RAM.
Apply allocates a new sample without overwriting shared or currently sounding PCM;
old allocations remain until `reset({clearRam:true})` or runtime recreation.
The RAM counter shows the remaining capacity. Selecting another slot or assigned
sample discards an unapplied draft. There is no per-sample deletion or audio-file
picker in this panel yet; JavaScript-loaded PCM appears in its sample selector.
EG controls show SCSP register codes, not approximate milliseconds. Higher rate
codes are faster; KRS 15 disables scaling. The requested gate is not an EG meter.

**Run** starts the original sine melody. The editable
`examples/scsp/scsp-stereo-pcm.js` uploads signed PCM16 and plays two stereo slots.
Both Main and Worker use the same SCSP AudioWorklet. Stop immediately silences
held/infinite releases and cancels future notes; the primary sample bank remains
available until explicitly reset or the audio runtime is recreated.

```js
const saturn = await useSoundChip('scsp'); // Reuses this mode's primary.
saturn.noteOn(31, 'A4');
// Later:
saturn.keyOff(31);
```

`await createSoundChip('scsp', {id:'saturn-extra'})` creates an independent
32-slot / 512 KiB instance in Web Audio. Dispose additional instances when done.
The browser facade has the musical API below, with asynchronous `loadPCM` and
`getState`. Samples carry a bank identity so a cloned handle cannot accidentally
select the same numeric ID in another instance. PCM uploads are preparation
barriers; Worker note controls retain the normal lookahead schedule.

Host output at 44.1/48/96 kHz uses the streaming converter shared with PS1; the
SCSP core itself always runs at 44.1 kHz. No extra output compensation is applied.
SCSP currently uses neutral Mixer gain (1), **without listening calibration**.
Native audio, SSF/68000 execution, DSP and slot FM controls remain later stages.

## Musical PCM API

`ScspSynth` in [web/scspsynth.js](../web/scspsynth.js) wraps an exclusively owned
`Scsp`. Local TypeScript declarations are supplied for both classes. It takes
signed `Int8Array` / `Int16Array` PCM, supplies big-endian RAM encoding, named EG
fields, note names/MIDI notes, live frequency and hardware mix controls.
It creates no AudioContext. The Playground layer supplies its audio device and transport.

After creating `chip` as in the raw example below:

```js
import {ScspSynth, createScspInitSample} from './web/scspsynth.js';

const synth = new ScspSynth(chip); // Resets registers; owns/disposes chip.
try {
  const initial = createScspInitSample();
  const sample = synth.loadPCM(initial.pcm, initial.options);
  synth.setPreset(0, {
    sample,
    envelope: {attackRate: 31, releaseRate: 24},
    totalLevel: 12, // Hardware attenuation, 0 is loudest.
  });
  synth.noteOn(0, 'C4'); // Slot 0, not automatic polyphonic allocation.
  const held = synth.generateStereo(44100);
  synth.setNote(0, 'E4'); // Live pitch change, without retrigger.
  synth.noteOff(0);
  const tail = synth.generateStereo(44100);
  // held / tail contain native-rate stereo PCM, not an audio device.
} finally {
  synth.dispose();
}
```

- Slots are explicit integers 0..31. `noteOn(slot, note)` retriggers that slot;
  `keyOn(slot)` uses its authored frequency. Other held slots keep their gates.
- `loadPCM` requires exactly one `rootNote` or `baseFrequencyHz`. This describes
  the original waveform at `sourceSampleRate` (default 44100), not the desired
  playback note. The original 64-sample sine has a root of 44100/64 Hz.
- Each waveform contains 2..65535 samples. Omit `loopStartSamples` for a one shot,
  or specify a forward loop `[loopStartSamples, pcm.length)`. Reverse/ping-pong
  modes remain raw-core features awaiting a high-level verification pass.
- Pitch is quantized to hardware OCT/FNS. Out-of-range values are rejected;
  the realized ratio is returned by `scspPitch`, and `setFrequency` / `setNote`
  return the realized frequency of the sounding sample. Steps longer than a
  forward loop are rejected because this inherited core wraps once per frame.
- `setPreset` and `setEnvelope` author the **next keyOn**. `setFrequency`,
  `setNote` and `setMix` are live controls. Pending sample changes do not alter
  the tuning reference of a sample that is already sounding.
- Envelope fields are `attackRate`, `decay1Rate`, `decay2Rate`, `decayLevel`,
  `releaseRate` (0..31), and `keyRateScaling` (0..15, 15 disables scaling).
  Rates are hardware codes, with larger values faster, not milliseconds.
  Defaults are immediate attack/release and no decay. The inherited EG is an
  approximation; its initial gain is not guaranteed to be exactly unity.
- Mix fields are `totalLevel` (0..255 attenuation), `directLevel` (0..7 send),
  and raw `pan` / DIPAN (0..31). Pan 0 is center, 15 right-only, 31 left-only.
  These are hardware codes rather than linear sliders. Summed output retains
  core clipping; choose attenuation for chords. No extra gain compensation is added.
- RAM is a 512 KiB append-only bank. Each allocation is two-byte aligned and
  includes one interpolation guard sample; `getState()` reports allocated/free
  bytes. This initial direct-output API reserves no RAM for custom DSP programs.
  Input PCM is copied and returned sample descriptors are frozen and bank-owned.
  There is no individual unload/replace/compaction yet.
- `allNotesOff()` starts releases, which may be infinite. `stopVoices()` silences
  immediately while retaining samples/presets. It resets the native frame clock;
  a downstream resampler must also be reset to discard held interpolation frames.
- `reset()` clears presets/gates but retains the bank. `reset({clearRam:true})`
  clears it and invalidates all previous descriptors. IDs are not reused.
  `dispose()` also disposes the exclusively owned core. Do not mix raw core
  register/RAM writes with this adapter.
- State slots contain authored presets and requested gates, not an envelope or
  active-slot meter; a one shot can end while its requested gate remains true.

Verify without audio devices or commercial game files:

```sh
node --test web/scsp.test.mjs web/scspsynth.test.mjs
./node_modules/.bin/tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 web/scspsynth.types.test.ts
```

These checks use the real WASM core. Further checks:

```sh
node --test web/playground_scsp_worklet.test.mjs web/ps1_resampler.test.mjs
node scripts/check_playground_scsp_browser.cjs
```

The browser checker covers Chromium/WebKit and Main/Worker, with physical output
muted throughout. This is PCM/transport verification, not a human listening test.

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

The pinned generated SCSP loader does not consume `wasmBinary` itself in an
AudioWorklet. `Scsp.create` explicitly compiles supplied bytes and installs the
loader's `instantiateWasm` hook. Invalid supplied bytes fail instead of silently
loading a different file. No SDK source, pin or generated WASM modification is
needed for this bridge.
