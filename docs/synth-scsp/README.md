# Tetorica SCSP Synth

Explore Sega Saturn PCM, envelopes, LFO and sound-stack FM with a shared
Keyboard / Code workflow. Serve the website over HTTPS or localhost and open
`synth-scsp/index.html`. The standalone itch.io ZIP starts at `index.html`.
AudioWorklet requires a secure context.

## Play and edit

Enable audio, then use the screen keyboard or its displayed computer-key
labels. Keyboard offers the common fretboard layout, instrument selection,
Octave controls and Pitch bend. Computer keys also work in Code view while
focus is outside the text editor. The two Pitch wheels spring back to zero.
Master ranges from 0 to 380 percent, with an orange bar above 100 percent.

Numeric fields have minus / plus buttons and horizontal dragging. Their
original number inputs also accept typed values. Selecting a choice releases
focus so computer keys can continue playing.

Choose PCM, 2-operator FM, 4-operator FM or 6-operator FM. Six slots hold
the A–F editing sources. The other 26 slots provide 26 PCM, 13 two-op,
6 four-op or 4 six-op simultaneous voices. Each key owns its complete group.
Released groups are stolen first, followed by the oldest held group.

Chain connects operators in series. Pairs uses parallel two-op groups.
Branch provides a tree with up to two inputs per slot. The diagram shows
every connection and output, and its A–F buttons select the editing operator
on the same waveform canvas. These fixed connections and grouped allocation
are software tools over the SCSP slot modulation hardware. Free wiring and
operator feedback remain follow-up work.

Draw a waveform or import browser-supported audio, apply the PCM, then play
a new note. Apply before changing the editing operator to retain a drawing.
Each operator has its own PCM, envelope, LFO, mix and frequency ratio.
The waveform editor accepts audio files up to 64 MiB and selects 2–65,535
mono samples for SCSP RAM. Lower the selection rate for longer regions.
Set the recorded root MIDI note manually. Operators with incoming FM require
a full forward loop starting at sample zero. The software allocator adds
repeated waveform guards for supported modulation depths 0–12.

PCM and envelope edits affect new notes. Sounding and releasing groups keep
their original PCM. Pitch, ratios, modulation depth, mix and LFO update active
groups. Mode and Connection changes stop existing notes after validation.
All modulator ratios sets A to 1 and B–F to the chosen ratio, after which each
ratio can be edited separately. PCM uses A at the keyboard pitch. Output
operators supply the audible Direct level and Pan.

## Code

Select Code and press Run. The starter plays the current sound using beats,
so changing BPM changes its tempo.

```javascript
const scsp = await useSoundChip("scsp");
setBpm(120);

liveLoop("melody", async () => {
  const notes = scale("C4", "minorPentatonic", 1);
  await scsp.noteOn(CH1, choose(notes));
  await beat(0.5);
  await scsp.noteOff(CH1);
  await beat(0.25);
});
```

Code borrows the same SCSP, authored PCM / FM patch, allocator and Master
output as the controls. Keyboard notes and parameter edits can run alongside
Code. Switching between Keyboard and Code keeps the program running.
Run creates a fresh context. Apply retains context and named loops.
Stop releases Code groups through a short software fade. Stop all sound also
stops keyboard groups, the recording player and shared DSP echoes.

Note and frequency methods address logical performance lanes 0–31. CH1–CH6
are supplied constants for lanes 0–5. Each lane receives a dynamically
allocated physical slot group for the selected PCM or FM mode. Source-editing
methods such as `setMix`, `setEnvelope`, `setLfo` and `applyPCM` address
operators A–F through indices 0–5.

```javascript
// Change source A's mix while the melody continues.
await scsp.setMix(0, { pan: 8 });
await scsp.setConfig({ fm: { depth: 8 } });
```

The scoped API also provides `setPreset`, `getPCM`, `loadPCM`, `setNote`,
`setFrequency`, `keyOn`, `keyOff`, `allNotesOff`, `getState`, `setEffect`,
`exportPatch` and `loadPatch`. Await mutations to preserve their execution
order. Monaco supplies types, completion and implementation navigation.
Monaco loads from a CDN, and a visible textarea remains available when it
cannot load. Expand places Code beside Files. The live runtime supports
`livePrepare`, `liveLoop`, `stopLoop`, `context`, `tween` and `liveFx`.
`liveFx` applies a separate software effect rack after the SCSP output.

## Files and presets

Files contains `index.js`, reusable modules, JSON instruments and original
recordings. Use its context menu to duplicate, rename, delete or create files
and folders. Menu contains file and Cassette import / export. Save to presets
stores the current applied instrument in `presets/`. Selecting an instrument
loads it while keeping Code running. Selecting JSON in Keyboard view retains
that view. JSON can be inspected in Code.

Local drafts save in browser storage. Export Cassette creates a portable
project. Files uses a 12 MiB aggregate budget, reserving the remaining space
within the shared 16 MiB Cassette limit for project metadata and applied PCM.
The waveform editor's direct audio import has its separate 64 MiB input limit.
Loading a project requires Run to begin Code execution.

Instrument JSON uses version 4 and includes six applied PCM sources,
EG / LFO / mix, mode, connection, ratios, modulation depth, transpose and
experimental Delay settings. Direct instrument files are limited to 8 MiB.
Versions 1–3 remain readable. Version 1 becomes PCM, version 2 receives
default C–F operators, and version 3 retains all six operators. Older versions
receive disabled DSP settings. Unapplied waveform drafts stay in the editor.
Invalid replacements preserve the current instrument.

## Reference recordings

SCSP has VGM register and RAM recording support. Menu → VGM / VGZ imports
the original file into `vgm/`. Select a recording above Waveform / Spectrum
and use Play song, Pause / Resume, Stop or the seek bar. Demo builds an
original short sine phrase for checking this path without a game recording.
Loading and selecting a recording are silent.

This first player supports a single 22,579,200 Hz SCSP in VGM 1.71–1.72,
`C5` byte writes, `E0` RAM uploads, raw `06` banks and `68` RAM copies,
with playback following the recorded timeline once. It validates the source
before replacement. The parser bounds compressed, expanded and prepared
streams to 64 MiB each. Imports into Files also obey the project budget.
Recorded CPU timer, IRQ, MIDI and inactive DMA setup writes are omitted with
a message, as their resulting audio writes are already present in the log.
DMA execution, 256 KiB memory mode, extra-header overrides, additional chips
and unsupported core registers produce explicit errors.

Song playback uses its own SCSP state and RAM through the existing
AudioContext and Master output. The keyboard continues to audition the
authored instrument. Starting a song stops Code, and Run stops the song.
Song-slot Live display, instrument capture and SSF / MiniSSF playback remain
future work. SSF carries a Saturn sound-CPU program and requires a 68000
execution environment with its timing and library dependencies.

The recording formats are described in the original VGM and PSF specifications.
[VGM specification](https://github.com/vgmrips/vgmplay-legacy/blob/master/VGMPlay/vgmspec171.txt)
and [PSF / SSF specification](https://gist.github.com/SaxxonPike/11618bd321a45a70c01febae43ff564e).

## Experimental DSP Delay

The DSP tab marks assembler and microprogram editing as under construction.
Its collapsed experimental section retains the existing fixed mono Delay.
The tab indicates when this effect is enabled. A six-step program runs in
the SCSP DSP. Enable it and release a short note to hear repeats.

Time spans 20–700 ms, Feedback 0–0.85, and Send / Return hardware levels
0–7. Initial Send 7 / Return 6 produces a first echo near half the dry
amplitude. Output operators feed the effect. Direct level zero allows
wet-only output. Time / Enable changes clear echoes, and ordinary release
retains the tail. Stop all sound and Mode / Connection changes clear it.
The first 64 KiB of RAM remains reserved for the DSP ring, leaving
448 KiB for editor PCM and modulation guards. Feedback, Send and Return
update live. DSP Lab provides a dedicated dry / wet comparison.

## Implementation and distribution

Slot PCM, EG, LFO, modulation and the fixed Delay execute in the SCSP core.
Drawing, conversion, guard samples, connection presets, grouped voices and
Code are software features. The bundled core uses zero slot-write delay.
Physical SCSP timing, low-depth modulation and address clipping still need
hardware comparison. Large raw SCSP sums can saturate.

Runtime modules and WASM are local in the archive. Monaco is optional and
loads externally. Navigation links open the full website. The included demo
is original. SCSP / DSP C++ sources, pristine MAME upstream, licenses and
the Emscripten recipe are under `sources/`. Start with `sources/SCSP.md`.
The SDK retains its unpublished local-candidate provenance. See `LICENSE`
and `licenses/mame-scsp/LICENSE` for BSD-3-Clause terms.

Authored JavaScript and CSS are copied byte-for-byte into the distribution,
preserving comments, names and layout. Edit modules in `synth-scsp/`, `js/`
or `playground/` and reload the served page. The same frontend tree can be
packaged in Tauri. `sources/scsp-synth-browser.json` records source paths,
hashes and imports. `sources/scsp-synth-browser-inputs.zip` contains the
original inputs and packaging recipe. Generated Emscripten files retain
their original bytes under `generated/`. Code software-effect C++ sources
and a build recipe are included under `sources/code-effects/`.
