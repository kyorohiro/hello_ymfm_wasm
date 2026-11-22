# Tetorica LCD Buzzer Synth

LCD Buzzer is a monophonic software instrument inspired by the piezo buzzers in early LCD handhelds. It generates a two-level pulse and uses short fades at the start and end of each beep to reduce clicks.

- Choose an original pattern or enter a note or **Rest** in each of the eight steps. Click a step number to audition its note.
- Set the tempo, note length and volume. Each step represents an eighth note. Editing a note, tempo or note length during playback starts the updated pattern from step one.
- Use **Play**, **Stop** and **Loop** to listen. **Export WAV** saves one pass through the sequence as 48 kHz mono PCM16 at the selected volume.

To try the browser app from a local checkout, run `python3 -m http.server --directory docs 8000` and open [LCD Buzzer Synth](http://localhost:8000/synth-lcd-buzzer/). Run `npm run test:lcd-buzzer-synth` for the audio-rendering tests.

The software oscillator and three example patterns are original. The source is available under the repository's [BSD 3-Clause license](../../LICENSE).
