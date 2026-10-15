# Tetorica MSFA DX7 WASM

[日本語 README](README.ja.md)

A standalone DX7-compatible FM synthesizer for JavaScript and TypeScript, based
on Google's [music-synthesizer-for-android (msfa)](https://github.com/google/music-synthesizer-for-android).
Generate PCM in Node.js, play through an AudioWorklet in the browser, and load
DX7 single-voice or 32-voice-bank SysEx files. No other Tetorica package is required.

**Version 0.2.0 adds object presets:** create and edit patches with
`setPreset`, `setOperator`, `setOperators`, and `getPreset`.

**Version 0.3.0 adds live operator level/frequency changes and `setFeedback`.**
Supported operator edits now affect sounding notes of the edited patch;
see the behavior change and patch-isolation rules below.

Version **0.3.1** clarifies that abrupt frequency/feedback clicks are accepted
and adds no automatic parameter smoothing. Runtime JavaScript, types and WASM
are unchanged from 0.3.0; two rapid-change regressions bring the suite to 77 tests.

## Install

```sh
npm install tetorica-msfa-dx7-wasm
```

The package includes compiled WASM and TypeScript declarations. **Consumers do
not need Emscripten or a C++ compiler.** Node.js requires version 22 or later;
browser playback requires AudioWorklet support and HTTPS or localhost.

| Import / export | Purpose |
| --- | --- |
| `tetorica-msfa-dx7-wasm` | Offline core, object-preset types, SysEx helpers, `INTERNAL_SAMPLE_RATE`, `DEFAULT_WASM_URL` |
| `tetorica-msfa-dx7-wasm/browser` | `createDX7Node` and browser types |
| `tetorica-msfa-dx7-wasm/sysex` | Standalone SysEx parsing and encoding helpers |
| `tetorica-msfa-dx7-wasm/worklet` | AudioWorklet processor module asset |
| `tetorica-msfa-dx7-wasm/wasm/msfa.wasm` | Compiled WASM asset |

## Quick start: create a patch and render PCM

This example runs in Node.js as an ES module. It generates samples; sending
those samples to an audio device or WAV encoder is the application's responsibility.

```javascript
import {createDX7} from 'tetorica-msfa-dx7-wasm';

const synth = await createDX7({sampleRate: 44100});
try {
  synth.setPreset({
    name: 'JS BELL',
    algorithm: 0,
    operators: {
      1: {coarse: 1, outputLevel: 90},
      2: {
        coarse: 2,
        outputLevel: 68,
        envelope: {rates: [99, 75, 50, 80], levels: [99, 70, 0, 0]},
      },
    },
  });
  synth.noteOn(60, 100);             // MIDI C4, velocity 100.
  const pcm = synth.render(44100);  // One second of mono Float32 PCM.
  synth.noteOff(60);
  const tail = new Float32Array(44100);
  synth.renderInto(tail);           // Continue the same timeline into this array.
  console.log(pcm.length, tail.length);
} finally {
  synth.dispose();
}
```

`createDX7()` resolves after initialization. It loads the packaged WASM
automatically, using the filesystem in Node.js and fetching it in the browser.
Override `wasmUrl`, or supply `wasmBytes: ArrayBuffer | ArrayBufferView`, when
using a different asset location or bytes you already loaded.

Each core owns a separate WebAssembly instance and **16 MiB of fixed WASM
memory**, plus its JavaScript state. Instances do not share mutable synth state.
`INTERNAL_SAMPLE_RATE` is `44100`; `DEFAULT_WASM_URL` identifies the packaged asset.

## Object presets

The object methods are **synchronous on the PCM core**. Their browser-node
equivalents return Promises; await them to receive acknowledgement that the
Worklet applied the change.

| Method | Behavior |
| --- | --- |
| `setPreset(preset)` | Fill omitted fields from the project's INIT SINE patch, then replace the selected voice |
| `setOperator(op, patch)` | Partially update logical OP1–OP6 in the current voice |
| `setOperators([[op, patch], ...])` | Validate and apply a complete tuple batch atomically |
| `setFeedback(value)` | Set feedback `0..7` for this patch's sounding and future notes |
| `getPreset()` | Return a complete, independent `DX7PresetState` copy |

```javascript
synth.setOperator(2, {outputLevel: 60});
synth.setOperators([[1, {fine: 25}], [2, {coarse: 3}]]);
const preset = synth.getPreset();
```

Public operator labels are **1 through 6**; OP1 is the last operator block in
DX7 wire data. There is **no channel argument**. The preset's `operators` field
is a record keyed by these labels, while `setOperators` takes an array of tuples.
`DX7Preset`, `DX7OperatorParams`, `DX7OperatorEntries`, and `DX7PresetState` are
exported types; the package also exports the related envelope, LFO, scaling,
operator-label and state types.

- A setter creates voice 0 from INIT SINE when no bank is loaded.
  **Exception: `setOperators([])` is a no-op and does not create a voice.**
- `setPreset({})` resets the selected voice to INIT SINE. Operator setters retain
  the current values of fields they do not mention.
- Editing a loaded 32-voice bank preserves the selected index and the other 31
  slots. Switching away and back retains the edited patch.
- A batch must use each operator at most once. Duplicate operators, unknown
  fields, invalid values and invalid later entries reject the whole update.
  Existing patch data, bank selection and held audio are retained on rejection.
- Later mutations of an input object or a returned state cannot change the
  applied patch. Browser inputs are validated and copied before posting.
- A fresh standalone core/node has no loaded bank: `voices` is empty and
  `selectedVoice` is `-1`. `getPreset()` throws/rejects until a voice exists.

### Parameter values

These are **raw DX7 values**, not seconds, hertz, decibels, or MIDI channels.
All numeric values below must be finite integers within their range.

| Field | Values |
| --- | --- |
| `algorithm` / `feedback` | `0..31` / `0..7`; algorithms correspond to hardware display 1–32 |
| `name` | Up to ten printable ASCII characters |
| `operators[op].outputLevel` | `0..99`; larger is louder, unlike YM2612 total level |
| `coarse` / `fine` / `mode` | `0..31` / `0..99` / `'ratio'` or `'fixed'` |
| `detune` | `0..14`, neutral `7` |
| `envelope` / `pitchEnvelope` | Optional `rates` and `levels`, each exactly four values in `0..99` |
| `keyboardScaling` | `breakpoint`, `leftDepth`, `rightDepth`: `0..99`; `leftCurve`, `rightCurve`: `0..3` |
| `rateScaling` / `velocitySensitivity` | `0..7` / `0..7` |
| `ampModSensitivity` | `0..3`; retained, subject to the engine limitations below |
| `lfo` | `speed`, `delay`, `pitchModDepth`, `ampModDepth`: `0..99`; `waveform`: `0..5`; `pitchModSensitivity`: `0..7`; `sync`: boolean |
| `transpose` | `0..48`, neutral `24`; retained, subject to engine limitations |
| `oscillatorSync` | Boolean; retained, subject to engine limitations |

### Live parameters (0.3.0)

`setOperator` / `setOperators` apply changed **outputLevel, mode, coarse, fine
and detune** to this patch's sounding notes, including release tails. Notes keep
their oscillator phase, envelope stage, key state, original velocity and keyboard
scaling. Other operator fields, algorithm and EG shape remain future-note-only.
`setFeedback(0..7)` updates feedback without replacing the rest of the patch.

Patch identity follows each bank slot across `selectVoice` calls. Replacing a
slot with `setPreset`, or loading a new bank with `loadSysex`, starts new identities:
old notes continue with their previous patch and later edits do not rewrite them.
Selecting a different patch does not rewrite old operators/EGs either. A shared
LFO is still reconfigured on selection/replacement; its phase is retained.
Live level/frequency/feedback edits do not touch the shared LFO.

The core applies edits synchronously; browser/Playground setters return Promises.
They affect the next ungenerated **64-frame internal block**, after any generated
PCM leftovers and resampling lookahead. An acknowledgement reports applied state,
not that the audio device has played it.

**Abrupt frequency and feedback changes are applied directly. Waveform
discontinuities and audible clicks caused by those changes are accepted API
behavior.** The engine adds no automatic parameter smoothing, frequency glide,
feedback interpolation, crossfade or click suppression. Oscillator phase, EG
progression and feedback history are retained; an edit does not retrigger a note.
Users may explicitly supply intermediate parameter values when desired.

The existing upstream 64-frame operator-gain interpolation and the 44.1-to-48 kHz
PCM output resampler are retained. They do not interpolate frequency/feedback
control values. Invalid values such as NaN or Infinity reject atomically; non-finite
PCM, corrupted amplitude, divergence and crashes are not accepted consequences
of parameter changes. The normal Int16 clipping and Float32 output range remain
as described below.

Live level control preserves the existing progressing EG as a fixed reference
and changes operator attenuation. An initially silent/clamped operator uses a
parallel full-level EG trajectory so it can become audible without retriggering.
This deliberately preserves elapsed attack/release under mute; it does not claim
hardware-identical timing after arbitrary level edits. A completed release stays
completed. The original path remains bit-identical when no live edit is made.

In Playground, numeric `tween` durations are seconds. Return the setter Promise
so `tween` waits for application and propagates errors:

```javascript
dx7.noteOn(60, 100);
await tween(1, progress =>
  dx7.setOperator(2, {outputLevel: Math.round(99 * progress)})
);
dx7.noteOff(60);
```

This intentionally changes supported operator edits from 0.2.0's future-note-only
behavior. The API signatures and unedited PCM are retained. General envelope and
algorithm live editing remain outside this increment.
Extreme valid ratios/notes/pitch envelopes use defined modular phase increments
above the original LUT's 20-octave range; ultrasonic frequencies alias. Ordinary
unedited PCM is unchanged, while the former out-of-range shift was undefined.

## Load and encode SysEx

```javascript
import {readFile} from 'node:fs/promises';
import {createDX7} from 'tetorica-msfa-dx7-wasm';

const synth = await createDX7();
try {
  await synth.loadSysex(new Uint8Array(await readFile('./voices.syx')));
  synth.selectVoice(0);
  synth.noteOn(60, 100);
  const pcm = synth.render(44100);
  console.log(synth.voices, pcm.length);
} finally {
  synth.dispose();
}
```

`loadSysex()` validates the entire message, replaces the bank and selects voice
0. Invalid input preserves the existing bank. Supported messages are one
**163-byte single-voice dump** or one **4,104-byte 32-voice-bank dump**. Framing,
length, seven-bit data, checksum, parameter ranges and reserved packed bits are
validated. Concatenated dumps and real-time parameter-change SysEx are unsupported.

The following helpers are available from the package root or `/sysex`:

| Helper | Input and result |
| --- | --- |
| `parseSysex(bytes)` | Complete message → `{voices, format, channel}`; each voice contains copied VCED `data`, VMEM `packedData`, and a display name |
| `packVoice(data)` | 155-byte VCED voice → copied 128-byte VMEM voice |
| `unpackVoice(packedData)` | 128-byte VMEM voice → copied 155-byte VCED voice |
| `createVoiceSysex(data, {channel?})` | One 155-byte voice → complete single-voice dump |
| `createBankSysex(voices, {channel?})` | Exactly 32 155-byte voices → complete bank dump |
| `createInitVoice(name?)` | New project-authored one-carrier INIT SINE voice |

The codec's optional `channel` is the zero-based Yamaha device/channel nibble
`0..15`, default `0`; it does not add channelized performance to the synth.
Core/codec byte inputs accept an `ArrayBuffer` or an `ArrayBufferView`, respecting
its offset and length. The browser node's `loadSysex` accepts an `ArrayBuffer`
or `Uint8Array`. Wrap raw VCED/VMEM data in a complete message before passing it
to `loadSysex`; raw voice arrays alone are not accepted there.

## Core performance and PCM API

| Member | Behavior |
| --- | --- |
| `voices`, `selectedVoice` | `{index, name}` metadata and the selected zero-based bank index |
| `selectVoice(index)` | Select a loaded voice for future notes |
| `noteOn(note, velocity = 100)` | MIDI note and velocity integers `0..127`; velocity 0 is Note Off |
| `noteOff(note)` | Release all held voices of this pitch |
| `allNotesOff()` | Release all held voices and allow their envelopes to continue |
| `panic()` | Immediately clear notes, filter state, queued PCM and resampler history; retain the selected patch |
| `render(frames)` | Allocate and return an owned mono `Float32Array` |
| `renderInto(buffer)` | Fill a caller-owned `Float32Array` and advance by its full length |
| `dispose()` | Destroy the instance; safe to call repeatedly |

Both render methods continue the same audio timeline. Returned buffers survive
later renders and disposal. Zero frames are allowed; negative, fractional,
non-finite or more than **16,777,216** frames are rejected. `renderInto` accepts
only a `Float32Array` and enforces the same length limit. Performance, patch and
render methods reject after disposal, including empty operator batches.

## Browser playback

Use this inside an Audio Start button handler or another user gesture:

```javascript
import {createDX7Node} from 'tetorica-msfa-dx7-wasm/browser';

const context = new AudioContext({latencyHint: 'interactive'});
let instrument;
try {
  await context.resume();
  instrument = await createDX7Node(context);
  instrument.node.connect(context.destination);
  await instrument.setPreset({name: 'JS SINE'});
  await instrument.setOperator(1, {outputLevel: 85});
  instrument.noteOn(60, 100);
  await new Promise(resolve => setTimeout(resolve, 1000));
  instrument.noteOff(60);
  await new Promise(resolve => setTimeout(resolve, 500)); // Allow this patch's release.
} finally {
  instrument?.dispose();
  await context.close();
}
```

`createDX7Node` resolves only when WASM is ready and returns an **unconnected,
mono** `AudioWorkletNode` as `node`. The caller owns the AudioContext.
`loadSysex`, `setPreset`, `setOperator`, `setOperators`, `setFeedback`, and `getPreset` return
Promises. Notes and selection remain synchronous message sends. Commands share
an ordered MessagePort: a subsequent Note On cannot overtake a preceding patch
update or bank load. There is no exposed pre-initialization event queue.

Invalid object requests reject their own Promise and leave the instrument
usable. Setup failures reject `createDX7Node()`; failures before the node exists,
such as an invalid context, module load or WASM download failure, do not invoke
`onError`. Fatal Worklet initialization/render failures and later context
closure invoke `onError(error)`, reject pending operations and release resources.
`dispose()` also rejects pending requests and is idempotent.

### Serve or bundle the assets

With directly served ES modules, preserve the package's relative `src/` and
`wasm/` layout. Bare imports need a bundler or an import map.

For Vite, explicitly bundle the Worklet and emit the WASM asset:

```javascript
import {createDX7Node} from 'tetorica-msfa-dx7-wasm/browser';
import workletUrl from 'tetorica-msfa-dx7-wasm/worklet?worker&url';
import wasmUrl from 'tetorica-msfa-dx7-wasm/wasm/msfa.wasm?url';

const instrument = await createDX7Node(context, {workletUrl, wasmUrl});
```

`workletUrl`, `wasmUrl`, and `wasmBytes` support custom deployment locations.
The core's `wasmUrl`/`wasmBytes` options are useful for browser-side offline
rendering too. Compiling application JavaScript alone does not copy all runtime
assets; include the Worklet, its dependencies and WASM in your deployment.

## Audio model and limitations

- **Mono, 16 voices.** The upstream allocator is retained: when all 16 keys are
  held, another Note On is ignored. Released slots can be reused before their
  tails finish. Repeated same-pitch Note On allocates separate voices; Note Off
  releases every held voice of that pitch. No custom held-voice stealing is added.
- **44,100 Hz internally.** Output `sampleRate` is `44100` by default; only
  `44100` and `48000` are supported. The browser uses the actual
  `AudioContext.sampleRate`. Other rates reject explicitly.
- 48 kHz output uses stateful linear interpolation, preserving pitch, duration
  and render-chunk continuity. This is not a high-order band-limited resampler.
- DSP runs in **64 internal-frame blocks**. Events affect the next ungenerated
  block; already generated leftovers and interpolation lookahead are unchanged.
  No sample-accurate event scheduler is exposed.
- PCM is the upstream clipped Int16 output divided by 32,768: range **−1 to
  32767/32768**. Float32 storage retains that 16-bit output quantization. There
  is no added automatic gain, compressor, dither or limiter.
- Operator AM sensitivity and LFO amplitude-modulation fields are retained but
  not fully applied by this upstream engine. Transpose and oscillator key sync
  are retained but not applied; operator phases reset on each Note On.
- The upstream shared resonant output filter is retained. This does not assert
  that its output matches the physical DX7 analog stage.
- Used voice slots continue computing after their release envelopes finish,
  bounded at 16. Live edits do not restart completed envelopes.
- The API is one instrument, not a multitimbral MIDI rack. MIDI channel routing,
  Web MIDI input and raw streaming/parameter-change SysEx are not included.

This is an msfa-derived DX7-compatible engine, not a full DX7 firmware emulator
or a claim of bit-identical hardware output.

## Develop and run the demo

These requirements apply to **building this repository**, not installing the
npm package: Node.js 22+, npm and Emscripten (`em++`). Native comparison also
uses a C++17 compiler, default `clang++`. Override them with `EMXX` and `CXX`.

```sh
npm ci
npm run build:wasm
npm run dev
```

Open `/demo/` at the printed local URL and click **Audio Start**. The keyboard
uses mouse/touch or `A W S E D F T G Y H U J K`. Load a `.syx` file to browse its
voices. The demo starts with the project's own INIT SINE, whose SysEx can also
be downloaded. Third-party voice banks are not bundled.

`npm run build` builds WASM and the production demo. Serve `dist/` as static
files; the demo entry is `/demo/`. HTTPS or localhost is required for AudioWorklet.

## Tests

```sh
npm test
npm run typecheck
npm run test:native
npm run test:lifecycle
npm run test:live-native
npm run test:browser
npm run test:package
```

Build WASM first when testing a source checkout. Native comparison uses the
same minimally patched scalar msfa and adapter as WASM, not DX7 hardware.
The lifecycle probe uses AddressSanitizer and explicit allocation tracking;
macOS uses the allocation counter because Apple's leak detector is unsupported.

Browser checks require the development Playwright dependency and installed
browsers (`npm exec playwright install chromium webkit firefox`). They exercise
real AudioWorklet PCM, object/SysEx ordering, error cleanup and the demo.
The package check installs a local tarball in isolation, verifies Node PCM and
strict public TypeScript APIs, and builds a Vite consumer using exported assets.
It does not publish anything. Results and unverified environments are recorded
in [docs/verification.md](docs/verification.md).

## Upstream and license

The engine is pinned to msfa commit
`f67d41d313b7dc85f6fb99e79e515cc9d208cfff`. The original scalar operator kernels,
algorithm routings, allocator, filter and clipping are retained. Local changes
provide deterministic initialization, ownership/disposal, direct control,
live envelope attenuation and defined extreme-frequency phase arithmetic, as
described above and in the research record. Native comparison also
uses the scalar path rather than the approximate ARM NEON kernel.

Both msfa and the new code use **Apache-2.0**. Copyright headers and upstream
licensing are preserved. See [LICENSE](LICENSE),
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md),
[vendor/msfa/UPSTREAM.md](vendor/msfa/UPSTREAM.md), and the implementation
investigation in [docs/research.md](docs/research.md). No Dexed code is included.
