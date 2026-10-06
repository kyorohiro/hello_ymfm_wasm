# tetorica-fm2612

Tetorica sound-chip cores, Synth helpers and browser audio runtime, distributed as
ES modules with prebuilt WASM. The package retains the existing web runtime;
its default entry point provides chip creation without starting browser audio.

## Install

```sh
npm install tetorica-fm2612
```

## Included sound chips

| Family | Chips |
| --- | --- |
| Yamaha OPN | YM2203, YM2608, YM2610/YM2610B, YM2612, YM3438, YMF276, YMF288 |
| Yamaha OPM | YM2151 |
| Yamaha OPL | YM2413, YM3526, YM3812, Y8950, YMF262, YMF278B |
| PSG and console audio | AY8910, Sega PSG, Game Boy APU, HuC6280, K051649 |
| PCM and ADPCM | RF5C164, Sega PCM, OKIM6258, OKIM6295 |

YM2612 includes ymfm and Nuked-OPN2 backends. YM2610 uses the YM2610B core
with `variant: false`; OKIM6295 is implemented in JavaScript. The distribution
includes 23 generated JS/WASM pairs. Chip and high-level Synth API coverage differ.

## Node.js: generate PCM

Node.js 22 or later. No AudioContext, Worker or native audio driver is required.

```js
import {createSoundChip} from 'tetorica-fm2612';
import {YM2612Synth, YM2612DirectTransport} from 'tetorica-fm2612/ym2612synth';
import {FM_PRESETS} from 'tetorica-fm2612/megasynth-fm-presets';

const chip = await createSoundChip('ym2612');
try {
  const transport = new YM2612DirectTransport(chip);
  const synth = new YM2612Synth({transport});
  synth.setPreset(0, FM_PRESETS.sine);
  synth.noteOn(0, 4, 553);
  const {left, right} = transport.generateStereo(chip.sampleRate());
  // Float32 PCM: write a WAV or send to an audio output adapter.
  console.log(left.length, right.length);
} finally {
  chip.dispose();
}
```

The factory currently covers Yamaha chips and AY8910. Other chips, including
Game Boy, Sega PSG and RF5C164, use their individual wrappers and generated
factories. See `soundchip.md` and `runtime-manifest.json` for coverage.
Both `tetorica-fm2612/ym2612` and `tetorica-fm2612/ym2612.js` are available.
Synth APIs vary by chip; directly generating PCM does not play it on a speaker.
No Node audio output dependency (`audioworklet`) is installed by this package.

## Automatic WASM loading and WAV export

Since `0.2.3`, the default package entry exports `encodeWav` and default
browser WASM loading works without separate WASM options.
`await createSoundChip('ym2612')` loads the generated JS and WASM beside the
runtime without separate WASM options. Node reads file URLs; browsers/Workers
fetch HTTP URLs. `signal`, `assetBaseUrl`, explicit `wasmBinary` and injected
`moduleFactory` remain available for advanced asset loading.

```js
import {createSoundChip, encodeWav} from 'tetorica-fm2612';
import {YM2612Synth, YM2612DirectTransport} from 'tetorica-fm2612/ym2612synth.js';
import {FM_PRESETS} from 'tetorica-fm2612/megasynth-fm-presets.js';

const chip = await createSoundChip('ym2612');
let wav;
try {
  const transport = new YM2612DirectTransport(chip);
  const synth = new YM2612Synth({transport});
  synth.setPreset(0, FM_PRESETS.sine);
  synth.noteOn(0, 4, 553);
  const pcm = transport.generateStereo(chip.sampleRate());
  wav = encodeWav({...pcm, sampleRate: chip.sampleRate()}, {gain: 0.25});
} finally {
  chip.dispose();
}
```

`encodeWav` returns `Uint8Array` containing mono/stereo PCM16 RIFF WAV.
It accepts `{left, right, sampleRate}`, `{channels, sampleRate}`, or AudioBuffer.
The default gain is 1; values outside -1..1 are clipped. Sample rate is a
positive integer. Node can save the returned bytes with
`await writeFile('tone.wav', wav)` from `node:fs/promises`; browsers can create
`new Blob([wav], {type: 'audio/wav'})` for a download or media player.
Chip creation, PCM generation and WAV encoding do not create an audio device.

## Browser runtime

Browser-only modules are included through separate module entry points:

```js
import {MegaSynth} from 'tetorica-fm2612/megasynth';
import {Playground} from 'tetorica-fm2612/playground_runtime';
```

These APIs require Web Audio and, when used, browser Worker/AudioWorklet support.
Initialize audio from a user gesture. Worklets, the logic Worker, native effects
WASM, chip loader JS/WASM pairs and Tetorica's generated OPNA rhythm data are
included. Website/editor pages and the Introduction/Ebook are separate consumers.

For a static site, copy the contents of `node_modules/tetorica-fm2612/` to a
public directory, preserving its layout, and use module URLs:

```js
import {createSoundChip} from '/vendor/tetorica-fm2612/soundchip.js';
import {MegaSynth} from '/vendor/tetorica-fm2612/megasynth.js';
```

In this layout, default WASM/Worker/Worklet URLs resolve relative to the modules,
independently of the embedding page's URL. Bundlers do not necessarily copy
dynamic imports, Workers or WASM automatically. Preserve the runtime directory
and pass the existing URL options when bundling browser entry points:

```js
import {runtimeAssetUrl} from 'tetorica-fm2612/assets';
const base = new URL('/vendor/tetorica-fm2612/', location.href);
const synth = new MegaSynth({
  workletUrl: runtimeAssetUrl('ym2612-worklet.js', base).href,
  ym2612WasmUrl: runtimeAssetUrl('generated/ym2612_wasm.wasm', base).href,
});
```

`createSoundChip` also accepts `assetBaseUrl` for the generated directory and
`moduleFactory`/`moduleOptions` for explicit loader injection. A URL helper does
not copy assets. Keep dependent files alongside each deployed entry point.

## Mega CD PCM with MegaSynth

Since `0.2.0`, the package includes opt-in RF5C164 support. Enable `megaCD` before
`start()`. YM2612, Sega PSG and RF5C164 share one AudioContext, master volume
and effects chain. Sega PSG is enabled with Mega CD unless its URL is explicitly
set to `null`. Existing FM-only construction stays unchanged.

```js
import {MegaSynth} from 'tetorica-fm2612/megasynth';

const synth = new MegaSynth({megaCD: true});
// Run start() from a click or another user gesture.
await synth.start();
const wave = Float32Array.from({length: 256}, (_, i) => Math.sin(i * 2 * Math.PI / 256));
const sample = await synth.pcm.loadSample(
  {channels: [wave], sampleRate: 32768},
  {address: 0, loopStart: 0},
);
await synth.pcm.setChannel(0, {
  ...sample, volume: 200, pan: {left: 15, right: 15},
});
await synth.pcm.keyOn(0);
// Later:
await synth.pcm.keyOff(0);
await synth.close();
```

`pcm` exposes `loadSample`, `loadMemory`, `setChannel`, `setPitch`, `keyOn`,
`keyOff`, `writeRegister` and `reset`; await their completion. `loadSample`
accepts decoded `{channels, sampleRate}`, AudioBuffer, encoded ArrayBuffer/
Uint8Array, Blob or a URL supported by the existing sample loader. Decoded
stereo samples are mixed to mono and encoded for the chip. The shared RAM is
64 KiB, channel indices are 0..7, starts are 256-byte aligned, volume is 0..255
and left/right pan levels are 0..15. Reserve non-overlapping RAM regions when
loading multiple samples. `setPitch` uses the chip's raw playback step.

`synth.pcm` is available after `start()` and is cleared by `close()`. Await
`synth.reset()` to reset PCM along with FM while preserving waveform RAM.
RF5C164 URLs can be overridden with `rf5c164WasmUrl` and `rf5c164WorkletUrl`;
otherwise they are siblings of the YM2612 assets. The FM command recorder
continues to record FM/DAC actions; PCM commands are not recorded. This adds
the Mega CD PCM chip, not CD disc-image emulation or 32X PWM.

## YM2608 ADPCM-B sample loading

Since `0.2.2`, `YM2608Synth` provides `synth.adpcm.loadSample()`.
It accepts decoded `{channels, sampleRate}`, AudioBuffer, PCM/Float RIFF WAV
bytes, Blob, a browser URL, or a Node.js path/file URL. It mixes channels to
mono, encodes Yamaha ADPCM-B, transfers it, and configures the sample range
and playback rate. It does not start playback or change volume/pan.

```js
const wave = Float32Array.from({length: 8000}, (_, i) =>
  0.5 * Math.sin(i * 2 * Math.PI * 440 / 8000));
const info = await synth.adpcm.loadSample(
  {channels: [wave], sampleRate: 8000},
  {address: 0},
);
synth.adpcm.setVolume(180);
synth.adpcm.setPan(true, true);
synth.adpcm.keyOn();
```

Use a 32-byte aligned address and reserve non-overlapping areas of the 2 MiB
memory yourself. Loading stops ADPCM-B; it preserves FM, SSG and rhythm.
`info` contains `start`, exclusive `end`, `frames`, `paddedFrames`, actual
`sampleRate`, `deltaN` and padded `duration`. Alignment adds at most 63 decoded
frames of encoded silence. `keyOn({repeat: true})` repeats the padded range.
The optional `sampleRate` selects a conversion rate; by default the source
rate is capped to the chip range. Rate conversion uses linear interpolation.
WAV PCM 8/16/24/32-bit and float 32/64-bit work without AudioContext in Node
and browsers. Other formats require an optional `decodeAudio(arrayBuffer)`
callback returning AudioBuffer or decoded PCM. `signal` can cancel loading.
Worklet uploads complete before the returned promise resolves.

`loadMemory()` remains the API for already-encoded ADPCM-B bytes.
This does not add arbitrary sample loading to YM2608's fixed ADPCM-A rhythm.

## Local packaging

From the repository root:

```sh
npm run build:fm2612
npm run pack:fm2612
npm run test:fm2612
```

For browser verification in the repository, prepare the development dependencies
and Chromium once, then run the browser test:

```sh
npm ci
npm run setup:browser
npm run test:fm2612:browser
```

This builds the runtime and checks all eight RF5C164 channels, stereo pan,
FM/PSG/PCM mixing, stop/reset and close/restart. Playwright is a development
dependency; it is not required by users of the sound-chip runtime.

The build is staged in `dist/fm2612/`; packing produces
`tetorica-fm2612-0.2.3.tgz`. To install a local build in another project:

```sh
npm install /absolute/path/to/tetorica-fm2612-0.2.3.tgz
```

The existing `tetorica-vgm` CLI package is built separately. This first package
keeps the browser payload together with the shared core; separate browser/Node
adapter packages can reuse the core later without duplicating it.

## Licenses and assets

Project code is BSD-3-Clause. Third-party notices and component licenses are
included; Nuked-OPN2 is LGPL-2.1-or-later, with its source and build script in
`sources/`. The OPNA rhythm data is Tetorica-generated and includes its license
and generator. External instrument/sample ROMs are not included.

## Release notes

`0.2.3` adds common `encodeWav()` for mono/stereo PCM16 WAV bytes and fixes
default browser/Worker `createSoundChip()` loading by reading WASM internally.
Node and browsers use the same chip creation and WAV encoding API; output
file saving or Blob/media playback remains the embedding application's choice.

`0.2.2` adds YM2608 ADPCM-B `loadSample()` for decoded PCM, AudioBuffer and
PCM/Float WAV sources, with mono conversion, ADPCM-B encoding, memory upload
and range/rate setup. Worklet memory uploads are acknowledged, and OPN browser
runtimes release routing nodes when closed so they can restart safely.

`0.2.1` updates the npm Homepage link to
[tetorica-fm2612-examples](https://github.com/kyorohiro/tetorica-fm2612-examples).
Sound-chip runtime behavior is unchanged from `0.2.0`.
