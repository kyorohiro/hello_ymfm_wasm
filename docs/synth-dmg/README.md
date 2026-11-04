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
page, switching away from its window or hiding the page also stops notes. If
the audio engine fails, select **Enable audio** to reconnect.

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

The current session stays in memory; save instruments before closing or
reloading. Analyzer-exported voice JSON and audio recordings are not imported
directly. The existing Analyzer and Playground provide separate extraction /
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
sh scripts/package_itch_dmg_synth.sh dev
```

The package command creates `release/tetorica_dmg_synth_dev_itch.zip`.
Use a new version argument for another archive; an existing archive is preserved.
The ZIP has a root `index.html`, bundled runtime / CSS, the original WASM pair,
component notices, authenticated native source files and browser source inputs.
It can be served independently of this checkout.
