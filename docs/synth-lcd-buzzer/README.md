# Tetorica LCD Buzzer Synth

LCD Buzzer is a monophonic software instrument inspired by the piezo buzzers in early LCD handhelds. It generates a two-level pulse and uses short fades at the start and end of each beep to reduce clicks.

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

## Files and Menu

Open or close **Files** in either view. `/index.js` contains the starter Code
and `/pattern.json` holds the active sequence. Select a saved pattern to load
it into the sequencer. **Save pattern…** keeps a named copy alongside Code and
other project files. **Sound chip** opens a reference panel with hardware
limits and recipes for beeps, chirps and trills.

With **Auto apply** off, edited files show **●**. **Run** and **Apply** read
saved Code and saved imports. Use **Save**, Ctrl/Cmd+S, or **Menu → Save all**
to accept edits. **Menu → New → Cassette…** starts a new project. Use
**Import → Cassette · ZIP…** and **Export → Cassette · ZIP** to move the
project, including both saved files and working drafts, between browsers.

To try the browser app from a local checkout, run `python3 -m http.server --directory docs 8000` and open [LCD Buzzer Synth](http://localhost:8000/synth-lcd-buzzer/). Run `npm run test:lcd-buzzer-synth` for the audio and Cassette tests.

The software oscillator and three example patterns are original. The source is available under the repository's [BSD 3-Clause license](../../LICENSE).
