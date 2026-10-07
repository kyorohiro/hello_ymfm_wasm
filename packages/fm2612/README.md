# tetorica-fm2612

Tetorica sound-chip cores, Synth helpers and browser audio runtime, distributed as
ES modules with prebuilt WASM. The package retains the existing web runtime;
its default entry point provides chip creation without starting browser audio.

## Install

```sh
npm install tetorica-fm2612
```

## Chip mixer

Browser outputs share `SoundChipMixer`: `volume` is a linear multiplier (0–2),
`pan` is stereo balance (-1 left, 0 center, 1 right), and `muted` silences the
output while the chip keeps running. Game Boy starts at 28%; other chips start
at 100%. `reset(id)` restores that chip's balance; `reset()` restores all strips.

```js
import {createSoundChip, SoundChipMixer} from 'tetorica-fm2612';
const mixer = new SoundChipMixer();
const audioContext = new AudioContext();
const chip = await createSoundChip('gameboy', {
  execution: 'worklet', audioContext, mixer, id: 'gb1',
});
mixer.set(chip.id, {volume: 0.28, pan: 0, muted: false});
// Configure registers or use a Synth, then await chip.start().
// await chip.dispose() removes its strip; caller owns audioContext.close().
```

Worklet endpoints expose `chip.mixer` and `chip.id` even without an explicit
mixer. Each endpoint retains its existing `gain` trim (default 0.25); the mixer
balance multiplies that trim. Direct chips continue to generate raw PCM and
accept no output mixer. `PCMChipMixer` is available from `soundchip_mixer.js`
for synchronous rendering, as used by the Analyzer.

For browser MegaSynth, use `synth.mixer.set('ym2612', {volume: 0.5})`.
Built-in strip IDs are `ym2612`, `segapsg` when enabled, `rf5c164` in Mega CD
mode and `pwm` in Mega 32X mode. Settings can be specified before `start()`.
Mixer output feeds the existing FX chain, then the master volume. Closing the
synth removes its connected strips. A shared mixer can be passed as `{mixer}`.

Inside Playground Main or Worker code:

```js
const gb = await createSoundChip('gameboy', {id: 'gb1'});
await mixer.set(gb.id, {volume: 0.28, pan: -0.5});
const settings = await pg.mixer.get(gb.id);
await mixer.reset(gb.id);
gb.dispose();
```

Worker controls return promises; `await` works in both execution modes.
`createSoundChip` assigns an ID when omitted and preserves independent
instances. Explicit IDs must be unique. `useSoundChip` retains its existing
per-name cache; its `{id}` option is not supported. Disposing a client or
stopping the runtime removes its output route.

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

## Chip output transports (0.2.6)

Basic chip examples use a shared factory followed by a transport and Synth.
Browser `createSoundChip(name, {execution: 'worklet'})` creates the WASM chip
inside AudioWorklet. `YM2612WorkletTransport` / `YM2608WorkletTransport` send
register commands from Main, and accept an existing AudioWorkletNode or MessagePort
for applications that manage the connection themselves.
Gameboy, SegaPSG and YM2151 transports are exported by `chip_worklet_transport.js`.
The worklet factory supports `ym2612`, `ym2608`, `gameboy`, `segapsg`, `ym2151`.
Default factory execution stays local; Game Boy and Sega PSG now also support
`createSoundChip('gameboy')` and `createSoundChip('segapsg')`.

Node `YM2612AudifyTransport(chip)` and the corresponding YM2608 / Gameboy /
SegaPSG / YM2151 classes are exported by `tetorica-fm2612/node/transports`.
They borrow the caller's chip, render PCM on the calling thread, and own a
device-only Worker. Use `await start()`, `await stop()`, `await close()`, then
`chip.dispose()`. Audify remains optional, but is required by this chosen output.
MegaSynth stays available as the integrated game-embedding API.
DirectTransport is the separate offline PCM / WAV interface.
These transport/factory APIs are available starting in 0.2.6.

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
`tetorica-fm2612-0.2.8.tgz`. To install a local build in another project:

```sh
npm install /absolute/path/to/tetorica-fm2612-0.2.8.tgz
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

`0.2.8` includes JSDoc-generated TypeScript declarations for browser and Node
entry points, typed Direct/Worklet chip creation and async Worker APIs.
The build validates every declaration and strict installed-package examples
under NodeNext/Bundler resolution, including a browser without Node types.
This release also adds npm discovery keywords.


`0.2.7` adds the MAME-derived 32X PWM core, output-frame scheduling,
MegaSynth/MegaSynthNode integration, Playground support and PWM Worklet/Audify/Direct
transports. Integrated output uses cycle-normalized amplitude; the low-level
core also offers raw DAC scaling. The BSD license and source provenance are included.


`0.2.6` adds browser Worklet chip creation and chip-specific Audify transports
for YM2612, YM2608, Game Boy, Sega PSG and YM2151. Basic examples use
WorkletTransport on Web and AudifyTransport on Node; DirectTransport remains
available for explicit PCM generation and WAV export. Applications can move
Synth/Transport into their own Worker using a dedicated MessagePort.
MegaSynthNode can also start without an audio driver, render PCM offline,
and attach, detach or replace an output adapter later.

`0.2.5` adds experimental MegaSynth Node APIs for offline nativeFX rendering,
event recording, PCM looping and Worker-based realtime device output.
Audify is an optional peer dependency.

`0.2.4` removes the ymfm YM2612 DAC ladder's idle offset from AudioWorklet
output and keeps output silent until FM/PSG initialization completes. This
reduces clicks when browser audio starts or disconnects. Raw chip PCM remains
unchanged.

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

### 32X PWM (0.2.7)

Version 0.2.7 adds MAME-derived PWM to `MegaSynth({mega32X: true})`,
`MegaSynthNode({mega32X: true})` and Playground's `useSoundChip('pwm')`.
After `start()`, use `synth.pwm.write(register, value)`
or `synth.pwm.scheduleWrites([{frame, register, value}, ...])`. Frames are offsets
from receipt of the batch at the output sample rate returned by `pwm.getState()`.
The integrated default is `duty` output, gain 1; `pwmOptions` can select `clock`,
`outputMode` and core `gain`. PWM is mixed before the common FX/master output.
Standalone `PWM32XWorkletTransport`, `PWM32XAudifyTransport` and PCM-only
`PWM32XDirectTransport` use the same MAME-derived core.
See [implementation and validation](https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/docs/issues/pwm32x_01.md).

## TypeScript (0.2.8)

Version 0.2.8 generates `.d.ts` and Node `.d.mts` declarations from
JSDoc and includes them in the npm tarball. `types` export conditions cover the
root, assets, Node APIs, transports and both extensionless and `.js` subpaths.
These declarations are available from 0.2.8; 0.2.7 predates this change.

```ts
import {createSoundChip} from 'tetorica-fm2612';
import {YM2612Synth, YM2612WorkletTransport} from 'tetorica-fm2612/ym2612synth.js';

const chip = await createSoundChip('ym2612', {execution: 'worklet'});
const transport = new YM2612WorkletTransport(chip);
const fm = new YM2612Synth({transport});
await transport.start();
fm.noteOn(0, 4, 553);
// await transport.close() when finished.
```

`createSoundChip('ym2612')` infers the direct `Ym2612` core;
`execution: 'worklet'` infers the remote endpoint. Browser APIs require DOM
library types. Node APIs use Node's `EventEmitter` types; Node TypeScript
projects should include `@types/node`. The emitted declarations use generic
TypedArray types, supported by TypeScript 5.7 and later.

Development validation: `npm run build:fm2612` generates and checks every
declaration; `npm run test:fm2612:types` verifies strict consumer examples under
NodeNext and Bundler resolution, including expected errors. The tarball
installation check also runs the consumer type tests against the installed package.
