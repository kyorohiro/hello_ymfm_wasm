# C64 SID in the Playground

[Open C64 (SID 6581) mode](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html?mode=c64).
On a local docs server, use `/playground/index.html?mode=c64`.

Choose a C64 example and press **Run**. Main and Worker execution use the same
real WASM core in an AudioWorklet. The **SID** tab shows the three applied voices,
their Gate / ADSR / oscillator settings, shared filter and written register
shadow. Opening the tab alone does not create an audio device. The tab is
read-only at this stage; edit the code to change the sound.

For keyboard playing, open [Tetorica SID Synth](synth-sid/index.html): three-voice
allocation, hardware ADSR, Pulse width and shared filter, with a one-note Sync /
Ring pair, portable presets and readable JavaScript export. See its
[guide](synth-sid/README.md). The standalone
[SID Register Lab](playground/sid-lab/index.html) remains available for register
experiments. An offline [PSID reference comparison CLI](sid-reference.md) now
executes a bounded PAL/6581 subset, captures cycle-timed writes and writes
reference/Tetorica WAVs. For a supported `.sid` file, open the separate
[SID Player](sid-player/index.html): load the original demo or your file, then
press Play. PSID v2 uses the C64 machine's VBI or CIA interrupts per subtune,
with Direct VBI available as an explicit legacy option. RSID v2 runs its own
interrupt or continuous code in that machine. Both target PAL / one 6581;
a dedicated 8580 model remains subsequent work.
The C64 backend has a limited original IRQ environment and an optional user-ROM mode;
no C64 firmware is bundled. See [the ROM, timing and digi limits](sid-player/README.md).
The Synth and Playground APIs remain
separate instruments. Instrument extraction is tracked in [the TODO](issues/todo_sid_01.md).

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
readback. Inspection does not advance the core.

The Main / Worker scheduler tracks Gate ownership. Loop replacement and Stop
release owned notes; a retired loop cannot release a newer owner's voice.
Transport Stop also flushes queued sound, envelope and output-filter tails,
while preserving the patch for the next Run. `allNotesOff()` only lowers Gates,
so hardware release can continue.

## Additional instances and creation settings

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
instance. Created instances have their own state and Mixer entry. Only model
`'6581'` is accepted. PAL default is 985,248 Hz, NTSC is 1,022,727 Hz; creation
accepts integer clocks from 900,000 to 1,100,000 Hz. The clock stays fixed after
creation. `setClock()` acknowledges the same value and rejects a change; create
a new instance for another clock. Output uses the AudioContext rate, 8–96 kHz.

This browser implementation rejects Native audio output. The package-root raw
`createSoundChip()` has different chip coverage and does not accept SID.
Explicit modules `sid.js`, `sidsynth.js` and `playground_sid.js` are included in
the full runtime / npm distribution, with TypeScript contracts for the new
Synth and clients. This work does not publish a new npm version or add SID to
the authenticated Native SDK snapshot.

## Core, license and verification

The core is a **6581 approximation** from zlib-licensed
[chips/m6581](https://github.com/floooh/chips/tree/9e88298ce56319953ac7a43213a1120359f7a3a6).
The original pinned header, marked adaptations, BSD-3-Clause Tetorica host,
licenses and rebuild recipe are in the [matching source kit](sources/sid/README.md).
It uses a simplified filter; 8580 and analog chip variation are not modeled.
A software 12 Hz output DC blocker follows the chip. Musical note helpers,
Loop scheduling and display are software around the emulated registers.

Useful checks from the repository root:

```sh
npm run test:sid
node --test test/runtime/sidsynth.test.mjs test/runtime/playground_sid*.test.mjs
node scripts/check_playground_mode_types.mjs
node scripts/check_playground_sid_browser.cjs
node scripts/sid_artifacts.mjs --check
npm run check:runtime-artifacts
```

Native / WASM equality checks this port and its timing, not real-hardware
fidelity. Automated browser tests mute the physical output. They record
Monaco's existing editor CDN separately from unexpected audio dependencies;
SID modules and WASM are local to the source tree and independent ZIP.
