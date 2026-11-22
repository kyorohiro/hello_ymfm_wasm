# Tetorica SM510 Synth

Tetorica SM510 Synth is a monophonic software instrument inspired by the piezo buzzers in early LCD handhelds powered by Sharp SM510-family chips. It generates a two-level pulse and uses short fades at the start and end of each beep to reduce clicks.

- Choose an original pattern or enter a note or **Rest** in each of the eight steps. Click a step number to audition its note.
- Set the tempo, note length and volume. Each step represents an eighth note. Editing a note, tempo or note length during playback starts the updated pattern from step one.
- Use **Play**, **Stop** and **Loop** to listen. **Export WAV** saves one pass through the sequence as 48 kHz mono PCM16 at the selected volume.

## Synth and Code

**Synth** shows the sequencer and the FM2612-style Keyboard. Play the on-screen
pads or their matching computer keys. Octave and Fret move the pitches under
those keys. **Code** moves the JavaScript editor beside Files and keeps the
oscilloscope visible. **Run** starts a session, **Apply** updates it, and
**Stop Code** releases Code-owned sound. Switching back to Synth keeps the
Code session playing.

```js
const buzzer = await useSoundChip('lcd-buzzer');
await buzzer.noteOn(CH1, 'C4');
await beat(0.25);
buzzer.noteOff(CH1);

buzzer.setPattern(['C4', null, 'E4', null, 'G4', 'E4', 'C5', null]);
buzzer.configure({ bpm: 144, gate: 0.4 });
await buzzer.playPattern({ loop: false });
```

Use `setStep(0, 'C4')` to change the first step and `null` for a rest. Notes
accept a name or integer MIDI value from C3 through C6. `configure()` accepts
tempo (`bpm`), note length (`gate`), `volume`, and `loop`. Gate and volume use
fractions. Keyboard, Code and sequence playback take turns using one voice.

## SM510 buzzer demo

Open **Files → Sound chip** and try **Play R1**. The demo models the DK-52
board's R1 output, using the 32,768 Hz clock divided by eight to give a nominal
4,096 Hz square carrier. Select **Single beep**, **Double beep** or **Rapid
beeps**, toggle individual gates, or move **Step time**. Longer on intervals
and different gaps change the effect while the carrier stays fixed.

The demo shares the instrument's Volume control and uses short playback fades.
Its settings are local to the demo. The eight-note sequencer, Keyboard, and
Code examples use a separate software-tuned voice. [MAME DK-52 wiring](https://github.com/mamedev/mame/blob/master/src/mame/handheld/hh_sm510.cpp#L1754-L1800) · [SM510 R output](https://github.com/mamedev/mame/blob/master/src/devices/cpu/sm510/sm510.cpp#L43-L69)

## Files and Menu

Open or close **Files** in either view. `/index.js` contains the starter Code
and `/pattern.json` holds the active sequence. Select a saved pattern to load
it into the sequencer. **Save pattern…** keeps a named copy alongside Code and
other project files. **Sound chip** opens a reference panel with hardware
limits and recipes for beeps, chirps and trills.

New Cassettes include three editable Code examples in **Files → examples**.
Open `short-beep.js`, `chirp.js`, or `trill.js` and press **Run** to hear it.
Change the pitches, note lengths, or rests and run it again to compare. In an
existing Cassette, **Add examples** fills unused example paths with ready-to-run
copies. An existing file, directory or pending deletion keeps its path.

With **Auto apply** off, edited files show **●**. **Run** and **Apply** read
saved Code and saved imports. Use **Save**, Ctrl/Cmd+S, or **Menu → Save all**
to accept edits. **Menu → New → Cassette…** starts a new project. Use
**Import → Cassette · ZIP…** and **Export → Cassette · ZIP** to move the
project, including both saved files and working drafts, between browsers.

To try the browser app from a local checkout, run `python3 -m http.server --directory docs 8000` and open [Tetorica SM510 Synth](http://localhost:8000/synth-lcd-buzzer/). Run `npm run test:lcd-buzzer-synth` for the audio and Cassette tests.

The software oscillator and three example patterns are original. The source is available under the repository's [BSD 3-Clause license](../../LICENSE).
