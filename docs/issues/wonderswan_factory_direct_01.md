# WonderSwan through the public direct chip factory

Date: 2026-10-27.

The npm root entry now accepts `createSoundChip('wonderswan')` and returns
an independent `WonderSwan` raw core with an immutable `id`. It uses the
existing asset loader and supports `assetBaseUrl`, `moduleFactory`,
`moduleOptions`, `signal`, `clock` and `sampleRate`.

```js
import {createSoundChip} from 'tetorica-fm2612';

const chip = await createSoundChip('wonderswan', {sampleRate:48000});
try {
  // Write registers/RAM directly, or use WonderSwanSynth + DirectTransport.
  const pcm = chip.generateStereo(128);
} finally { chip.dispose(); }
```

Default clock and output rate are 3,072,000 Hz / 44,100 Hz. Register and RAM
reads, owned / borrowed / caller-owned PCM rendering remain synchronous.
Existing core behavior and raw output scale are unchanged. JSDoc now emits
numeric read results and typed RAM, mute and PCM inputs rather than `any`.

The package README includes a runnable Synth waveform → A4 → WAV example;
the generated runtime guide also describes this entry. Generic
`execution:'worklet'` remains unsupported for WonderSwan and is rejected before
creating an AudioContext. The dedicated Playground WonderSwan endpoint is
unchanged. Direct PCM is not attached to an output Mixer automatically.

## Validation

- Source unit tests: 39 passed, including seven new real-WASM factory tests.
- Package build: 293 modules, 27 generated engine pairs, 339 declarations.
- Consumer types: NodeNext, Bundler and Browser without Node ambient types;
  positive and negative raw API / ID / execution cases passed.
- Isolated installed package: 981 references, 15 renderers and 27 real WASM
  engines passed, including independent WonderSwan handles sharing a module.
- The retained archive's 841 files match both the checked stage and the exact
  archive's offline installation byte for byte. The general package checker
  separately repacks that same stage; compressed archive bytes differ, but
  the tested file payload is the same.
- Exact-archive Browser tests: Chromium 153 and WebKit 26.6, each in Window and
  a real module Worker. All 26,648 PCM sample comparisons match the Node
  reference exactly. Registers/RAM, clock/rate, owned buffers, IDs, reset and
  disposal checks pass. No audio context, Worklet or device is opened; only
  the WonderSwan WASM is fetched. All 14 served package assets match the archive.
- The README example was extracted unchanged and run in the exact-archive
  consumer successfully.

Changing the public entry invalidated its strict PSG calibration source
receipt. All 18 existing captures were remeasured and historical/current
loader PCM compared exactly. Measurements, gains and generated preset bytes
are unchanged. The guard remains enabled; see
[soundchip_psg_calibration_refresh_01.md](soundchip_psg_calibration_refresh_01.md).

## Artifacts and status

Local package:
`/private/tmp/wonderswan-direct-factory/tetorica-fm2612-0.2.29.tgz`

SHA256: `8a47f4dc0d86b9a8579a397c9f216154ee275b9c57403e5be8bf6e31093f2c59`.

This is a development archive using the unchanged 0.2.29 manifest. The already
published npm 0.2.29 does not contain this factory addition. No version bump,
publish, commit, push, CI dispatch, Tauri import or itch.io release was done.
Receipts are in [wonderswan_factory_direct_01.json](wonderswan_factory_direct_01.json).

Reproduce after a build or with an installed package directory:

```sh
node --test web/soundchip.test.mjs web/soundchip_mixer_factory.test.mjs \
  web/wonderswansynth.test.mjs web/wonderswanaudioengine.test.mjs \
  test/wonderswan-factory.test.mjs
node scripts/check_fm2612_types.mjs dist/fm2612
node scripts/check_fm2612_package.mjs --skip-build
node scripts/check_wonderswan_factory_browser.cjs dist/fm2612
```
