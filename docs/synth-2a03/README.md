# Tetorica 2A03 Synth

Project identifier: `tetorica-2a03-synth`.

**NES APU + FDS.** The former `/synth-nes/` address redirects here. The existing
`tetorica-nes-fds-voice` preset format and NES audio APIs remain compatible.

[Open the synthesizer](index.html) · [NES / FDS Playground](../playground/index.html?mode=nes)

Play and edit NES Pulse, Triangle, Noise and FDS. Draw a waveform and modulation
table, hear how the controls interact, and take the instrument away as a preset
or JavaScript. The keyboard, two Pitch wheels, output monitor and file workflow
follow Tetorica's FM2612, DMG and SPU Synths.

## Play

Select **Enable audio**, then click a key or play the displayed computer keys.
Choose **Pulse / Triangle / Noise / FDS** with the Source buttons. Opening the
page and editing an instrument do not start audio; playing a key can initialize it.

One NTSC NES APU with FDS supplies these voices:

| Source | Keyboard voices | Controls |
| --- | --- | --- |
| Pulse | Two, in round robin | Four Duty settings, fixed volume, hardware Envelope and Sweep |
| Triangle | One | Fixed hardware waveform with keyboard note and gate |
| Noise | One | Volume, period code and long / short LFSR sequence |
| FDS | One | 64 six-bit samples, volume / master scale, frequency modulation |

All keys play the selected source. When its channels are full, a new note replaces
the oldest; releasing the old key cannot stop the replacement. NES Sweep works on
both Pulse channels, so enabling it keeps two keyboard voices. The source's voice
capacity and held-note count are displayed above the editor.

**Noise keys trigger the same configured noise.** Its period and LFSR mode set
the character; musical note pitch and Pitch bend do not tune it.

**Octave − / +**, Guitar / Bass / Ukulele and the fret controls change the
keyboard layout. Keys outside the source's timer range are disabled. The two
**Pitch** wheels stay synchronized and return to center on release. Bend is a
software performance control using hardware frequency registers. On NES Pulse,
crossing the timer's high-byte boundary can restart the hardware Envelope / length counter;
Pitch is not a promise of continuous, sample-accurate tuning.

## Edit the sound

Source, Duty, direction and scale use choice buttons. They keep performance keys
available after pointer selection. Tab / Arrow / Home / End support keyboard
navigation; letter keys remain available for notes. Numeric controls use
**− / value / +** buttons. Drag the center value or use Arrow / Home / End to
change it. The instrument name is an ordinary text input.

Pulse Envelope starts at the hardware maximum and decays. Its period is 0–15;
0 is the fastest hardware setting, not Off. Loop repeats the decay. Fixed volume
is used when Envelope is disabled. Envelope / Sweep edits are applied on the next
trigger. Sweep follows the hardware timer and can mute a voice at its limits.

Triangle uses its fixed waveform and hardware gate. This first version keeps its
linear / length behavior configured for held keyboard notes. It has no separate
hardware volume setting. Noise volume, period and LFSR mode can be edited live.

## FDS waveform and modulation

The **Wave / Modulation** buttons select what to edit on a single canvas:

- **Wave** contains 64 values from 0 to 63. Draw the wave or choose a shape.
- **Modulation** contains 32 pitch-counter commands. Choose a brush and paint
  along the table, or select Flat / Vibrato / Rise / Fall.

Modulation codes mean `0, +1, +2, +4, Reset, −4, −2, −1`. These are counter
changes, not amplitude samples; **Reset** clears the pitch counter. In the graph
it is marked **R**. Drawing and shape presets are software tools for editing
the hardware tables. Releasing a stroke applies the table and stops held notes;
play a new note to hear it. Interrupted strokes keep the previous table.

**Enable modulation** varies the wave's playback frequency. Rate controls its
clock, Depth its strength and Bias the counter offset. This is the FDS hardware
frequency-modulation path; the interface follows its waveform and counter table.
The default table, Rate and Depth are ready to hear when modulation is enabled.
Rate, Depth, Bias and volume can change while the FDS note is held.

## Import sounds from VGM

Select **Load VGM / VGZ…** and choose a file containing NES or FDS sound.
Analysis lists the recorded Pulse / Triangle / Noise / FDS sounds without
starting audio or changing the current instrument. Choose a sound, then play
the keyboard. Filter by source and use **Previous / Next** for longer libraries.
The origin channel, first time and number of matching captured settings are
shown with each sound; this count is not the song's note count.

Imported sounds remain editable and can be saved as presets or copied as
JavaScript. **Close library** keeps the current instrument. Failed or cancelled
imports keep both the current sound and the previous library; a superseded
asynchronous read cannot replace a newer library.

This imports initial sound settings for keyboard performance. Original note
pitch, length / linear counters, song playback and later parameter changes are
not reconstructed. FDS needs complete recorded Wave RAM; missing RAM is not
filled with a factory waveform. Settings beyond the current editor's controls
may need a static approximation, which is explained with the selected sound.
Read those notes when comparing a recovered instrument with the original song.

DMC samples are not imported in this stage. Files containing other supported
NES / FDS sounds can still be used. Non-NTSC clocks are reported because this
Synth plays at its normal NTSC clock; dual NES chips are unsupported. Files and
expanded VGZ data are limited to 64 MiB. All file analysis stays in the browser.

## Output and files

**Waveform / Spectrum** observes the actual output after **Master** through a
passive analyser. Master ranges from 0 to 380%, with orange above 100%. It is a
software output gain separate from hardware voice volume.

**Save preset** downloads `2a03-voice.json`. The validated
`tetorica-nes-fds-voice` version-1 format includes all four sources' settings,
the FDS wave and modulation table. Master, Octave, keyboard layout and temporary
Pitch are not saved. **Load preset** validates the whole file before changing the
instrument. Invalid / oversized files keep the current sound. Loading a valid
preset, Reset instrument, and source / table changes stop held notes.

**Copy JavaScript** produces a setup and single-channel audition for the selected
source. Open Playground in NES mode, paste it into the editor and Run. Keyboard
round robin belongs to this standalone app, not the single-channel snippet.

**Stop all sound** keeps the current instrument. Hiding the page or switching
away from its window also stops notes. An audio failure offers **Enable audio**
to restart. Save the preset before closing or reloading; the session stays in
memory rather than being saved automatically.

The instrument covers Pulse / Triangle / Noise / FDS. DMC samples, PCM-to-DPCM
encoding, NSF / song playback and sequencing are outside this version's workflow.

## API and sources

- [NesApuSynth](../../tetorica_src/runtime/nesapusynth.js): musical and hardware voice controls.
- [NesApuWasm](../../tetorica_src/runtime/nesapu_wasm.js): register, memory, state and PCM access.
- [npm API guide](../../packages/fm2612/README.md#api-entry-points).
- [Preset schema](preset.js), [instrument / allocator](instrument.js), [AudioWorklet](processor.js), [audio lifecycle](audio.js).
- [Native source provenance](../../third_party/tetorica-soundchip-native/vendor/tetorica-nes/README.md).

The shared NES / FDS core is reused without DSP changes. Native / WASM NES
portions derive from JSNES under Apache-2.0; the FDS adaptation is MIT. Preserve
the included license and author notices. The standalone UI uses the project
[BSD-3-Clause license](../../LICENSE). See [complete attribution](../attribution.md).

## Build and verify

```sh
npm run test:2a03-synth
npm run test:2a03-synth:browser
sh scripts/package_itch_2a03_synth.sh dev
```

The ZIP is `release/tetorica_2a03_synth_dev_itch.zip`. Use a new version for each
archive; existing archives are retained. The package bundles browser modules and
CSS, keeps the original NES WASM pair, and includes corresponding native sources,
license notices and a hash receipt of the browser build inputs. It runs without
the parent repository.
