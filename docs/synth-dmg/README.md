# Tetorica DMG Synth

Project identifier: `tetorica-dmg-synth`.

Product identifier: `tetorica-dmg-synth`.

[Open the synthesizer](index.html) · [Game Boy Playground](../playground/index.html?mode=gameboy)

Play Pulse, Wave and Noise as an instrument, draw a Wave RAM cycle and take
the settings away as a preset or JavaScript. This English-language browser
app uses the existing Game Boy DMG APU core and Synth APIs, with the compact
keyboard and output display used by Tetorica's FM2612 / SPU Synths.

## Play and edit

1. Select **Enable audio**, then click a key or play the displayed computer keys.
2. Choose **Pulse**, **Wave** or **Noise** under **Source**.
3. Change its controls, save the instrument, or select **Copy JavaScript**.

Opening the page or editing a source does not start an audio device. Playing
a key can also initialize audio. All keyboard keys play the selected source;
there is no split by keyboard region.

One APU supplies the following physical channels:

| Source | Keyboard voices | Sound controls |
| --- | --- | --- |
| Pulse, Sweep off | Two, using CH1 / CH2 | Duty, initial volume and hardware volume envelope |
| Pulse, Sweep on | One, using CH1 | The same controls plus hardware pitch sweep |
| Wave | One, using CH3 | 32 four-bit samples and hardware output level |
| Noise | One, using CH4 | Clock divisor / shift, 7- or 15-bit LFSR and hardware volume envelope |

The keyboard allocator prefers an available channel in round-robin order. If
all channels for the source are occupied, a new key replaces the oldest note.
Releasing the replaced key cannot stop its replacement. Changing Source or
enabling / disabling Sweep stops held notes. The voice capacity is shown above
the editor. This initial version does not duplicate APUs to add polyphony.

**Noise does not follow musical note pitch.** Every keyboard key triggers the
same configured noise; its clock and LFSR width set the character. Both Pitch
wheels are disabled for Noise.

Guitar / Bass / Ukulele, fret positions and visible string ranges change the
keyboard layout. **Octave − / +** shifts it by up to two octaves. Tone keys
below the selected hardware channel's frequency range are disabled; raise the
octave to use them. **Pitch** bends sounding Pulse / Wave notes by up to two
semitones and returns to center on release. The wheels to the right of the
output display and to the left of the keyboard stay synchronized. At the hardware pitch limit, an
unavailable bend is rejected while the previous valid pitch is kept.

**Stop all sound** stops notes while retaining the instrument. Leaving the
page, switching away from its window or hiding the page also releases keyboard
notes. Code has its own Stop control; leaving the page stops it too. If
the audio engine fails, select **Enable audio** to reconnect.

## Keyboard / Code, Files and Live

Select **Code** beside Keyboard to edit `/index.js` in the same Synth. **Run**
starts a fresh performance, **Apply** updates named loops while preserving
`context` and `livePrepare`, and **Stop** fades the software output and restores
your edited instrument and Wave RAM. Switching back to Keyboard also stops Code.
Code borrows the same APU, Master and output display; it does not create extra
hardware voices. Editing an instrument or loading a preset stops Code first.

The starter uses the current sound: CH1 for Pulse, CH3 for Wave, CH4 for Noise.
Use `await` for chip operations. You can also address all four physical channels:

```js
const gb = await useSoundChip("gameboy");
setBpm(120);

liveLoop("four-channels", async () => {
  await gb.pulse.noteOn(CH1, "E4");
  await gb.pulse.noteOn(CH2, "B3");
  await gb.wave.noteOn("E2");
  await gb.noise.keyOn();
  await beat(0.25);
  for (const channel of [CH1, CH2, CH3, CH4]) await gb.keyOff(channel);
  await beat(0.75);
});
```

CH constants are zero-based: CH1 is 0 and CH4 is 3. Noise uses `keyOn` /
`keyOff`; it has no musical note pitch. Wave uploads stop CH3, just as in the
existing API; trigger it again after changing Wave RAM. `initialize()` and
`reset()` retain their public chip meanings and can replace current register
settings; omit them when keeping the upper editor sound. `setClock` accepts
only the fixed DMG clock in this standalone Synth.

**Live from Code** is On by default. Select CH1–4 above the output display to
view that channel in the existing Pulse / Wave / Noise controls. These are
read-only sent/configured register values, including the configured initial
volume, Wave RAM and base pitch. They are not measurements of the current
hardware envelope volume or Sweep frequency. Observation is capped at 20 Hz,
with only one request at a time. Live Off returns to the editable instrument
while Code continues; the next instrument edit stops Code. Live never rewrites
the stored preset. `liveLoop`, `beat`, `tween`, `context`, scheduling and `liveFx`
are software facilities, separate from APU Envelope / Sweep.

**Files** opens the project tree. Add code, local modules or data; right-click
for Duplicate, Rename, Delete, new JavaScript / sound / folder and file/project
import/export. **Save sound** creates a readable JSON preset under `/presets`.
Selecting a valid sound JSON loads it; text and JSON are edited in Code. File
selection leaves Keyboard selected when Code is hidden. The maximize button
moves Code beside Files; restoring it returns to the controls.

Files, code and edited presets save locally, without automatically running code
or starting audio when restored. Export project to keep a portable Cassette ZIP;
the shared 16 MiB project limit applies. Master, octave and temporary Pitch are
not instrument settings. Code completion and source navigation use the existing
Game Boy API declarations and readable modules. Timing runs on the browser's
JavaScript clock and does not promise sample-accurate or background execution.

## Hardware controls and the waveform editor

Pulse Duty changes the square-wave width. Initial volume and hardware
Envelope / Sweep edits are used on the next note, rather than restarting a
held note. Envelope pace is a hardware code: 0 holds the initial volume;
1–7 changes it at multiples of 1/64 second. It is a rising or falling volume
envelope, not an ADSR editor.

Wave has a single drawing canvas. Choose Sine / Triangle / Saw / Square, or
draw the 32 samples yourself. Samples are integers from 0 to 15, matching the
four-bit Wave RAM. A shape selection applies immediately; a drawing applies
when you release the pointer. Interrupted strokes are discarded. Applying new
Wave samples stops held notes so the RAM can be updated; play a key again to
hear the result. There is no separate Apply button.

Wave level, Pulse Duty, Noise clock parameters and left / right routing can
change while a note is held. Source, Duty, directions, Wave level and Noise
width use choice buttons. Clicking an option leaves the performance keys
available immediately. Tab to the selected option and use Arrow keys or Home /
End to change it; letter and number keys remain available for playing notes.

Numeric sound controls use **− / value / +** buttons. Click to step by one, or
drag the center value horizontally. Pointer adjustments leave the performance
keyboard available. Tab to a control for Arrow keys and Home / End; buttons
disable at their hardware bounds. Sweep controls stay disabled while Sweep is Off.

The APU generates the chip sound. Waveform drawing, round robin, keyboard
layouts, the Pitch wheel and preset files are software performance tools.

## Output display and volume

**Waveform** and **Spectrum** observe the final output after Master volume,
through a passive analyser branch. The display does not add a second speaker
connection. Idle / hidden displays stop updating.

Master ranges from **0 to 380%** and turns **orange above 100%**. It scales
the output separately from the chip's authored volume / envelope settings,
using the existing Game Boy source balance as its reference.

## Import sounds from VGM

Select **Load VGM / VGZ…** with a Game Boy VGM or gzip-compressed VGZ file.
Analysis lists the Pulse, Wave and Noise sounds without changing the current
instrument or starting audio. Choose a sound to load it, then play the keyboard.
Use **All / Pulse / Wave / Noise** to filter the list and **Previous / Next**
for longer libraries. **Close library** keeps the selected instrument.

The import uses initial register settings at each recorded trigger: Pulse Duty,
volume envelope and CH1 Sweep; complete 32-sample Wave RAM and its output level;
Noise clock, LFSR width and envelope. Left / right routing is included when
recorded. Identical sounds are grouped, with their first time and use count shown.
Imported sounds remain editable and can be saved as presets or copied as JavaScript.

This is a starting sound for keyboard performance. Original note pitch, hardware
length counters, song playback and later register changes are not imported.
The page reports missing settings and unsupported input; failed or cancelled
imports keep the current instrument and previous library. Files and decompressed
VGM data are limited to 64 MiB. All analysis stays in the browser.

## Presets and reusable code

**Save preset** downloads `dmg-voice.json`, containing the instrument name,
selected source, Pulse settings shared by CH1 / CH2, Wave's 32 samples and level, Noise
settings, and left / right routing. The portable format is
`tetorica-gameboy-voice`, version 1. Load validates the complete preset before
changing the instrument; malformed or oversized files preserve the previous
sound. Loading a valid preset or resetting stops notes. Master, keyboard
layout, octave and the temporary Pitch wheel position are performance controls
and are not saved in the instrument preset.

**Copy JavaScript** generates the selected source's setup and a single-channel
audition. Open the Playground in **Game Boy** mode, replace its default script
with the copied code and Run it.
The snippet uses the initialized `gameboy` API and includes a release command
as a comment. Keyboard round robin belongs to this standalone app and is not
part of that single-voice snippet. Master volume and the temporary Pitch wheel
are not included. The generated code is also shown on the page
for manual copying if clipboard access is unavailable.

Use **Save sound** / **Export project** for the local Files project, or
**Save preset** for an individual instrument download. Analyzer-exported voice
JSON and audio recordings are not imported directly. The existing Analyzer and Playground provide separate extraction /
Sample Editor workflows.
GBS song playback and full Game Boy emulation are outside this APU Synth.

## API, source and licenses

- [npm API catalog](../../packages/fm2612/README.md#api-entry-points): reusable Synth helpers and low-level entry points.
- [GameboySynth](../../tetorica_src/runtime/gameboysynth.js) and [GameboyApu](../../tetorica_src/runtime/gameboyapu.js): musical controls and register / PCM access.
- [Standalone preset schema](preset.js), [instrument and allocator](instrument.js), [AudioWorklet](processor.js) and [browser audio lifecycle](audio.js).
- [Native Game Boy core and provenance](../../third_party/tetorica-soundchip-native/vendor/mame-gameboy/README.md): MAME-derived DMG adaptation; [BSD-3-Clause license](../../third_party/tetorica-soundchip-native/vendor/mame-gameboy/LICENSE), with upstream credits retained.
- [Project license](../../LICENSE) and [complete attribution](../attribution.md).

The Synth adds a browser UI around the existing core; it does not change the
shared WASM or claim complete hardware timing / analog-output fidelity. Reuse
the components you need and retain their source and license notices.

## Build and verify

From the repository root:

```sh
npm run test:dmg-synth
npm run test:dmg-synth:browser
npm run test:dmg-synth:code-browser
npm run test:dmg-synth:code-monaco
sh scripts/package_itch_dmg_synth.sh dev
```

The package command creates `release/tetorica_dmg_synth_dev_itch.zip`.
Use a new version argument for another archive; an existing archive is preserved.
The ZIP has a root `index.html`, the original JavaScript / CSS modules, the
original WASM pair, component notices, authenticated native sources and browser
source inputs. It can be served independently of this checkout.

The running JavaScript and CSS retain their source paths, comments, identifiers
and imports without bundling or minification. Edit `synth-dmg/` for the UI and
instrument, `js/` for the reusable chip helpers, or the shared keyboard in
`synth/synth_keyboard.js`, then reload. No JavaScript build is needed. This also
keeps the ZIP suitable as editable input for the Tauri app. Compiler-generated
WASM loaders and binaries remain unchanged under `generated/`; their native
sources and rebuild instructions are under `sources/`. The browser-input ZIP is
an additional source snapshot with hashes, rather than the only editable copy.
