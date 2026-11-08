# C64 SID in the Playground

[Open C64 (SID 6581) mode](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html?mode=c64).
On a local docs server, use `/playground/index.html?mode=c64`.

Choose a C64 example and press **Run**. Main and Worker execution use the same
real WASM core in an AudioWorklet. The **SID** tab shows the three applied voices,
their Gate / ADSR / oscillator settings, shared filter and written register
shadow. Opening the tab alone does not create an audio device. The tab is
read-only at this stage; edit the code to change the sound. The primary `sid`
defaults to **6581**. An independent **8580 Preview** can be created in Main or
Worker code with `createSoundChip('sid', {model:'8580'})`; it requires PAL timing.

For keyboard playing, open [Tetorica SID Synth](synth-sid/index.html): three-voice
allocation, hardware ADSR, Pulse width and shared filter, with a one-note Sync /
Ring pair, 6581 / 8580 Preview selection, portable presets and readable JavaScript export. See its
[guide](synth-sid/README.md). The standalone
[SID Register Lab](playground/sid-lab/index.html) remains available for register
experiments. An offline [PSID reference comparison CLI](sid-reference.md) now
executes a bounded PAL/6581 subset, captures cycle-timed writes and writes
reference/Tetorica WAVs. For a supported `.sid` file, open the separate
[SID Player](sid-player/index.html): load the original demo or your file, then
press Play. PSID v2 uses the C64 machine's VBI or CIA interrupts per subtune,
with Direct VBI available as an explicit legacy option. RSID v2 runs its own
interrupt or continuous code in that machine. Player targets PAL / one SID,
with Auto / 6581 / 8580 Preview selection. Direct VBI is a 6581-only option.
The C64 backend has a limited original IRQ environment and an optional user-ROM mode;
no C64 firmware is bundled. See [the ROM, timing and digi limits](sid-player/README.md).
The Player's **Voice snapshot → SID Synth** section captures a fresh applied
register snapshot for Voice 1, 2 or 3. Supported single-wave voices and isolated
two-voice Sync / Ring pairs can be saved as a Synth preset or opened directly in
the Synth on the same origin. Selecting a modulation carrier captures its
preceding oscillator's frequency ratio automatically; the pair is remapped to
the Synth's silent voice 3 → carrier 1 connection. The source's audible output
and the remaining song voice are not copied. It retains
the running model, waveform, Pulse width, ADSR codes and the selected voice's
shared-filter routing / settings and chip volume. Musical pitch, elapsed
envelope / phase and the tune's later software changes are not restored; the
Synth starts a new keyed note. Unsupported combinations show a reason.
See [the capture workflow and limits](sid-player/README.md#capture-a-voice-for-sid-synth)
and [the TODO](issues/todo_sid_01.md). The Synth and Playground remain independent
instruments; capturing does not change the playing tune.

Open a SID directly in the Synth's **Sounds from SID** section with
**Load SID… → Play song → Capture voices → Voice 1/2/3**.
Selecting a captured Voice loads it immediately. During preview, the Synth's
**Your sound** can follow **CH 1 / CH 2 / CH 3** with **Live CH view while playing**.
**Pause** holds the current state for CH inspection and Capture; **Resume**
continues the same CPU / SID instance and song position.
This passive view shows sampled register changes, including states that cannot
be imported as presets; switch it off to return to the keyboard editor.
This compact preview uses the built-in PAL C64 environment, without user ROMs
or Direct VBI choices. File selection preserves the keyboard preset; using a
captured voice stops the preview and applies that preset. The same snapshot
limits apply. See [the direct import workflow](synth-sid/README.md#open-a-sid-and-use-its-sound).

## Musical and register controls

The primary API is `sid`. Channels are the three **physical** voices `0`, `1`,
`2`; note helpers do not create extra oscillators or allocate a modulator.
Numbers passed as notes are integer MIDI notes; `setFrequency()` uses Hz.

```js
sid.setVoice(0, {
  waveform: 'saw', pulseWidth: 2048,
  attack: 2, decay: 6, sustain: 12, release: 5,
  sync: false, ring: false, test: false,
});
sid.setFilter({mode:'lowpass', cutoff:600, resonance:8, routing:1, volume:8});

liveLoop('sid-lead', async () => {
  sid.noteOn(0, 'C4');
  await beat(0.75);
  sid.keyOff(0); // Hardware release continues.
  await beat(0.25);
});
```

Voice controls are waveform, 12-bit pulse width (`0..4095`), four ADSR codes
(`0..15`) and Sync / Ring / TEST bits. Hardware Sync / Ring use the preceding
physical oscillator: **3 → 1 → 2 → 3**. Ring affects Triangle. To silence a
third-voice modulator, use `voice3off:true` and keep that voice out of filter
routing. TEST resets/holds an oscillator; it is not a musical mute.
Waveform selection and Gate do not stop oscillator phase: an unselected
waveform can still supply Sync / Ring in either model. The marked 6581 core
separates this phase from its simplified output-latch fade. That fade does not
model the physical floating-DAC decay time.

The chip has **one shared filter**. `routing` is a mask: `1`, `2`, `4` select
voices 1, 2, 3. `cutoff` is an 11-bit register code (`0..2047`), not Hz;
`resonance` and shared `volume` are `0..15`. Modes are `off`, `lowpass`,
`bandpass`, `highpass`, `notch` (LP + HP), `lowpass+bandpass`,
`bandpass+highpass`, and `lowpass+bandpass+highpass`. Selected LP / BP / HP
outputs are added together with one shared Cutoff and Resonance. For example:

```js
sid.setFilter({mode:'lowpass+bandpass', cutoff:600, resonance:8, routing:7});
```

**`mode:'off'` disables the filter outputs. Routed voices then become silent.**
For dry output, use `sid.setFilter({mode:'off', routing:0})`. The initialized
defaults use this dry route and volume 8. The System Mixer starts SID at neutral
gain 1 and marks it unmeasured; there is no claimed loudness calibration yet.

`writeRegister(address, value)` uses chip-local addresses `0..31` and bytes
`0..255`. `await sid.readRegister(address)` is a real bus read (OSC3 = 27,
ENV3 = 28); most SID registers are write-only. `await sid.getState()` and the
SID tab expose written-value shadows and debug fields, not invented hardware
readback. Inspection does not advance the core. The 8580 Preview does not expose
per-voice envelope or phase observations: these fields are `null`, shown as a
dash in the SID tab. Actual OSC3 / ENV3 bus reads remain available; POT reads
are explicitly unsupported by that model.

The Main / Worker scheduler tracks Gate ownership. Loop replacement and Stop
release owned notes; a retired loop cannot release a newer owner's voice.
Transport Stop also flushes queued sound, envelope and output-filter tails,
while preserving the patch for the next Run. `allNotesOff()` only lowers Gates,
so hardware release can continue.

## Additional instances and creation settings

Create a separate 8580 Preview while retaining the default 6581 `sid`:

```js
const sid8580 = await createSoundChip('sid', {
  id: 'sid:8580-preview', model: '8580',
});
sid8580.setVoice(0, {waveform:'saw', attack:2, decay:6, sustain:12, release:5});
sid8580.noteOn(0, 'C4');
await sleep(1);
sid8580.keyOff(0);
// await sid8580.dispose(); // Retire this instance when it is no longer needed.
```

The same musical and register helpers apply to both models. Each instance owns
its three voices, shared filter and Mixer entry. Creating an 8580 does not
replace the primary `sid`. Model selection is fixed at creation; create another
instance to change it. This is a CPU-free chip instrument, not a C64 song player.

The 6581 also supports a separately selected clock, for example NTSC:

```js
const otherSid = await createSoundChip('sid', {
  id: 'sid-ntsc', clock: 1022727, model: '6581',
});
otherSid.setVoice(0, {waveform:'triangle'});
otherSid.noteOn(0, 'A3');
await sleep(1);
otherSid.keyOff(0);
await otherSid.dispose();
```

`await useSoundChip('sid')` reuses the current primary or a cached independent
instance. Model defaults to `'6581'`. For 6581, PAL default is 985,248 Hz, NTSC
is 1,022,727 Hz; creation accepts integer clocks from 900,000 to 1,100,000 Hz.
Model `'8580'` requires exactly **985,248 Hz**. The clock stays fixed after
creation. `setClock()` acknowledges the same value and rejects a change; create
a new instance for another clock. Output uses the AudioContext rate, 8–96 kHz.

This browser implementation rejects Native audio output. The package-root raw
`createSoundChip()` has different chip coverage and does not accept SID.
The checked-in runtime provides explicit `sid.js`, `sid8580.js`, `sidsynth.js`
and `playground_sid.js` modules with TypeScript contracts. This browser change
does not publish a new npm version or add SID to the authenticated Native SDK
snapshot; confirm a package version's contents before using these new modules
from npm.

## Core, license and verification

The default core is a **6581 approximation** from zlib-licensed
[chips/m6581](https://github.com/floooh/chips/tree/9e88298ce56319953ac7a43213a1120359f7a3a6).
The original pinned header, marked adaptations, BSD-3-Clause Tetorica host,
licenses and rebuild recipe are in the [matching source kit](sources/sid/README.md).
It retains its simplified filter. The **8580 Preview** uses the separately
pinned MIT [sidera model](https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/third_party/sidera/README.md) through
[Sid8580Core](js/sid8580.js). That adapter reuses the existing
endpoint WASM's standalone batch API; it instantiates no C64 CPU and calls no
JavaScript callback per chip cycle. The research cutoff and resonance fit
profiles remain off. A software 12 Hz output DC blocker follows each chip.
Neither model promises real-chip fidelity or covers analog unit variation.
Musical note helpers, Loop scheduling and display are software around the
emulated registers.

The standalone Playground package includes readable browser modules and the
8580's unchanged WASM, matching C/C++/Rust sources, licenses, notices and
rebuild receipt alongside the original 6581 kit. The shared rebuild kit retains
both 8580 machine artifacts; this instrument loads only `sid8580-endpoint.wasm`.
The fixed Native SDK snapshot remains separate.

Useful checks from the repository root:

```sh
npm run test:sid
node --test test/runtime/sid8580.test.mjs test/runtime/sidsynth.test.mjs test/runtime/playground_sid*.test.mjs
node scripts/check_playground_mode_types.mjs
node scripts/check_playground_sid_browser.cjs
node scripts/sid_artifacts.mjs --check
node scripts/sid_model_artifacts.mjs --check
npm run check:runtime-artifacts
```

Native / WASM equality checks this port and its timing, not real-hardware
fidelity. Automated browser tests mute the physical output. They record
Monaco's existing editor CDN separately from unexpected audio dependencies;
SID modules and WASM are local to the source tree and independent ZIP.
