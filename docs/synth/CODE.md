# Code performances in FM2612 Synth

Open **Code** below the instrument editor. The first visit creates `/index.js` only if it is missing. Select JavaScript files in Files to edit them. Text edits save into the same project as the instruments and VGM files; Export Cassette keeps them together. Importing or reloading a project does not run its code.

- **Run** starts a fresh session.
- **Apply** updates the source while retaining `context`, prepared resources and named live loops/effects.
- **Stop** cancels loops and pending waits immediately, fades Code output over 8 ms, then releases notes and effects and clears the live session. This is a software output fade. Keyboard mode also stops Code.

`context` is live memory, not Cassette data. Save source and local data files to keep a performance. Monaco loads when Code is opened; the plain-text editor and execution remain available if the editor service is unavailable.

Use the maximize button at the right of the Keyboard / Code tabs to put the same editor beside Files and hide the upper Synth controls. Restore brings it back without stopping Code or losing the cursor, source or live context. Keyboard restores the ordinary layout and stops Code. Maximized layout is temporary and is not restored after a reload.

Open the **Mixer** tab after 32X PWM for shared YM2612, Sega PSG, Mega CD PCM and 32X PWM volumes and channel **On / Off**. All 20 channel switches are available before loading a VGM and apply to live Keyboard, Code and VGM output. These are software output controls, applied once before Master; they stay in this session rather than the Cassette. Live highlight and Seek cache remain VGM options. The Mixer button in maximized Code restores the view and opens this tab without stopping Code.

Already rendered loop layers contain mixed audio; use their chip's Volume to adjust those layers. Channel switches control the live chips and reference playback.

## Start with the current instrument

```js
const fm = await useSoundChip("ym2612");
setBpm(120);

liveLoop("melody", async () => {
  const notes = scale("E1", "minorPentatonic", 3);
  fm.noteOn(CH1, choose(notes));
  await sleep(0.1);
  fm.noteOff(CH1);
  await beat(0.025);
});
```

The upper FM controls edit this same chip. Use the object returned by `useSoundChip()` to choose which chip receives each note or register write. Synth Code has no global `play()` helper; each chip has its own note or playback controls. Existing `/index.js` files are kept: replace older `play()` snippets with the explicit chip calls above. Code changes to registers or presets do not rewrite the authoring files. Stop restores the authoring FM patch. The normal physical channel numbers still apply, including CH3 special mode on `CH3`.

## Four chip clients

```js
const fm  = await useSoundChip("ym2612");
const psg = await useSoundChip("segapsg");
const pcm = await useSoundChip("rf5c164");
const pwm = await useSoundChip("pwm");
```

`useSoundChip()` reuses the client within a session. FM, PSG and PCM borrow the Synth's editing chips; the PWM client is created for Code. The shared System chip balance applies once, and Master adjusts the output after Code effects. The upper Waveform/Spectrum shows that final output.

PSG can use the upper attenuation and optional Software Envelope:

```js
const psg = await useSoundChip("segapsg");
liveLoop("pulse", async () => {
  psg.tone(0, { note: "C4" });
  await beat(0.5);
  psg.keyOff(0);
  await beat(0.5);
});
```

PCM uses the sample, loop and channel settings from the RF5C164 editor. Set **Root note** to the note heard when the sample plays at its original sample rate. `setNote(channel, note)` computes and returns the raw RF5C164 step without starting a voice; `noteOn(channel, note)` also starts it. Both accept note names or integer MIDI 0–127, on channels 0–7. This is software tuning from the editor's sample rate and Root note; it does not detect an arbitrary WAV's pitch. Changing the loop region can change the perceived pitch, so adjust Root note when needed. For a VGM-copied sample, the initial C4 represents the captured playback speed rather than a detected C4 fundamental.

In the PCM **Sample** view, **Range** moves the loop start / end markers. **Draw** edits amplitudes on that same canvas with a mouse, pen or touch. A stroke previews while drawing and replaces the sample on release; interrupted strokes are discarded. Drawing is a software sample editor: it preserves the sample length, rate, Root note and loop settings, and changes only the frames crossed by the stroke. Samples are quantized to RF5C164 sign-magnitude bytes without using its reserved `0xff` loop marker. Applying a drawing stops held PCM notes, including Code notes using the shared sample; play a new note to hear the edit. VGM Live remains read-only.

The edited sample stays inside the existing PCM preset, so Files and Cassette keep it together with the instrument. New Event Rec events and Looper takes use the edited sample; previously recorded takes keep their own captured sample. The drawing helper is in [synth_pcm_wave_edit.js](synth_pcm_wave_edit.js), separate from the chip renderer and audio lifecycle.

The PCM note helpers require the upper editor's sample metadata. After Code `loadSample()` / `loadMemory()` replaces RAM, use raw `setPitch()` / `keyOn()` until the editor sample is restored. A musical `noteOff()` uses the Synth's 4 ms software release. Raw register controls remain available; Stop restores the authoring sample bank.

`setRootNote(note)` overrides Root note for later Code `setNote()` / `noteOn()` calls and returns the effective MIDI number. It accepts a note name or integer MIDI 0–127; `setRootNote(null)` returns to inheriting the upper editor's Root note. It does not retune or restart held notes, change the UI or saved instrument, or affect raw `setPitch()` / `keyOn()`. Apply keeps the override; Stop or selecting a new instrument clears it.

Playground and npm RF5C164 clients also have these note helpers, with C4 as their default and `null` Root. Those clients use the raw step declared through `setChannel()` as the original sample speed; Synth Code uses the upper editor's sample metadata and software release described above.

For a sample whose original pitch is A4, A5 plays at twice its original speed:

```js
const pcm = await useSoundChip("rf5c164");
pcm.setRootNote("A4");
await pcm.noteOn(CH1, "A5");
await sleep(0.2);
pcm.noteOff(CH1);
```

```js
const pcm = await useSoundChip("rf5c164");
setBpm(120);
liveLoop("melody", async () => {
  const notes = scale("E1", "minorPentatonic", 3);
  await pcm.noteOn(CH1, choose(notes));
  await sleep(0.1);
  pcm.noteOff(CH1);
  await beat(0.025);
});
```

PWM exposes the existing `writeRegister`, `scheduleWrites`, `getState`, `reset` and clock controls. It receives a stream of software-generated samples; the dedicated PWM keyboard editor remains under construction.

## Live effects and local modules

```js
liveFx("level", {
  context: { gain: 0.5 },
  process(input, output, state, context) {
    for (let ch = 0; ch < input.length; ch++) {
      for (let i = 0; i < input[ch].length; i++) {
        output[ch][i] = input[ch][i] * context.gain;
      }
    }
  },
});
```

The effect runs in the audio processor. Pass its adjustable values through its `context`; closures from the editor are not transferred. Apply retains a named effect's processing state. Removing its definition removes the effect.

Use `await import("./helper.js")` for local modules, and `await file("./data.json", {type:"json"})` for local data. `file()` also supports text (default) and `arrayBuffer`. Paths are relative to the current file, as in Playground. Entry code supports top-level `await`; it is evaluated as a performance script rather than a static ES module.

This first integration uses Playground's shared Main execution components. The audio processors and PWM reservations still run on the audio clock; JavaScript loops follow the browser's Main-thread scheduling. Worker execution is a separate extension. Keyboard recording/Looper and Code have separate ownership, and starting reference VGM playback stops Code.
