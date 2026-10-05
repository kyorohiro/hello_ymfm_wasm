# tetorica-fm2612

Tetorica sound-chip cores, Synth helpers and browser audio runtime, distributed as
ES modules with prebuilt WASM. The package retains the existing web runtime;
its default entry point provides chip creation without starting browser audio.

This is a local package candidate, not yet published to npm.

## Node.js: generate PCM

Node.js 22 or later. No AudioContext, Worker or native audio driver is required.

```js
import {createSoundChip} from 'tetorica-fm2612';
import {YM2612Synth, YM2612DirectTransport} from 'tetorica-fm2612/ym2612synth';
import {FM_PRESETS} from 'tetorica-fm2612/megadrive-fm-presets';

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

## Local packaging

From the repository root:

```sh
npm run build:fm2612
npm run pack:fm2612
npm run test:fm2612
```

The build is staged in `dist/fm2612/`; packing produces
`tetorica-fm2612-0.1.0.tgz`. To install the candidate in another project:

```sh
npm install /absolute/path/to/tetorica-fm2612-0.1.0.tgz
```

The existing `tetorica-vgm` CLI package is built separately. This first package
keeps the browser payload together with the shared core; separate browser/Node
adapter packages can reuse the core later without duplicating it.

## Licenses and assets

Project code is BSD-3-Clause. Third-party notices and component licenses are
included; Nuked-OPN2 is LGPL-2.1-or-later, with its source and build script in
`sources/`. The OPNA rhythm data is Tetorica-generated and includes its license
and generator. External instrument/sample ROMs are not included.
