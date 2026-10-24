# tetorica-fm2612

Tetorica sound-chip cores, Synth helpers and browser audio runtime, distributed as
ES modules with prebuilt WASM. The package retains the existing web runtime;
its default entry point provides chip creation without starting browser audio.

**[Try the Playground in your browser](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html)**
— no installation needed. Open it and press **Run** to hear the default example.

For browser and Node.js projects, see the
[runnable examples](https://github.com/kyorohiro/tetorica-fm2612-examples).

## Install

```sh
npm install tetorica-fm2612
```

## API entry points

Find an API by task below. Import paths are complete npm module specifiers;
these modules ship with the package. The table lists the main application-facing
entry points, rather than every internal Worker or Worklet module.

| Task | Import from | Main APIs |
| --- | --- | --- |
| Create a chip / mix browser outputs / encode WAV | `tetorica-fm2612` | `createSoundChip`, `SoundChipMixer`, `SOUNDCHIP_MIXER_PRESETS`, `encodeWav` |
| Convert Hz or MIDI to YM2612 BLOCK/FNUM | `tetorica-fm2612/pitch.js` | `hzToBlockFnum`, `createPitchFromMidi` |
| FM preset sounds | `tetorica-fm2612/megasynth-fm-presets.js` | `FM_PRESETS`, `FM_PRESET_ORDER` |
| YM2612 FM and DAC | `tetorica-fm2612/ym2612synth.js` | `YM2612Synth`, `YM2612DirectTransport`, `YM2612WorkletTransport` |
| YM2203 FM and SSG | `tetorica-fm2612/ym2203synth.js` | `YM2203Synth`, `YM2203DirectTransport`, `YM2203RuntimeSynth` |
| YM2608 FM, SSG, rhythm and ADPCM-B | `tetorica-fm2612/ym2608synth.js` | `YM2608Synth`, `YM2608DirectTransport`, `YM2608WorkletTransport` |
| YM2610 / YM2610B FM, SSG and ADPCM | `tetorica-fm2612/ym2610bsynth.js` | `YM2610BSynth`, `YM2610BDirectTransport`, `NeoGeoFMSynth`, `NeoGeoSynth` |
| YM2151 FM | `tetorica-fm2612/ym2151synth.js` | `YM2151Synth`, `YM2151DirectTransport`, `YM2151WorkletTransport` |
| OPL / OPL2 / Y8950 FM / OPL3 | `tetorica-fm2612/opl_synth.js` | `OPLSynth`, `OPLDirectTransport`, `OPL_PRESETS` |
| YM2413 OPLL | `tetorica-fm2612/ym2413synth.js` | `YM2413Synth`, `YM2413DirectTransport`, `YM2413_INSTRUMENTS`, `YM2413_USER_PRESETS` |
| AY-3-8910 PSG | `tetorica-fm2612/ay8910synth.js` | `AY8910Synth`, `AY8910DirectTransport`, `AY8910WorkletTransport` |
| Game Boy pulse, wave and noise | `tetorica-fm2612/gameboysynth.js` | `GameboySynth`, `GameboyDirectTransport` |
| NES APU and FDS | `tetorica-fm2612/nesapusynth.js` | `NesApuSynth`, `NesApuDirectTransport`, `NesApuWorkletTransport` |
| Sega PSG tone and noise | `tetorica-fm2612/segapsgsynth.js` | `SegaPSGSynth`, `SegaPSGDirectTransport`, `psgPeriodFromFrequency`, `psgPeriodFromNote` |
| PC Engine wavetable, noise and DDA | `tetorica-fm2612/huc6280synth.js` | `Huc6280Synth`, `Huc6280DirectTransport` |
| OKIM6258 ADPCM samples | `tetorica-fm2612/okim6258synth.js` | `Oki6258Synth`, `encodeOki6258` |
| RF5C164 PCM | `tetorica-fm2612/rf5c164synth.js` | `RF5C164Synth`, `RF5C164DirectTransport` |
| 32X PWM | `tetorica-fm2612/pwm32x_transport.js` | `PWM32XDirectTransport`, `PWM32XWorkletTransport` |
| Shared browser chip transports | `tetorica-fm2612/chip_worklet_transport.js` | `GameboyWorkletTransport`, `SegaPSGWorkletTransport`, `YM2151WorkletTransport` |
| Real-time chip playback on Node | `tetorica-fm2612/node/transports` | `YM2612AudifyTransport`, `YM2608AudifyTransport`, `YM2151AudifyTransport`, `GameboyAudifyTransport`, `SegaPSGAudifyTransport`, `NesApuAudifyTransport`, `PWM32XAudifyTransport` |
| Browser synth with FX, recording and looping | `tetorica-fm2612/megasynth.js` | `MegaSynth` |
| Browser live-code runtime | `tetorica-fm2612/playground_runtime.js` | `Playground`, `createPlaygroundRuntime` |
| Select a primary runtime synth | `tetorica-fm2612/tetorica_synth.js` | `createTetoricaSynth`, `TETORICA_CHIPS` |
| DX7 inside browser Playground scripts | `tetorica-fm2612/playground_runtime.js` | Script globals `useSoundChip('dx7')`, `createSoundChip('dx7')` |
| SNES S-DSP / SPC700 | `tetorica-fm2612/snessynth.js`, `tetorica-fm2612/spc.js` | CPU-free BRR instrument / SPC file PCM core |
| Offline FM + native FX rendering | `tetorica-fm2612/megasynth_offline.js` | `createMegaSynthOffline` (experimental) |
| Offline recording and looping | `tetorica-fm2612/megasynth_session.js` | `createMegaSynthSession` (experimental) |
| Node synth with Worker audio output | `tetorica-fm2612/node` | `MegaSynthNode` (experimental) |
| PCM to WAV | `tetorica-fm2612/wav.js` | `encodeWav` |
| PCM to YM2608 ADPCM-B | `tetorica-fm2612/adpcm_b_sample.js` | `readSamplePCM`, `encodeAdpcmB` |
| PCM to RF5C164 sample RAM | `tetorica-fm2612/rf5c164_pcm.js` | `encodeRf5c164` |
| TFI voice files | `tetorica-fm2612/tfi.js` | `parseTfi`, `applyTfiToSynth`, `createTfiFromPreset` |
| VGI voice files | `tetorica-fm2612/vgi.js` | `parseVgi`, `createVgiFromPreset` |
| Browser VGM playback | `tetorica-fm2612/vgm_runtime.js` | `VgmRuntime`, `createVgmRuntime` |
| VGM metadata / VGZ decoding | `tetorica-fm2612/vgm_file.js` | `parseVgmMetadata`, `maybeDecodeVgmFile` |
| Resolve packaged assets | `tetorica-fm2612/assets` | `runtimeAssetUrl` |

Direct transports generate PCM without a speaker. Worklet transports require
browser Web Audio; Audify transports require Node and the optional `audify`
package. Pure helpers such as `pitch.js`, `wav.js`, `tfi.js` and `vgi.js` can run
in both browser and Node without opening an audio device.

### Pitch conversion example

```js
import {hzToBlockFnum} from 'tetorica-fm2612/pitch.js';

const {block, fnum} = hzToBlockFnum(440);
console.log({block, fnum}); // {block: 4, fnum: 1083}
```

Pass the result to an initialized YM2612 Synth:
`fm.setFrequency(channel, block, fnum)`. This changes pitch without triggering a
new note. The optional second argument to `hzToBlockFnum(hz, clock)` is the
chip's input clock in Hz (default `7670454`), not the audio sample rate.
`createPitchFromMidi(midi, {referenceMidi, referenceBlock, referenceFnum})`
converts relative to a caller-selected MIDI/BLOCK/FNUM reference.

### Find signatures and options

After installing, use your editor's import completion, hover and Go to Definition.
Declarations are shipped beside each module, for example
`node_modules/tetorica-fm2612/pitch.d.ts` and
`node_modules/tetorica-fm2612/node/chip_transports.d.mts`. They describe exported
functions/classes, parameter types, options and return types. Plain JavaScript
projects can use the same editor assistance with JSDoc-aware tooling.

### OPL family instruments

Available in `tetorica-fm2612@0.2.22` and later.

`OPLSynth` shares one API across `ym3526`, `ym3812`, `y8950` (FM only), and
`ymf262`. Channels are zero-based: 0–8 for the first three, 0–17 for OPL3.
Operator indices are modulator/carrier 0/1; enabled OPL3 pairs use 0–3.
`initialize()` explicitly resets the chip and prepares silent voices. Constructing
a Synth alone never resets or writes to a borrowed chip.

```js
import {createSoundChip, encodeWav} from 'tetorica-fm2612';
import {OPLSynth, OPLDirectTransport, OPL_PRESETS} from 'tetorica-fm2612/opl_synth.js';

const chip = await createSoundChip('ym3812');
try {
  const opl = new OPLSynth({chip:'ym3812', transport:new OPLDirectTransport(chip)});
  opl.initialize();
  opl.setPreset(0, OPL_PRESETS.sine);
  opl.noteOn(0, 'A4');
  const pcm = chip.generateStereo(Math.round(chip.sampleRate() * 0.5));
  const wav = encodeWav({...pcm, sampleRate:chip.sampleRate()});
  opl.noteOff(0);
  // Save wav to a file, or send pcm to your own output.
} finally { chip.dispose(); }
```

Use `OPLWorkletTransport` from `chip_worklet_transport.js` with a
`createSoundChip(name, {execution:'worklet'})` endpoint for browser audio.
`OPLAudifyTransport` from `node/transports` provides optional Node device output.
The chip-specific `ym3526synth.js`, `ym3812synth.js`, `y8950synth.js` and
`ymf262synth.js` entry points also export named Synth and DirectTransport wrappers.

OPL3 enables stereo with `setPan(ch, left, right)` and pairs with
`setFourOp(ch, true)` for primary channels 0–2 and 9–11. Each enabled pair owns
the secondary channel three positions later; address its four operators through
the primary. `setPreset(0, OPL_PRESETS['four-op-bell'])` configures such a pair.
Mono chips send the same output to both speakers. Their operators support sine
only on YM3526/Y8950, four waveforms on YM3812, and eight on YMF262.

Playground modes `ym3526`, `ym3812`, `msx-audio` and `ymf262` expose the primary
instrument as `opl` and provide `OPL_PRESETS`. Use `opl.noteOn()` / `noteOff()`;
the OPN `fm` and `play()` conveniences are absent. Operators and Keyboard share
this same primary instrument. OPLL/YM2413 is a separate API and is not included
in this high-level OPL family implementation.

`node_modules/tetorica-fm2612/runtime-manifest.json` lists every shipped runtime
module and asset. It is a distribution inventory, including internal modules;
start with the task table above when choosing an application API. See the
[runnable examples](https://github.com/kyorohiro/tetorica-fm2612-examples) for
complete setup, playback and cleanup.

### NES + FDS WASM

Available in `tetorica-fm2612@0.2.24` and later.

`await createSoundChip('nes', {fds:true})` creates the default WASM NES APU and
FDS renderer. It uses the same C++ core as Native NES, including pulse,
triangle, noise, DMC RAM and FDS wave/modulation memory. The Synth API and
register addresses are unchanged. Direct rendering opens no audio device;
`execution:'worklet'` renders through browser Web Audio.

```js
import {createSoundChip} from 'tetorica-fm2612';
import {NesApuSynth, NesApuDirectTransport} from 'tetorica-fm2612/nesapusynth.js';

const chip = await createSoundChip('nes', {fds:true, sampleRate:48000});
try {
  const nes = new NesApuSynth({transport:new NesApuDirectTransport(chip)});
  nes.fds.noteOn('A4');
  const pcm = chip.generateStereo(4096);
  nes.fds.keyOff();
} finally { chip.dispose(); }
```

Ship both `generated/nesapu_wasm.js` and `generated/nesapu_wasm.wasm` when
copying a smaller deployment. `runtimeAssetUrl()` resolves these assets from
the installed package. The original JavaScript renderer remains available for
compatibility and PCM comparison; the Analyzer's existing JavaScript path is
preserved. `sources/NES-FDS.md` describes rebuilding the shared C++ core and
WASM wrapper. Apache-2.0 and MIT notices and the original authors ship under
`licenses/`.

### 32X PWM WASM

Available in `tetorica-fm2612@0.2.25` and later.

`await createSoundChip('pwm')` and `await PWM32X.create()` use the shared C++
PWM core through WASM. Browser AudioWorklets, MegaSynth, MegaSynthNode and
asynchronous Genesis/VGM rendering use this core too. Register writes, FIFO
behavior, frame-based scheduling and DAC/duty output retain the previous JS
semantics. The standalone default is DAC output with gain 0.4; integrated
playback keeps duty output with gain 1.

Ship both `generated/pwm32x_wasm.js` and `generated/pwm32x_wasm.wasm` when
copying a smaller deployment. The synchronous `new PWM32X()` constructor and
explicit `implementation:'js'` remain available for compatibility and PCM
comparisons. WASM loading errors are reported. The C++ source, wrapper and
rebuild script ship in `sources/`; see `sources/PWM32X.md` and the BSD notices
in `licenses/mame-32x-pwm/`. Tauri Native 32X builds the same C++ core directly.

### Master System: Sega PSG and YM2413 OPLL

Available in `tetorica-fm2612@0.2.23` and later.

The Master System Playground mode prepares both a mono Sega PSG (`psg`) and
YM2413 (`opll`). They have separate mixer strips and Keyboard chip/channel
targets. Game Gear prepares its stereo PSG only.

```js
// Playground script in Master System mode.
opll.setInstrument(0, 3, 4); // Piano, hardware attenuation 4.
opll.noteOn(0, 'C4');
psg.tone(PSG1, {note:'C3', attenuation:10});
await beat(1);
opll.noteOff(0);
psg.off(PSG1);
```

For an embedded Playground, choose
`Playground({chip:'segapsg', stereoEnabled:false, ym2413:true})`.
Use `useSoundChip('ym2413')` to borrow the mode's OPLL; `createSoundChip('ym2413')`
creates an independent instance. `YM2413Synth` also supports Direct, Worklet
and optional Node Audify transports.

YM2413 has nine melody channels, or six melody channels and five rhythm voices.
Instrument IDs 1–15 select built-in voices; instrument 0 selects the single
chip-wide user patch. `setUserPatch()` / `setUserOperator()` therefore change
every channel using instrument 0. Carrier loudness is set by each channel's
`attenuation` (0 loudest, 15 quietest), rather than a shared carrier TL field.
The Operators panel keeps built-in voices separate from this shared patch.
Rhythm levels share CH6–8's instrument/attenuation registers; select those
channels' melody voices again after changing rhythm levels when needed.

### MSX and MSX Audio

Available in `tetorica-fm2612@0.2.23` and later.

The MSX Playground mode combines `ay` (AY-3-8910 PSG) and `opll` (YM2413
MSX-MUSIC). MSX Audio adds `opl` (Y8950 MSX-AUDIO FM). Each instrument has
its own mixer strip, chip tab and Keyboard channel selector in the same audio
context. These are authoring sound sets. The Y8950 uses the existing OPL FM API.
Since 0.2.26, the MSX Audio Playground client also exposes `opl.adpcm` for
ADPCM-B sample preparation, playback controls and voice audition.

```js
// Playground script in MSX Audio mode. AY volume: 0 silent .. 15 loudest.
ay.tone(0, {note:'A4', volume:9});
opll.setVoice(0, {instrument:3, attenuation:5});
opll.noteOn(0, 'A4');
opl.setPreset(0, OPL_PRESETS.sine);
opl.noteOn(0, 'A4');
await beat(1);
ay.keyOff(0); opll.keyOff(0); opl.keyOff(0);
```

Embed the two-chip set with `Playground({chip:'msx'})`, or the three-chip set
with `Playground({chip:'msx-audio'})`. Optional `ayOptions`,
`opllOptions` and `oplOptions` accept `{fetch, wasmUrl, workletUrl}` for custom
asset loading. `useSoundChip('ay8910'|'ym2413')` borrows a primary device in
both modes; `useSoundChip('y8950')` borrows MSX Audio's primary, or adds an
independent Y8950 in MSX. `createSoundChip()` creates an independent instance.

The AY has three channels, each mixing tone and noise. Noise period and
hardware envelope are shared across those channels. `setMixer()` preserves
the other channels and I/O bits; `keyOff()` preserves the configured voice,
and the next `keyOn()` restores its level. `setEnvelope({shape})` explicitly
retriggers the shared envelope. AY uses a twelve-bit tone period and
`frequency = clock / (16 * period)`; it is mono, copied to both outputs.

## Chip mixer

Browser outputs share `SoundChipMixer`: `volume` is a linear multiplier (0–2),
`pan` is stereo balance (-1 left, 0 center, 1 right), and `muted` silences the
output while the chip keeps running. Game Boy starts at 28%; other chips start
at 100% unless an application explicitly selects a preset or supplies defaults.
Multiple strips can be `solo: true`; other connected strips are
suppressed without overwriting their manual `muted` settings. `list()` exposes
`effectiveMuted` separately. `reset(id)` restores that chip's balance; `reset()` restores all strips.

```js
import {createSoundChip, SoundChipMixer} from 'tetorica-fm2612';
const mixer = new SoundChipMixer();
const audioContext = new AudioContext();
const chip = await createSoundChip('gameboy', {
  execution: 'worklet', audioContext, mixer,
});
mixer.set(chip.id, {volume: 0.28, pan: 0, muted: false});
// Configure registers or use a Synth, then await chip.start().
// await chip.dispose() removes its strip; caller owns audioContext.close().
```

All chips created by `createSoundChip` expose a stable, readonly `chip.id`.
Omitting `{id}` assigns an automatic ID such as `gameboy:1`; simultaneous
creation also gets distinct IDs. Worklet endpoints expose `chip.mixer` even
without an explicit mixer. Each endpoint retains its existing `gain` trim (default 0.25); the mixer
balance multiplies that trim. Direct chips continue to generate raw PCM and
accept no output mixer. `PCMChipMixer` is available from `soundchip_mixer.js`
for synchronous rendering, as used by the Analyzer.

### Optional calibrated preset

`SOUNDCHIP_MIXER_PRESETS.calibrated` provides fixed, measured output-level
defaults for the 22 calibrated chip kinds. Select it when constructing the
mixer, then pass that mixer to a browser Worklet endpoint:

```js
import {
  createSoundChip, SoundChipMixer, SOUNDCHIP_MIXER_PRESETS,
} from 'tetorica-fm2612';
import {
  YM2612Synth, YM2612WorkletTransport,
} from 'tetorica-fm2612/ym2612synth.js';
import {FM_PRESETS} from 'tetorica-fm2612/megasynth-fm-presets.js';

// Call from a button click or another browser user gesture.
async function playCalibratedTone() {
  const mixer = new SoundChipMixer(SOUNDCHIP_MIXER_PRESETS.calibrated);
  const audioContext = new AudioContext();
  let chip, transport;
  try {
    chip = await createSoundChip('ym2612', {
      execution: 'worklet', audioContext, mixer,
    });
    transport = new YM2612WorkletTransport(chip);
    const fm = new YM2612Synth({transport});
    fm.setPreset(0, FM_PRESETS['one-op-basic']);
    await chip.start();
    fm.noteOn(0, 'A4');
    await new Promise(resolve => setTimeout(resolve, 500));
    fm.noteOff(0);
    await transport.flush();
  } finally {
    transport?.dispose();
    await chip?.dispose(); // Also removes its mixer strip.
    await audioContext.close(); // The caller owns this context.
  }
}
```

The preset is also exported from
`tetorica-fm2612/soundchip_mixer_presets.js`. Creating `new SoundChipMixer()`
without a preset, or omitting `mixer` from `createSoundChip()`, keeps the legacy
defaults described above. Importing or selecting the preset opens no audio
device. It does not change direct `generateStereo()` output.

Calibration supplies fallback `volume` values, including an engine-specific
YM2612/Nuked value when a connected endpoint reports that engine. Explicit
common defaults and per-ID settings replace those fallback values; they do
not multiply them. The Worklet endpoint's separate `gain` trim still applies.
The preset does not alter saved settings or add storage.
It adds no Worklet implementations or engine selection; the existing chip
support and endpoint options still apply.

These constants compare a fixed single voice at known levels. They do not
analyze playing audio or perform automatic normalization, compression, or
limiting. Timbre and polyphony still affect loudness and headroom. Chip kinds
outside the 22 measured kinds keep their legacy defaults. The preset is
intended initially for standalone chip / `createSoundChip` output routes;
MegaSynth's built-in sources have different trims, so it does not reproduce
the balance of a complete Playground machine mode.

### Synth routing and settings

For browser MegaSynth, use `synth.mixer.set('ym2612', {volume: 0.5})`.
Built-in strip IDs are `ym2612`, `segapsg` when enabled, `rf5c164` in Mega CD
mode and `pwm` in Mega 32X mode. Settings can be specified before `start()`.
Mixer output feeds the existing FX chain, then the master volume. Closing the
synth removes its connected strips. A shared mixer can be passed as `{mixer}`.
Explicit IDs (including MegaSynth's built-in IDs) retain their settings in that
mixer when disconnected and reconnected. Automatic IDs are transient and do
not transfer settings to newly created chips. This is session state, not
persistent storage.

Hosts can observe source lifetimes and settings with `mixer.subscribe(listener)`;
read `mixer.list()` for the initial state. `mixer.subscribeMeters(listener)` opts
into stereo peak summaries (`[{id, left, right}]`) at approximately 15 Hz per
source. Levels are after the chip trim and before shared FX/master, and can
exceed 1. Unsubscribe when the view is hidden: the last meter unsubscribe stops
measurement and removes dedicated analyser branches. No continuous PCM stream
is transferred to the UI. These subscription methods belong to the host-side
`SoundChipMixer`; Playground Worker scripts use the asynchronous settings API.


Inside Playground Main or Worker code:

```js
const gb = await createSoundChip('gameboy');
await mixer.set(gb.id, {volume: 0.28, pan: -0.5});
const settings = await pg.mixer.get(gb.id);
await mixer.reset(gb.id);
gb.dispose();
```

Worker controls return promises; `await` works in both execution modes.
`createSoundChip` assigns an ID when omitted and preserves independent
instances. Explicit IDs must be unique within a shared mixer, including while initialization is pending.
For a stable application name, `{id: 'gb1'}` remains available. `useSoundChip` retains its existing
per-name cache and returns the same object/ID until disposed or stopped; its `{id}` option is not supported. Disposing a client or
stopping the runtime removes its output route.

## Included sound chips

| Family | Chips |
| --- | --- |
| Yamaha OPN | YM2203, YM2608, YM2610/YM2610B, YM2612, YM3438, YMF276, YMF288 |
| Yamaha OPM | YM2151 |
| Yamaha OPL | YM2413, YM3526, YM3812, Y8950, YMF262, YMF278B |
| PSG and console audio | AY8910, Sega PSG, Game Boy APU, NES APU + FDS, HuC6280, K051649 |
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

### Native configurations and host integration (0.2.21)

The shared runtime supports Game Boy, NES + FDS, SNES, X68000
(YM2151 + OKIM6258), PC Engine (HuC6280), and Sega PSG primary synths alongside
the OPN configurations. `createTetoricaSynth` selects the underlying chip family;
the website's named modes, starter files and mode-switching interface are host
features. Native scripts use their chip APIs, such as `pce`, `opm` and `adpcm`;
the musical `play()` helper remains specific to OPN FM.

Runtime hosts can read applied chip state and send explicit edits through
`runtime.chipInspector`. Native voice inspectors cover Game Boy, NES/FDS,
YM2151, OKIM6258 and HuC6280. Reads do not render audio or trigger notes.
Manual audition owns the selected hardware channel until release or sample completion; stale note
releases cannot silence its replacement. Stop cancels reserved script commands
and manual notes while retaining uploaded material and supported voice settings.

Scripts can bind a host keyboard and create sample instruments:

```js
// Inside a Playground script. The embedding host supplies audio input and a keyboard UI.
const audio = await inputAudio();
if (audio) {
  keyboard.bind('sampler', await createSampleInstrument(audio));
}
```

The host supplies the runtime's `inputAudio` callback, returning decoded PCM or
`null`, and connects `onKeyboardTargetChange` to its input surface. Input requests
receive an AbortSignal for Stop/cancellation. The sample-instrument adapters
support RF5C164, Game Boy wave RAM and PC-98/Neo Geo ADPCM-B; they do not provide
a common sampler for every chip. Keyboard bindings also accept custom
`noteOn`, `noteOff` and `allNotesOff` handlers with per-press identities.

The npm package includes these runtime modules and sample-processing helpers.
The website's mode menu, Guitar Keyboard widgets, voice-panel widgets and
file/microphone Sample Editor dialog under `docs/playground/` are separate and
are not included in the npm package. See the
[browser Playground](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html)
for that complete interface.

### Worker timing

Playground Worker scripts reserve FM/PSG, native sample/noise/FX and independent
chip commands 500 ms ahead by default on the shared audio clock. UI Keyboard audition and
Main execution remain immediate. Adjust the lead before a fresh performance:

```js
runtime.setTiming({workerLookaheadSeconds: 0.5}); // 0..2 seconds; 0 disables the lead
```

Changes apply after Stop, then Run; a hot Run keeps the current clock and lead.
The website also exposes this setting in Menu as **Worker lookahead (ms)**.
Saved preferences, including 0 or 150 ms, are preserved; 500 ms is the default
when no valid preference exists. A larger lead tolerates longer command-delivery
stalls, with the same added delay for script playback and live code changes.
Explicit absolute audio-time and DAC/VGM sample schedules retain their own
clocks and lead settings (`lookaheadSeconds` / `schedulerIntervalMs`). HTML media
`stream` playback, external MIDI and MIDI-file scheduling use their existing
paths; this transport lead does not automatically align those paths. Stop
retires pending Worker reservations. The lead absorbs short delivery stalls;
it does not smooth waveform discontinuities or prevent device-level underruns.

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

Since 0.2.14, an owned `MegaSynth` AudioContext uses the device's
default sample rate. Set `{outputSampleRate: 48000}` to request a specific output
frame rate; an explicit legacy `chipSampleRate` request remains supported. An
injected AudioContext keeps its own rate. Chip clocks and note tuning are
independent of the output rate.

Version 0.2.14 also supports chip-output RMS monitoring:

```js
synth.setOutputEnvelopeOptions({samplesPerPoint: 128, pointsPerMessage: 16});
// After start(), listen on synth.node.port for:
// {type: 'output-envelope', rmsValues: Float32Array}
```

This measures mixed chip output before browser FX and master volume, separately
from Playground's final-output waveform analyser. Sample counts are output frames
at the AudioContext sample rate. Defaults are 512 frames per point and 16 points
per message; monitoring stays off until requested. Integer ranges are 1–65536 and
1–1024 respectively. Calls before start and during playback are supported, and
settings survive close/start. Omitted sizes keep their previous values. Each call
discards incomplete points and batches and enables monitoring unless
`{enabled: false}` is supplied. Message intervals are approximately
`samplesPerPoint * pointsPerMessage / audioContext.sampleRate` seconds.

## Experimental SNES BRR instrument and SPC playback (0.2.20)

**Experimental implementation.** SNES/SPC support has been checked with
original synthetic fixtures, native/WASM PCM comparisons, and Chromium/WebKit
in Main and Worker modes. Real-game SPC compatibility, Tauri application
behavior, and long-running playback still need verification. These new APIs
and their behavior may change as testing continues.

The Playground script factory supports `useSoundChip('snes')` and
`createSoundChip('snes', {id:'snes-bass'})` in Main and Worker modes.
Each instance has its own 64 KiB RAM and eight physical S-DSP voices, numbered
0..7. It runs no game CPU and never writes into an SPC player's RAM.

```javascript
const snes = await useSoundChip('snes');
const sample = await snes.loadBRR(
  new Uint8Array([0xc3,0x13,0x57,0x75,0x31,0xfd,0xb9,0x9b,0xdf]),
  {baseFrequencyHz:2000, loopStartSamples:0}
);
snes.setPreset(0, {sample, adsr1:0x8f, adsr2:0xe0, volumeLeft:90, volumeRight:90});
snes.noteOn(0, 'C4');
await beat(1);
snes.noteOff(0);
```

BRR has no root-note metadata. Declare exactly one of `rootNote` (MIDI number
or note name) and `baseFrequencyHz`, measured at `basePitch` (default 4096).
Looping BRR also requires `loopStartSamples`, a multiple of 16 within the sample.
Await `loadBRR()` before using its returned sample descriptor or numeric id.
`setFrequency(channel, hz)` and `setNote(channel, note)` use this tuning;
`setPitch(channel, pitch)` accepts the raw 14-bit DSP pitch value.
ADSR1/ADSR2/GAIN and signed left/right volume are raw DSP values.
Abrupt changes may click; no automatic smoothing is applied.

`reset()` releases voices and reloads uploaded samples with the same ids.
Samples occupy the instance's fixed 64 KiB RAM (directory at 0..1023); there is
no automatic voice stealing, sample unloading or compaction. Echo writes are
disabled by default. Raw `writeDsp()` edits must keep directory, BRR and echo
RAM regions from conflicting. `await getState()`, `getPreset(channel)`, and
`snapshot()` inspect applied state; future lookahead commands may still be pending.
Mixer, FX, script lookahead and Stop resource ownership use the existing Playground paths.

The native rate is fixed at **32,000 stereo frames/second**, with output-side
resampling for the device. There is no `setClock()` or BPM-controlled DSP rate.
`new SnesSynth({core: await SnesDspCore.create({moduleFactory})})` from
`snessynth.js` / `spc.js` exposes direct PCM rendering outside Playground;
pass the generated `spc_wasm.js` factory and its `moduleOptions.wasmBinary`
when loading WASM explicitly. `SpcCore` in `spc.js` instead runs the SPC700 CPU, timers and DSP
from an SPC file. Both offer `renderInto(left, right)` at the native rate.
`SpcRuntimeSynth` in `spc_audio.js` supplies browser AudioWorklet playback.
The package-root Yamaha `createSoundChip` factory remains a separate API.

SPC support uses the accurate `snes_spc` 0.9.0 core, pinned in
`sources/third_party/snes-spc/`. Its LGPL-2.1-or-later license, corresponding
modified source and Emscripten build recipe ship with the runtime. No Nintendo
IPL ROM, game music or game samples are bundled. SPC files requiring additional
transfers from the game host or a complete IPL ROM may not play correctly.
Stop restores the original file, including echo RAM; it is not a mid-song
checkpoint. Voice mute removes dry output and new echo sends while CPU, BRR,
envelopes and pitch modulation continue; existing echo tails can remain.

## DX7 in browser Playground (0.2.14)

Scripts executed by `Playground` / `createPlaygroundRuntime` can use the MSFA
DX7-compatible six-operator FM engine. It starts with the self-authored
`INIT SINE` voice, so no external sound bank is needed:

```js
// Run inside a Playground script; these are runtime-provided globals.
const dx7 = await useSoundChip('dx7');
dx7.noteOn(60, 100); // MIDI C4, velocity 100.
await beat(1);
dx7.noteOff(60);
```

Read a DX7 single-voice or 32-voice-bank SysEx as binary before loading it.
The Playground editor provides the virtual-file `file()` helper used below;
an embedded runtime host supplies its own file access and passes binary data
to the script:

```js
const bytes = await file('/presets/my-bank.syx', {type: 'arrayBuffer'});
await dx7.loadSysex(bytes); // Applied in the Worklet before this resolves.
console.log(dx7.voices); // [{index: 0, name: '...'}, ...]
dx7.selectVoice(0);
```

`loadSysex` accepts an ArrayBuffer or ArrayBuffer view, validates the complete
bank before replacing it, and selects voice 0. `noteOn` takes integer MIDI
notes and velocity values from 0 to 127; velocity 0 is Note Off. There is no
channel argument. Up to 16 voices can sound simultaneously. `noteOff(note)`
releases all held voices of that pitch, `allNotesOff()` releases every voice,
and `panic()` silences release tails and buffered audio immediately.

Both Main and Worker script execution use AudioWorklet for audio generation.
The engine renders mono at a fixed internal 44,100 Hz and supports output
AudioContexts at 44,100 or 48,000 Hz; 48,000 Hz output is resampled. Its mono
output feeds Playground's stereo mixer, FX and master volume. Use
`await mixer.set(dx7.id, {volume: 0.5, pan: -0.25})` for balance. It has no
chip-clock or raw-register API. STOP disposes the instance; a subsequent call
to `useSoundChip('dx7')` creates a fresh one. Playground's
`createSoundChip('dx7', {id: 'dx7-two'})` creates an independent instance and
bank instead of reusing the cached `useSoundChip` instance.

These globals belong to the Playground runtime. Importing `createSoundChip`
from the **package root** does not add DX7 to that lower-level chip factory.
For direct PCM generation or DX7 playback outside Playground, use the separate
[`tetorica-msfa-dx7-wasm`](https://www.npmjs.com/package/tetorica-msfa-dx7-wasm)
package (`createDX7` in Node/browsers, `createDX7Node` for browser audio).
The pinned engine, WASM and Apache-2.0 notices are included in this package's
`msfa_dx7/` directory; no extra runtime dependency or CDN request is required.

### Object-based DX7 presets (0.2.15)

Version 0.2.15 provides `await dx7.setPreset(preset)`,
`await dx7.setOperator(operator, params)`, `await dx7.setOperators(entries)`,
and `await dx7.getPreset()`. Version 0.2.18 bundles `tetorica-msfa-dx7-wasm` 0.3.1.

```js
const dx7 = await useSoundChip('dx7');
await dx7.setPreset({
  name: 'JS BELL', algorithm: 0,
  operators: {
    1: {coarse: 1, outputLevel: 90},
    2: {coarse: 2, outputLevel: 68},
  },
});
await dx7.setOperator(2, {outputLevel: 60});
await dx7.setOperators([[1, {fine: 25}], [2, {coarse: 3}]]);
console.log(await dx7.getPreset());
dx7.noteOn(60, 100);
```

Public operators are OP1..6, with no channel argument. `setPreset` fills omitted
fields from INIT SINE and replaces the selected slot; operator setters patch it.
The selected bank index and other voices remain intact. Tuple batches reject
duplicate operators and invalid values atomically; an empty array is a no-op.
Objects are copied at the boundary, and `getPreset` returns a full independent copy.
Algorithm numbers are zero based (0..31); outputLevel is 0..99, higher is louder;
envelopes use four DX7 rate/level values 0..99 rather than seconds or YM2612 AR/TL.
Since 0.2.16, outputLevel/mode/coarse/fine/detune edits apply
to sounding notes of the edited patch, including release tails. Its additive
`await dx7.setFeedback(3)` edits feedback (raw range 0..7).
`setPreset`/`loadSysex` replace patch identities; old notes retain the previous
patch. `selectVoice` preserves each bank slot's identity. General EG/algorithm
edits remain future-note-only. Phase/key/EG state and original velocity/scaling
are retained, with edits applied at the next ungenerated 64-frame internal block.
An acknowledgement does not bypass generated PCM or device buffering.
Abrupt frequency/feedback changes apply directly; their waveform discontinuities
and clicks are accepted API behavior. No automatic parameter smoothing, glide,
feedback interpolation, crossfade or click suppression is added. Phase, EG and
feedback history are retained. Existing upstream operator-gain interpolation and
PCM output resampling remain. NaN/Infinity reject atomically; non-finite output,
corrupted amplitude, divergence and crashes are not accepted behavior.
Return async setters from Playground `tween` callbacks, e.g.
`await tween(1, p => dx7.setOperator(2, {outputLevel: Math.round(99*p)}))`.
Live edits leave the shared LFO untouched; selection/replacement can reconfigure
it while retaining its phase. MSFA's documented AM,
transpose and oscillator-sync limitations still apply.
The standalone DX7 PCM core exposes the same methods synchronously.

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

## YM2151 Synth

`YM2151Synth` supports all eight OPM channels and shares one register-generation
implementation across Direct, Worklet and Node Audify transports.

```javascript
import {createSoundChip} from 'tetorica-fm2612';
import {YM2151Synth, YM2151WorkletTransport} from 'tetorica-fm2612/ym2151synth.js';
import {FM_PRESETS} from 'tetorica-fm2612/megasynth-fm-presets.js';

const chip = await createSoundChip('ym2151', {execution: 'worklet', signal});
const transport = new YM2151WorkletTransport(chip);
try {
  const fm = new YM2151Synth({transport});
  fm.setPreset(0, FM_PRESETS.sine);
  await transport.start();
  fm.noteOn(0, 'C4'); // A note name or MIDI integer, C#0..C8 (13..108).
  // Wait for the desired duration using your app's timer.
  fm.noteOff(0);
  await transport.flush();
} finally {
  await transport.close();
  await chip.dispose();
}
```

Use `YM2151DirectTransport(chip)` from the same module for `generateStereo()`
and offline PCM. Use `YM2151AudifyTransport(chip)` from
`tetorica-fm2612/node/transports` for Node device output.

`setPreset`, `setOperator`, `setAlgo`, `setPan`, `setNote`, `setFrequency`,
`setPitch`, `keyOn` / `keyOff`, and `noteOn` / `noteOff` are available.
`setLFO({frequency, amDepth, pmDepth, waveform})` and
`setNoise(enabled, frequency)` expose OPM-specific controls. Noise affects channel 7.
`setFrequency` quantizes Hz to the chip's 1/64-semitone key fraction;
note/frequency conversion assumes the default 3579545 Hz clock.
`setPitch(channel, keyCode, keyFraction)` accepts raw KC/KF values.

Synth operators and `operatorMask` bits use logical M1, M2, C1, C2 order (0..3),
matching the algorithm order used by `FM_PRESETS`. All bundled `FM_PRESETS` can
be applied; OPM and OPN have different hardware behavior, so their sounds need
not match. OPM adds `dt2` (0..3) and has no OPN SSG envelope.
Operator aliases `dt1`, `mul`, `ks`, `sr`, `d1l` are accepted for
`dt`, `multi`, `rs`, `d2r`, `sl`; specifying both aliases in one update is rejected.
Partial edits preserve adjacent bits. Presets are validated before writes.

The older Playground YM2151 client retains its register-order operator indexing
(M1, C1, M2, C2) and its existing API. `YM2151Synth` is the package Synth layer.

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
`tetorica-fm2612-0.2.26.tgz`. To install a local build in another project:

```sh
npm install /absolute/path/to/tetorica-fm2612-0.2.26.tgz
```

The existing `tetorica-vgm` CLI package is built separately. This first package
keeps the browser payload together with the shared core; separate browser/Node
adapter packages can reuse the core later without duplicating it.

## Licenses and assets

Project code is BSD-3-Clause. Third-party notices and component licenses are
included; Nuked-OPN2 and snes_spc are LGPL-2.1-or-later, with their source and build scripts in
`sources/`. The bundled DX7 engine is Apache-2.0; its license, MSFA provenance
and third-party notices are in `msfa_dx7/`. The OPNA rhythm data is
Tetorica-generated and includes its license and generator. External
instrument/sample ROMs are not included.

## Release notes

`0.2.26` adds **opt-in calibrated Mixer presets** through
`SOUNDCHIP_MIXER_PRESETS.calibrated`. Fixed output-level defaults for 22 measured
chip kinds can be selected when constructing a `SoundChipMixer`; existing
no-mixer and unconfigured-Mixer defaults, explicit volume settings and raw PCM
are preserved. The shared Playground runtime also updates independently owned
additional Native chips, Main/Worker routing, Mixer settings and lifecycle
cleanup, and Y8950 ADPCM sample preparation and audition. Native playback
requires a compatible Tauri host; it is not a standalone Native backend for npm.
The package includes the MSM5205 reference renderer's libvgm notices.

`0.2.25` moves **32X PWM asynchronous playback to a shared C++/WASM core**.
Direct creation, browser AudioWorklets, MegaSynth/MegaSynthNode and asynchronous
Genesis/VGM engines use WASM, with the previous JS PCM and register/scheduling
semantics preserved. The synchronous JS constructor remains available for
compatibility and comparison. Generated WASM assets, typed wrappers, shared
source, rebuild instructions and BSD notices are included. The shared Playground
runtime also connects Native 32X FM/PSG/RF5C164/PWM through Main and Worker
execution, mixer controls and cancellation when used with its Tauri host.

`0.2.24` makes **NES + FDS asynchronous creation use the shared C++/WASM core**,
including pulse, triangle, noise, DMC RAM and FDS wave/modulation memory. Synth
and register APIs remain compatible, and the synchronous JS renderer remains
available. Rebuild sources, Apache-2.0/MIT notices and author information ship
with the package.

`0.2.23` adds **AY-3-8910 and YM2413 high-level Synth APIs**, direct and Worklet
transports, native voice inspectors and Keyboard channel adapters. AY exposes
three tone/noise voices with a shared noise generator and hardware envelope;
OPLL exposes nine melodic voices or six voices plus five drums, fifteen built-in
instruments and one shared user patch. Native sound sets include Master System's
PSG + OPLL, `Playground({chip:'msx'})` with AY + OPLL, and
`Playground({chip:'msx-audio'})` with AY + OPLL + Y8950 FM. Main/Worker execution,
independent mixer strips, retained voice settings, Stop and initialization
cancellation are supported. Keyboard rhythm choices follow the applied audio
state, without audio polling. The website editor and mode selector remain
separate from this npm runtime payload.

`0.2.22` adds **OPL-family Synth APIs** for YM3526, YM3812, Y8950 FM and YMF262,
including two-operator voices, rhythm controls, OPL3 four-operator pairs and
stereo routing. Direct, Worklet and Node output transports share the chip-specific
register mapping. Y8950 ADPCM remains outside the high-level API.

`0.2.21` extends the **shared Playground runtime** with native primary synth
configurations, applied-state voice inspectors, channel-owned audition,
`keyboard.bind()`, host-provided `inputAudio()` and sample-instrument adapters.
It includes the HuC6280 and OKIM6258 high-level Synth modules, Game Gear stereo
controls, SNES prepared-timeline playback and bounded SPC trace helpers.
OPN updates include YM2610/B ADPCM memory transfers and acknowledged OPNA rhythm
ROM loading (`await transport.loadRhythmRom(...)`). Selected PCM rendering paths
add reusable buffers. Stop/cleanup, banked register targeting, VGM frequency-write ordering
and failed browser-audio decoding are also corrected. The website editor UI and
its named mode selector remain separate from this npm runtime payload.

`0.2.20` adds **experimental SNES/SPC support**: a CPU-free, eight-voice
S-DSP BRR instrument through Playground's `useSoundChip('snes')` and
`createSoundChip('snes')`, plus SPC700/DSP file playback cores and a browser
AudioWorklet player. Native audio is fixed at 32,000 Hz with output resampling.
Main/Worker, Mixer/FX, explicit sample tuning, declarations, and corresponding
LGPL source/build instructions are included. Real-game SPC and Tauri
compatibility testing remains ongoing; no game data or Nintendo IPL ROM is bundled.

`0.2.19` optimizes the prebuilt YM2612, Sega PSG, YM2203, YM2608,
YM2610 / YM2610B, YM2413, RF5C164 and Nuked-OPN2 WASM cores. Tested PCM
remains identical to the previous builds; runtime assertions remain enabled.
It also fixes Neo Geo runtime cleanup when closing or restarting the synth.

`0.2.18` adds the `msfa` keyword, points the package homepage to the browser
Playground, and adds a prominent try-it link alongside the runnable examples.
Runtime code and bundled engines are unchanged.

`0.2.17` bundles `tetorica-msfa-dx7-wasm` 0.3.1. It clarifies that abrupt
frequency/feedback changes apply directly, their clicks are accepted, and no
automatic parameter smoothing is added. Runtime JavaScript, declarations and
WASM are unchanged; the standalone suite now includes 77 passing tests.

`0.2.16` bundles `tetorica-msfa-dx7-wasm` 0.3.0. DX7 operator output level,
ratio/fixed frequency, fine and detune can change while notes sound, and the new
`setFeedback(0..7)` edits feedback. **Supported operator edits now also affect
sounding notes of the edited patch, including release tails.** Patch replacement
and bank loading isolate old notes; algorithm and general EG edits remain
future-note-only. This release retains ordinary unedited PCM, defines extreme
frequency phase wraparound, and fixes stale selection metadata acknowledgements.

`0.2.15` adds Object-based DX7 presets and operator editing in browser
Playground, with acknowledged async setters in Main and Worker modes.
It bundles `tetorica-msfa-dx7-wasm` 0.2.0, including the synchronous PCM-core
API, validation, public types, and English/Japanese documentation.
Existing SysEx loading and other sound-chip APIs remain unchanged.

`0.2.14` adds DX7 to browser Playground in Main and Worker modes, including
single-voice / 32-voice-bank SysEx loading, 16-voice polyphony, mixer/FX routing
and STOP cleanup. It bundles `tetorica-msfa-dx7-wasm` 0.1.0 and its licenses.
The lower-level package-root `createSoundChip` API is unchanged. MegaSynth now
uses the device's default output rate unless explicitly configured and adds
configurable chip-output RMS monitoring with `setOutputEnvelopeOptions`.

`0.2.13` adds common Hz/note/key controls to FM, PSG, Game Boy, NES and SSG
Synth APIs, with explicit `setBlockFnum` / `noteOnRaw` FM methods. Existing
three-argument raw FM calls remain supported. Playground's ten SoundChip
clients can change their master clock with `await setClock(hz)`.

Playground `play()` and internal MIDI FM playback now tune A4 to 440 Hz,
matching `setNote` and the MIDI Playground. **Existing Playground songs using
the old reference will change pitch** (A4 was approximately 337 Hz at the
default YM2612 clock). MIDI interfaces and raw BLOCK/F-NUM/VGM writes remain
unchanged. This release also includes NES PAL/NTSC clock selection and exact
register reset/memory upload helpers for VGM playback.

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

## NES APU + FDS Synth

Version 0.2.12 introduced `createSoundChip('nes')` and `NesApuSynth`. Enable FDS
with `{fds: true}`. Since 0.2.24, asynchronous creation uses the shared C++
JSNES/fixNES port through WASM. No CPU program, cartridge or instrument ROM is
needed. The synchronous `new NesApu()` constructor keeps the original JavaScript
implementation for compatibility and reference comparisons; the Analyzer's
existing JavaScript renderer is unchanged.

```javascript
import {createSoundChip} from 'tetorica-fm2612';
import {NesApuSynth, NesApuWorkletTransport} from 'tetorica-fm2612/nesapusynth.js';

const chip = await createSoundChip('nes', {execution: 'worklet', fds: true, signal});
const transport = new NesApuWorkletTransport(chip);
try {
  const nes = new NesApuSynth({transport});
  nes.pulse.setVoice(0, {duty: 0.5, volume: 10});
  await transport.start();
  nes.pulse.noteOn(0, 'C4');
  nes.fds.noteOn('E4'); // Default 64-sample sine wave.
  // Wait for the desired duration with your app's abortable timer.
  nes.pulse.noteOff(0);
  nes.fds.noteOff();
  await transport.flush();
} finally {
  await transport.close();
  await chip.dispose();
}
```

Use `NesApuDirectTransport(chip)` for owned stereo PCM via
`chip.generateStereo(frames)` or `transport.generateStereo(frames)`.
For Hz instead of musical notes, use `nes.pulse.setFrequency(0, 440)` followed
by `nes.pulse.keyOn(0)`. `nes.pulse.keyOff(0)` stops the voice and keeps its
configured pitch for the next `keyOn`. Frequency can also change while sounding.
The common `nes.setFrequency(channel, hz)` / `nes.keyOn(channel)` controls support
tone channels 0, 1, 2 (triangle) and 5 (FDS). `noteOn(channel, note)` continues to
set a note name or MIDI note number before starting playback.
Use `NesApuAudifyTransport(chip)` from `tetorica-fm2612/node/transports` for
Node device output. Transports borrow the chip. The Synth borrows the transport.
Version 0.2.13 supports source clocks from 1600000–1900000 Hz. Clocks below
1700000 Hz select PAL noise/DMC periods and frame-counter timing; higher clocks
use NTSC/Dendy timing. Playground VGM import passes the recorded clock through
`createSoundChip("nes", {clock, fds})`. Published 0.2.12 remains NTSC-only.
`clock` and FDS capability are inferred from the provided transport. For a custom
register transport or bare MessagePort, supply `clock` / `fds` explicitly.

| Part | API |
| --- | --- |
| Pulse 1 / 2 | `pulse.setVoice(0 or 1, {duty, volume, envelope, sweep})`, `setNote`, `noteOn`, `noteOff` |
| Triangle | `triangle.setNote(note)`, `noteOn(note)`, `noteOff()`; hardware has fixed volume |
| Noise | `noise.setVoice({volume, period, shortMode})`, `noteOn()`, `noteOff()`; period index 0–15 |
| DMC | `await dmc.loadSample(encodedBytes, {address})`, `dmc.play({rate, loop, level})`, `dmc.stop()` |
| FDS | `fds.setWave(samples)`, `setVolume(gain, masterScale)`, `setNote`, `noteOn`, `noteOff`, `setModulation(options)` |

Notes are names such as `C4` / `F#3` or MIDI integers. `setFrequency(channel, hz)`
accepts Hz; each channel's timer range is checked and rounded to hardware steps.
Common tone channels are 0/1 (Pulse), 2 (Triangle), 5 (FDS).
Noise uses a hardware period index and DMC uses a rate index, not musical notes.
Pulse duty is .125 / .25 / .5 / .75; fixed volume is 0–15. Envelope `{period, loop}`
selects the hardware decay mode instead of fixed volume; period is 0–15.
Sweep `{enabled, period, negate, shift}` uses 0–7 period/shift fields.

FDS waves contain 64 integers 0–63. Replacing a wave temporarily halts the
oscillator, writes RAM, then restores its control state. Fixed gain is 0–32;
master scale is 0–3. `fds.setModulation({table, rate, depth, bias, enabled})`
accepts 32 entries 0–7, raw 12-bit modulation rate 0–4095, depth 0–63 and
signed bias -64..63. Volume/wave helpers use fixed-gain mode; advanced hardware
envelopes can be programmed through `writeRegister()` after note-on.

DMC takes **pre-encoded DPCM**, not PCM/WAV. Samples contain 1–4081 bytes and are
padded with alternating-bit bytes to 16*n+1. Addresses are 64-byte aligned in
$C000–$FFFF and must fit the padded sample. Load completion is acknowledged before
playback; reset invalidates pending descriptors. DMC upload through Worklet needs
its full `createSoundChip` endpoint. Rate index is 0–15, initial DAC level 0–127.

`writeRegister(address, value)` uses native CPU addresses ($4000–$4017,
$4023, $4040–$408A), unlike VGM's packed NES offsets. FDS addresses require
`fds: true`. `reset()` resets the chip, voices and loaded DMC descriptor.
Version 0.2.13 also adds `resetRegisters()` for native reset without Synth defaults,
and `loadMemory(bytes, address)` for exact CPU RAM uploads without DMC padding;
Playground VGM import uses these to preserve the original writes and memory blocks.
The wrapper seeds the integer core's silent DAC baseline and applies a floating
10 Hz DC blocker so startup and held-DAC residuals do not produce a steady offset.
The existing Analyzer engine remains available separately.
Chip-level `SoundChipMixer`, automatic `chip.id`, and abortable creation work
with the NES Worklet endpoint like the other chips.

Register semantics follow [NESdev APU documentation](https://www.nesdev.org/wiki/APU)
and [FDS audio documentation](https://www.nesdev.org/wiki/FDS_audio).

## Common tone controls

YM2612/OPN FM, YM2151, Sega PSG, Game Boy tone channels, NES tone channels and
SSG expose `setFrequency(channel, hz)`, `setNote(channel, note)`, `keyOn(channel)`,
`keyOff(channel)` and `noteOn(channel, note)`. Notes are names or integer MIDI
numbers (A4 = 69 = 440 Hz); numbers passed to `noteOn` are never Hz. Hardware
pitch limits and quantization apply. Single-channel wave/triangle/FDS facades
omit the channel argument. Configure the voice/volume first; Game Boy still
requires `initialize()` or `adoptRegisterState()`, and FDS requires `{fds:true}`.

FM raw pitch has explicit `setBlockFnum(channel, block, fnum)` and
`noteOnRaw(channel, block, fnum)` methods. Existing three-argument
`setFrequency`/`noteOn` forms remain compatible; the new two-argument forms
mean Hz and musical notes respectively. PSG and SSG keyOff remember the
configured attenuation/volume for keyOn. Noise, rhythm, PCM and PWM retain
their chip-specific controls.

Playground `play()` and internal MIDI FM playback now use the standard A4 =
MIDI 69 = 440 Hz conversion, matching MIDI Playground and the Synth note API.
Scripts using the previous Playground reference tuning will sound higher.
MIDI handles, channels, velocity and beat-based legacy duration keep their
existing interface. Explicit raw BLOCK/F-NUM playback is unchanged.
