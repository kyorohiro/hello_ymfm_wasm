# Code performances in FM2612 Synth

Open **Code** below the instrument editor. The first visit creates `/index.js` only if it is missing. Select JavaScript files in Files to edit them. Text edits save into the same project as the instruments and VGM files; Export Cassette keeps them together. Importing or reloading a project does not run its code.

- **Run** starts a fresh session.
- **Apply** updates the source while retaining `context`, prepared resources and named live loops/effects.
- **Stop** cancels loops and pending waits immediately, fades Code output over 8 ms, then releases notes and effects and clears the live session. This is a software output fade. Keyboard / Code switches only the input view; the same loops, context and FX keep running. The shared Run / Apply / Stop row stays visible with the keyboard.

Choosing the **Code** tab keeps focus on that tab, so computer keys can still play
the selected sound, including after Code stops. Click inside the editor to type;
text/number fields, selects and dialogs keep their own input. Ctrl/Cmd+Enter runs
Code from the tab or editor. Use `beat()` for musical note lengths and rests so
`setBpm()` changes the whole phrase. Saved scripts are kept when the defaults change.

`context` is live memory, not Cassette data. Save source and local data files to keep a performance. Monaco loads when Code is opened; the plain-text editor and execution remain available if the editor service is unavailable.

Selecting an FM, PSG or PCM sound in Files or the preset lists selects that
chip's **Auto** instrument, even from a physical CH view, while Code keeps running. It preserves live loops, context,
`livePrepare()` and software FX; explicit Stop keeps the latest editor sound.
Replacing sample RAM can end a held PCM note, so trigger the next note from
the continuing loop. Project replacement and reference-song playback still
stop Code before taking ownership of the chips.

## Auto and physical channel tabs

The chip tabs have a second row that stays available without a VGM file:

- **YM2612:** Auto, CH1–CH6.
- **PSG:** Auto, Tone 1–3, Noise.
- **RF5C164:** Auto, CH1–CH8.

**Auto** keeps the authored instrument controls and automatic keyboard
allocation. Editing that instrument applies the touched settings across its
voices; Auto does not mean playing every channel in unison. Each chip remembers
its selected tab, including Auto. Selecting a tab alone never copies or unifies
channel settings.

A physical channel tab shares its display, edits and keyboard with that actual
CH. The small **Normal / Code / VGM** badge identifies the current source.
Normal and Code views observe the existing editor endpoints; they do not create
extra sound chips. Raw and high-level Code writes update the same written-state
view, at up to 20 updates per second. Worklet-scheduled future register writes
and internal oscillator/envelope state are not inferred by this Main-thread view.

**Live** off freezes the display while sound and keyboard input keep running.
Manual edits update only their touched fields in the frozen view, merging
packed register companions against the latest actual writes. Later Code or VGM
writes can take ownership; old key-up and Pitch resets cannot affect the newer
owner. Switching Keyboard / Code views or channel tabs keeps loops, context and
FX running. Physical-channel edits are session chip state. **Save CH** in Normal
or Code saves that CH as a new instrument in Files without loading it, changing
the selected CH, or stopping the performance. Live on captures fresh written
settings at the click; Live off saves the frozen display plus manual changes.
FM saves VGI with Synth metadata for OP masks and CH3 pitch ratios, PSG saves
`.psg.json`, and RF5C164 saves `.pcm.json` with its sample and loop. Saving an
unsupported voice or an unbounded PCM sample is unavailable with a reason
in the button tooltip. **Copy** remains the paused-VGM import into Auto.

Physical PSG channels use hardware attenuation, with Software Envelope retained
in Auto. Noise can use Tone 3's clock without muting its audible square wave.
RF5C164 keys retain the selected channel's Start, Loop, Volume, Pan and sample
RAM. C4 uses its current Step as reference speed. A fresh normal slot initializes
missing tuning from the author sample on its first key; configured Code slots
are kept intact, including zero Step or custom RAM. Sample/Root/drawing controls
remain in Auto because all PCM channels share the same RAM.

PCM presets retain their source length, sample rate, Root and loop settings;
the built-in single-cycle shapes contain 256 frames. Choosing Sine, Triangle,
Saw or Square selects a separate built-in preset instead of overwriting the
currently selected file. Choose that file again to return to its sample.
Range, drawing and parameter edits still update the selected document's draft;
**Revert** restores its last checkpoint, and **Sync** updates that checkpoint.
Loop Start and exclusive
Loop End use the loaded sample's actual frame range for dragging and one-frame
buttons. Changing the sample or its valid interval cancels an older drag,
without applying it to the newly loaded sound. This does not resize the sample.

## Play a VGM and change its FM sound

During VGM playback, **CH1–CH6** selects the same YM2612 channel for viewing,
knob edits and the keyboard. Hand edits are temporary: later VGM writes can
replace them. **Auto** keeps the authoring sound visible; its FM edits and
preset selections also reach all six song channels, and its keyboard uses the
available song channels in round robin. No extra FM keyboard chip is mixed in
while the song plays. The original VGM file is never changed.

**Live** follows the consumed song position. With Live off, the observation
freezes, while fields you deliberately change still update. Editing a packed
register preserves its other current fields. The hardware LFO is shared by all
six channels. An older keyboard key-up or Pitch reset cannot stop or retune a
newer VGM-owned note. CH3 special mode keeps its operator pitch ratios and OP
selection; CSM CH3 and DAC CH6 explain why FM keyboard input is unavailable.
DAC and CH3 mode controls remain under the VGM program.

**Pause** freezes the song and uses the existing independent keyboard audition.
**Copy** then saves a channel as an editable authoring instrument. **Seek**
reconstructs the original song, discarding temporary hand edits; the seek cache
is cleared after a hand edit and starts again after seeking. Keyboard response
includes a short rendered-audio queue (about 50–100 ms, plus device
latency). YM2612 gain calibration and native 2048-frame audio chunks are kept.

VGM and Code remain mutually exclusive. Manual input can accompany either;
switching Keyboard / Code views keeps Code running. Looper and Event Rec stay
disabled during VGM playback.

PSG **Tone 1–3 / Noise** now selects the same physical channel for Live
viewing, hardware edits and keyboard input during the song. Tone and Noise are
fixed channel types: use this channel selector to change type. **Period** edits
the selected tone's 10-bit hardware code; a higher code gives a lower pitch,
and 0–1 gives constant tone output. Noise using Tone 3 shares that period.
Changing its period also changes the audible Tone 3 oscillator, whose level is
preserved. Selecting a Noise clock changes only its control register; a fresh
keyboard note can then program Tone 3's pitch. Fixed-clock Noise keys retrigger
the noise without adding a musical pitch.

PSG's latch/data cursor from the original VGM is kept separately from hand
writes, so a later source data byte still reaches its intended register. A
volume edit does not reset the Noise LFSR; a Noise-control write does, as on the
chip. Later source writes take ownership, so an old key-up or Pitch reset
cannot silence or retune their replacement. Tone 3 source pitch changes retire
the hand's Noise pitch control while keeping its independent key-up usable.

In **Auto**, PSG author presets and hardware edits reach the active Tone group
or Noise. Idle muted channels stay muted; their selected level is used at the
next manual note. A direct selected-CH attenuation edit is a physical register
edit and can unmute that channel. VGM manual input uses hardware levels;
**Software Envelope** remains saved in the author instrument and is available
again after stopping the VGM. Code keeps its existing software-envelope tools.

For **RF5C164**, select **PCM CH1–8** to edit Volume, left/right Pan and 16-bit
**Playback step**, and play the existing song sample on that physical channel.
The recorded Step is the C4 reference speed; it is not detected sample pitch.
Editing Step updates that reference, while subsequent keys and Pitch use it
without accumulating transposition. The original Start, Loop and sample RAM
stay in place, including known wrapped or disjoint samples that cannot be
exported as a contiguous author sample. Global Disable, Step 0 or incomplete
sample RAM explain why keys are unavailable; the hardware controls stay usable.

Manual PCM transactions preserve both of the player's independent CH and
RAM-bank selectors, Global Enable and all other channel-mask bits. Volume and
Pan preserve gate ownership; a later source Step write takes pitch control,
and source gate / Start / Loop writes retire the old manual key. An old key-up
or wheel reset cannot undo those new instructions. Live Off freezes unrelated
fields while showing deliberate edits. Hardware Key Off has no software fade
on the playing reference chip.

PCM **Auto** uses its separate author sample bank and keyboard. Author edits,
WAV/preset loading and Code continue to use that bank without replacing song
RAM; loading an instrument selects Auto and keeps the VGM running. Root note,
sample drawing and Range/Loop edits belong to this author instrument. The song
sample display is read-only, with Waveform/Spectrum available during hardware
edits. Pause keeps the separate captured audition and its software release;
Copy retains its stricter contiguous-sample checks. Seek reconstructs the
original VGM and discards temporary hand edits and their checkpoints.

Use the maximize button at the right of the Keyboard / Code tabs to put the same editor beside Files and hide the upper Synth controls. Restore brings it back without stopping Code or losing the cursor, source or live context. Keyboard restores the ordinary layout while Code keeps playing. Maximized layout is temporary and is not restored after a reload.

Open the **Mixer** tab after 32X PWM for shared YM2612, Sega PSG, Mega CD PCM and 32X PWM volumes and channel **On / Off**. All 20 channel switches are available before loading a VGM and apply to live Keyboard, Code and VGM output. These are software output controls, applied once before Master; they stay in this session rather than the Cassette. Live highlight and Seek cache remain VGM options. The Mixer button in maximized Code restores the view and opens this tab without stopping Code.

Already rendered loop layers contain mixed audio; use their chip's Volume to adjust those layers. Channel switches control the live chips and reference playback.

## Start with the current instrument

```js
const fm = await useSoundChip("ym2612");
setBpm(120);

liveLoop("melody", async () => {
  const notes = scale("E1", "minorPentatonic", 3);
  fm.noteOn(CH1, choose(notes));
  await beat(0.2);
  fm.noteOff(CH1);
  await beat(0.025);
});
```

Use `beat()` for note lengths and rests so changing `setBpm()` changes the whole rhythm.
At 120 BPM, `beat(0.2)` lasts 0.1 seconds.

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

In the PCM **Sample** view, **Range** moves the loop start / end markers. **Draw** edits amplitudes on that same canvas with a mouse, pen or touch. A stroke previews while drawing and updates the shared sample RAM on release; interrupted strokes are discarded. Drawing is a software sample editor: it preserves the sample length, rate, Root note and loop settings, and changes only the frames crossed by the stroke. Samples are quantized to RF5C164 sign-magnitude bytes without using its reserved `0xff` loop marker. Applying a drawing keeps held PCM notes and their playback positions, including Code notes using the editor's shared sample. The next samples use the edited waveform without a new Key On. If Code has loaded its own PCM RAM, stop Code before drawing; its private data and sounding notes are kept when an edit is rejected. Loading another sample or choosing a builtin still replaces the instrument and stops its notes. The VGM song sample remains read-only; its Volume, Pan and Step are editable while playing.

The edited sample stays inside the existing PCM preset, so Files and Cassette keep it together with the instrument. Event Rec and Looper record drawing as a sample edit that keeps sounding voices during replay. Previously recorded takes keep their own captured samples. The drawing helper is in [synth_pcm_wave_edit.js](synth_pcm_wave_edit.js), separate from the chip renderer and audio lifecycle.

The PCM note helpers require the upper editor's sample metadata. After Code `loadSample()` / `loadMemory()` replaces RAM, use raw `setPitch()` / `keyOn()` until the editor sample is restored. A musical `noteOff()` uses the Synth's 4 ms software release. Raw register controls remain available; Stop restores the authoring sample bank.

`setRootNote(note)` overrides Root note for later Code `setNote()` / `noteOn()` calls and returns the effective MIDI number. It accepts a note name or integer MIDI 0–127; `setRootNote(null)` returns to inheriting the upper editor's Root note. It does not retune or restart held notes, change the UI or saved instrument, or affect raw `setPitch()` / `keyOn()`. Apply keeps the override; Stop or selecting a new instrument clears it.

Playground and npm RF5C164 clients also have these note helpers, with C4 as their default and `null` Root. Those clients use the raw step declared through `setChannel()` as the original sample speed; Synth Code uses the upper editor's sample metadata and software release described above.

For a sample whose original pitch is A4, A5 plays at twice its original speed:

```js
const pcm = await useSoundChip("rf5c164");
setBpm(120);
pcm.setRootNote("A4");
await pcm.noteOn(CH1, "A5");
await beat(0.4);
pcm.noteOff(CH1);
```

```js
const pcm = await useSoundChip("rf5c164");
setBpm(120);
liveLoop("melody", async () => {
  const notes = scale("E1", "minorPentatonic", 3);
  await pcm.noteOn(CH1, choose(notes));
  await beat(0.2);
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

This first integration uses Playground's shared Main execution components. The audio processors and PWM reservations still run on the audio clock; JavaScript loops follow the browser's Main-thread scheduling. Worker execution is a separate extension. Keyboard can play alongside Code on the same physical channels. The most recent Key On owns a channel: an older Code Note Off or keyboard key-up cannot silence its newer owner, and no old note is automatically resumed. Parameters alone do not claim a gate; raw register writes and explicit allNotesOff remain physical controls. Blur releases keyboard-owned notes without stopping Code. Looper / Event Rec require Code to be stopped. Starting reference VGM playback stops Code.
