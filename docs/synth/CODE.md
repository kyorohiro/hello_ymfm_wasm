# Code performances in FM2612 Synth

Open **Code** below the instrument editor. The first visit creates `/index.js` only if it is missing. Select JavaScript files in Files to edit them. Text edits save into the same project as the instruments and VGM files; Export Cassette keeps them together. Importing or reloading a project does not run its code.

- **Run** starts a fresh session.
- **Apply** updates the source while retaining `context`, prepared resources and named live loops/effects.
- **Stop** cancels loops, pending waits, effects and notes, and clears the live session. Keyboard mode also stops Code.

`context` is live memory, not Cassette data. Save source and local data files to keep a performance. Monaco loads when Code is opened; the plain-text editor and execution remain available if the editor service is unavailable.

## Start with the current instrument

```js
const fm = await useSoundChip("ym2612");
setBpm(120);

liveLoop("melody", async () => {
  fm.noteOn(CH1, "C4");
  await sleep(0.2);
  fm.noteOff(CH1);
  await beat(0.5);
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

PCM initially uses the sample, loop and channel settings from the PCM editor. Its raw step is available through `setPitch()` and `setChannel()`. A musical key release uses the Synth's 4 ms software release. Explicit raw register writes remain hardware controls. Code sample-memory writes are temporary; Stop restores the authoring sample bank.

```js
const pcm = await useSoundChip("rf5c164");
liveLoop("sample", async () => {
  await pcm.keyOn(0);
  await beat(0.5);
  await pcm.keyOff(0);
  await beat(0.5);
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
