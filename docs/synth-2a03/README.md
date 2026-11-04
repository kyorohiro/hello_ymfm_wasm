# Tetorica 2A03 Synth

Project identifier: `tetorica-2a03-synth`.

**NES APU + FDS.** The former `/synth-nes/` address redirects here. The existing
`tetorica-nes-fds-voice` preset format and NES audio APIs remain compatible.

[Open the synthesizer](index.html) · [NES / FDS Playground](../playground/index.html?mode=nes)

Play and edit NES Pulse, Triangle, Noise, DMC and FDS. Draw a waveform and modulation
table, hear how the controls interact, and take the instrument away as a preset
or JavaScript. The keyboard, two Pitch wheels, output monitor and file workflow
follow Tetorica's FM2612, DMG and SPU Synths.

## Play

Select **Enable audio**, then click a key or play the displayed computer keys.
Choose **Pulse / Triangle / Noise / DMC / FDS** with the Source buttons. Opening the
page and editing an instrument do not start audio; playing a key can initialize it.

One NTSC NES APU with FDS supplies these voices:

| Source | Keyboard voices | Controls |
| --- | --- | --- |
| Pulse | Two, in round robin | Four Duty settings, fixed volume, hardware Envelope and Sweep |
| Triangle | One | Fixed hardware waveform with keyboard note and gate |
| Noise | One | Volume, period code and long / short LFSR sequence |
| DMC | One | Pre-encoded DPCM sample, 16 Rate settings, Loop and Initial level |
| FDS | One | 64 six-bit samples, volume / master scale, frequency modulation |

All keys play the selected source. When its channels are full, a new note replaces
the oldest; releasing the old key cannot stop the replacement. NES Sweep works on
both Pulse channels, so enabling it keeps two keyboard voices. The source's voice
capacity and held-note count are displayed above the editor.

**Noise keys trigger the same configured noise.** Its period and LFSR mode set
the character; musical note pitch and Pitch bend do not tune it.

**DMC keys trigger the same loaded sample.** Rate sets its playback speed;
musical note pitch and both Pitch wheels are disabled for DMC.

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

## DMC samples

Choose **DMC**, then **Load DPCM…** to open pre-encoded `.dmc` / `.dpcm` data,
or **Demo sample** to try a self-authored, software-generated sample. Loading
data does not start audio. Play a key to trigger it; a newer key takes ownership
of the single DMC channel. Releasing an older key cannot stop its replacement.

The demo encodes 16 low-amplitude sine cycles in 257 bytes. At the standard
**Initial level 64**, it avoids DAC saturation and returns to that level at the
loop boundary. This improves the demo's repeating tone; one-bit quantization
and the DAC change at key attack / release can still be audible. Choose
**Demo sample** again after updating to replace an older demo in memory.

Raw DPCM is a sequence of one-bit up / down changes for a seven-bit output
level. It is not a WAV, MP3 or ordinary PCM audio file. The input must contain
**1–4081 bytes**. This app pads it with `0xaa` alternating bits to a hardware
length of **16 × n + 1 bytes**; the stored original bytes remain in the preset.
For example, 32 input bytes play as 33 hardware bytes. The alternating bits are
hardware-length padding, not PCM silence.

- **Rate index 0–15** selects a hardware bit clock, about 4.18–33.14 kbit/s
  at NTSC speed. It changes sample pitch and duration together. The readout
  estimates one pass including padding; it is not a PCM sample-rate setting.
- **Loop sample** repeats the configured sample. Rate and Loop apply live.
- **Initial level 0–127** sets the starting DAC level on the next trigger.
  It is not a gain knob; it changes how the one-bit steps reach their limits.

Each key uses the selected Rate. There is no chromatic sample mapping. A
one-shot can finish while its key remains held; press a new key to trigger
again. The shared core retains part of an in-flight output byte on off / on,
so triggering does not promise an identical sample-by-sample attack. Enabling
Loop after a completed pass can resume it. Releasing a key or **Stop all sound**
also clears the retained DAC level as this Synth's software stopping policy.

Sample changes stop held notes. Empty, oversized or unsuitable files keep the
current instrument. **Cancel load**, a newer file, Demo sample, source switch
or another instrument edit invalidates an older asynchronous read. The last
read cannot overwrite the newer edit. File analysis stays in the browser.
Audio-to-DPCM encoding remains a separate follow-up. Recorded DMC samples can
also be recovered through **Load VGM / VGZ…**, as described below.
See the [DMC hardware reference](https://www.nesdev.org/wiki/APU_DMC).

## DMC bit editor and DAC preview

**DMC Editor · draw / bits → DAC** opens the same bytes from a loaded DPCM file,
Demo sample, VGM capture or preset. Each row shows the byte offset and its
hexadecimal value, followed by eight editable bit buttons in **playback order,
b0 → b7**. For example, `0x01` appears as `1 0 0 0 0 0 0 0` because DMC plays
the least significant bit first. Click a bit to toggle it and update the
decoded waveform immediately. The readout links that bit to its DAC step.

You can also **draw on the graph with the mouse or a touch pointer**, in either
Selected bytes or All data view. The green line is your target DAC level after
each bit; blue shows what the DMC can actually produce. A software drawing aid
chooses the nearer legal up / down step, keeping the original bit on a tie.
The configured Initial level anchors the start. A steep target or a level of
the wrong parity cannot be matched exactly; the two lines make that visible.

During a stroke the bit grid and decoded wave update as a preview. The current
instrument and sound are kept until release. **Release to apply** the drawn
bits and stop held notes, then play a new key. **Escape**, pointer cancellation,
leaving the app, resizing or changing the source, sample, controls, page or
view discards the unfinished stroke. Green remains as the last drawn target
after applying; it is temporary UI state and is not saved in the preset.

Drawing changes only targeted bits in the original sample, preserving its
length and read-only generated padding. Later decoded levels can shift even
when later bits are unchanged, because DMC carries its previous DAC value
forward. Drawings do not import or automatically convert PCM audio files.

The preview follows the seven-bit DAC rules:

- A **1** requests **+2**. At level 126 or 127, the level holds.
- A **0** requests **−2**. At level 0 or 1, the level holds.

The low DAC bit stays unchanged: even Initial levels stay within 0–126, odd
Initial levels within 1–127. A step that would cross the limit is ignored,
rather than clamped to a different parity. The fixed graph axis is **0–127**.

**Selected bytes** shows exact stairs for the current four-byte page.
**All data** shows the whole sample as an overview. **First / Previous / Next /
Last** navigate even the maximum 4081-byte sample. Generated `0xaa` padding
appears grey and read-only; it is included in the waveform and playback time,
but does not become part of the saved original data.

Blue is the first pass from **Initial level**. With **Loop** on, the amber dashed
trace is the next pass starting at the first pass's ending DAC value. Loop
reloads sample data without resetting the DAC. The second trace is one further
pass, not a promise that a sample has reached a steady repeating state.
**Rate** changes the time axis and duration, not the decoded step values.
Changing Initial level updates the preview now and the sound on its next trigger.

The graph shows **decoded DAC values before the mixer, output filters and
Master**, not the live output scope or DMA startup / partial-byte timing.
Releasing a note also clears the DAC as described above; that software stop
is not appended to the sample preview.

Bit edits stop held notes and apply to the actual DMC data. Play a new key to
hear them. Save preset / Load preset and Copy JavaScript include the edited
bytes; the view mode and page are temporary UI state. With a bit focused,
**Space / Enter** toggles it, **0 / 1** sets it, arrows move between bits and
bytes, **Page Up / Down** changes the window and **Home / End** jumps to the
first / last original bit. Modifier shortcuts are left available. Pointer
edits return to the performance keyboard. No audio-file PCM-to-DPCM conversion is added.

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
Analysis lists the recorded Pulse / Triangle / Noise / DMC / FDS sounds without
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

**DMC** voices include their recorded DPCM bytes, Rate, Loop and Initial level.
Use the **DMC** filter, choose a sound and play the keyboard. They use the same
sample editor, portable presets and JavaScript export as a directly loaded
`.dmc` file. A file containing only complete DMC samples can be imported too.

The importer follows NES CPU RAM blocks (`0xc2`) and raw data-bank / RAM-copy
commands (`0x07` / `0x68`). A captured sample must have all its bytes recorded
before its trigger, including any address wrap from `$ffff` to `$8000`.
Missing bytes are not filled with silence or a demo. Later RAM writes can
produce a different captured sound; a selected voice retains its own copy.

DMC capture keeps the starting settings for keyboard audition. The original
song's live rate changes, stopping time and RAM rewriting are not replayed.
The initial DAC level uses the last recorded direct level write; if playback
has advanced since then, or no level was recorded, the chosen approximation
is explained with the voice. Read those notes when comparing with the song.
Direct DAC PCM and NES DAC streams are not encoded DPCM instruments and are
not reconstructed. Compressed NES data banks are unsupported in this stage.
Unsupported / incomplete data is reported in **File notes**; if no complete
sounds remain, the import fails and keeps the previous library and instrument.

Non-NTSC clocks are reported because this
Synth plays at its normal NTSC clock; dual NES chips are unsupported. Files and
expanded VGZ data are limited to 64 MiB. All file analysis stays in the browser.

## Output and files

**Waveform / Spectrum** observes the actual output after **Master** through a
passive analyser. Master ranges from 0 to 380%, with orange above 100%. It is a
software output gain separate from hardware voice volume.

**Save preset** downloads `2a03-voice.json`. The validated
`tetorica-nes-fds-voice` version-2 format includes all five sources' settings,
the original DPCM bytes, FDS wave and modulation table. Version-1 presets still
load and are migrated; saving creates version 2, which older Synth releases do
not read. Master, Octave, keyboard layout and temporary
Pitch are not saved. **Load preset** validates the whole file before changing the
instrument. Invalid / oversized files keep the current sound. Loading a valid
preset, Reset instrument, and source / table / DPCM-data changes stop held notes.

**Copy JavaScript** produces a setup and single-channel audition for the selected
source. Open Playground in NES mode, paste it into the editor and Run. Keyboard
round robin belongs to this standalone app, not the single-channel snippet.

**Stop all sound** keeps the current instrument. Hiding the page or switching
away from its window also stops notes. An audio failure offers **Enable audio**
to restart. Save the preset before closing or reloading; the session stays in
memory rather than being saved automatically.

The instrument covers Pulse / Triangle / Noise / DMC / FDS. PCM-to-DPCM encoding,
NSF / song playback and sequencing are outside this version's workflow.

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
