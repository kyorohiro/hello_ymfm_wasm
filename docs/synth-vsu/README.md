# Tetorica VSU Synth

Play the Virtual Sound Unit (VSU) from Nintendo's Virtual Boy with the on-screen keyboard, PC keys, or JavaScript. The five wavetable voices share five banks of 32 six-bit samples. Each voice has four-bit left and right levels.

The VSU blocks wavetable writes while voices are active. The editor issues the VSU's global stop command before uploading the edited bank. JavaScript can do the same with `vsu.allNotesOff()` followed by `vsu.setWave(bank, samples)`.

## Reference playback

Choose **VGM / VGZ…** in **Reference playback** or the Files menu to import Virtual Boy logs. Select a song and press **Play**. **Pause** keeps the current position for **Resume**. **Loop** repeats from the loop point stored in the song, or from the beginning when there is no loop point. The seek bar marks the loop start when the song provides one.

Drag the seek bar to jump to a position. When focused, the arrow keys move one second and Page Up and Page Down move five seconds. Seeking during playback resumes at the chosen point. Seeking while stopped or paused opens that point paused so you can copy a sound. The VSU rebuilds its state from the timed register stream, including wave RAM, envelope progression and CH5 modulation.

Select **CH1–6** during reference playback to inspect a channel. **Mute** and **Solo** above the channel settings change the VGM mix while the recorded chip state keeps advancing.

To capture a sound, pause the song and select an active **CH1–6**. **Copy to Synth** loads that channel's stereo levels and programmed envelope into the matching editor channel and opens it in **AUTO**. Wave voices bring their wave bank. CH5 also brings its Sweep and Modulation settings, including the full Modulation RAM. CH6 brings its noise tap, shift rate, and duration. The editor reuses an identical wave bank or uses a bank available to the copied voice so other authored voices retain their waves. Play a key to trigger the captured settings from the beginning of the envelope. Use **Files → ＋ Patch** to keep the result.

The player supports VGM 1.71 and later logs for one 5 MHz VSU. Files keeps the original song with the project and saves distinct sounds recovered at note starts under **presets/<file name>/**. Select a preset to load it into **AUTO** on its original channel. Extraction scans the first 15 minutes and saves up to 512 sounds per song within the project storage limit. Cassette export includes the song and the saved presets.

## Channel selection

**AUTO** plays the authored instrument. **Wave (PCM)** uses CH1–5 in round robin and replaces the oldest note if all five voices are held. **Sweep / Modulation** uses CH5 with the effect selected in its controls. **Noise** uses CH6, whose **Noise tap** slider selects one of eight feedback taps. Choosing a numbered channel plays that physical voice.

During VGM or Code playback, choose **CH1–6** to inspect its waveform, stereo levels, envelope and frequency registers. The stereo and envelope controls write to the selected playing channel. VGM or Code can replace those values with subsequent register writes. Turn **Auto update** off to freeze the readback while keeping the controls available. Selecting another channel, pausing, or seeking reads a fresh snapshot. Use **AUTO** to edit the authored sound, or pause a VGM and use **Copy to Synth** to keep the selected sound with its latest settings.

Play a key on a numbered channel while VGM or Code is running to retrigger that channel with its current settings. The key selects pitch for CH1–5 and triggers the programmed shift rate and duration on CH6. Playback continues. A later write to the channel's gate, or a global stop, takes control of the channel again. Releasing an earlier key leaves that later note sounding. In the Code workspace, PC keys work when focus is outside the editor and text-entry fields.

**Wave bank** selects the shared RAM bank the channel plays and shows its 32 samples in the graph. Draw on the graph to edit those samples. With the graph focused, Left and Right select a sample and Up and Down change its level. **Shape** chooses a preset waveform, and **Apply shape** fills the selected bank with it. Each channel using that bank reads the same samples.

## Mixer

Set **On / Off** and **Volume** for each of the six VSU voices. These controls apply to the keyboard, Code and VGM after the chip's stereo levels. A muted voice keeps its envelope and timing, and turning it on again uses the slider's current level. The VGM **Mute** and **Solo** controls also apply during reference playback.

**Waveform** and **Spectrum** in both tabs use the actual rendered PCM after the channel levels and Master volume. The display combines the left and right output for analysis. The **Wave RAM** graph shows the selected bank's 32 source samples and follows the selected live channel when **Auto update** is enabled.

## CH5 Sweep and Modulation

Select **CH5** or **AUTO → Sweep / Modulation**, choose an effect, and play a key.

- **Sweep** adds or subtracts the pitch register shifted by 0–7 bits at each step. A smaller shift makes a larger change. An upward sweep can silence the voice if it overflows the 11-bit pitch register.
- **Modulation** applies 32 signed byte offsets to the original pitch register. The development manual documents −127 to +127, and the editor also preserves a raw `0x80` (−128) from a VGM capture. Enable **Repeat** to cycle the table. Editing the table during a held CH5 note stops and retriggers that voice so the RAM write takes effect.
- **Base clock** chooses 0.96 ms or 7.68 ms and **Multiplier** sets the number of clock periods per step. A multiplier of 0 disables the effect.
- **Play comparison** plays A4 on CH5 in Normal, Sweep, and Modulation order. All three use the selected wave bank and stereo levels. Sweep and Modulation use fixed comparison settings, and the editor keeps your values.

## CH6 Noise

- **Noise tap** selects one of eight feedback patterns (0–7). Tap 0 repeats after 32,767 bits and tap 7 repeats after 28 bits.
- **Shift rate** writes the 11-bit `S6FQ` value and shows the resulting rate, from about 244.14 Hz to 500 kHz. **Key tracking · Software** maps notes to the same register. Moving the slider while holding a key switches to a fixed rate immediately. New projects start at 31.25 kHz, while old patches open with key tracking enabled.
- **Duration** applies to the next note. **Hold** sounds while a key is held. The one-shot settings use the chip's interval counter in 3.84 ms steps up to 122.88 ms. The envelope and stereo controls also apply to CH6. For a short hiss, try tap 0 at 31.25 kHz and 23.04 ms.

## Files

Open **Files** beside the editor, then use **＋ Patch** to save the five wave banks, six channels' settings and envelopes, noise settings, and CH5 parameters as a named `.vsu.json` patch. Open a patch from the tree to restore it. Use **＋ JS** to create a script and **Save** to keep your changes locally. The header menu also provides creation and save commands and imports and exports project files. You can open it with Files closed.

Use **Menu → New → Cassette · ZIP** to start a fresh project with the starter Code and default instrument. The dialog offers to export the current Cassette first.

The top **Code** button opens a workspace beside Files with **Code / VSU / Mixer / Keyboard** tabs. The **Synth** button restores the standard layout and its previous chip and performance panels. Switching tabs keeps Code and VGM playback running.

In the Code workspace, select **VSU → AUTO**, then **Wave (PCM)**, **Sweep / Modulation**, or **Noise**. Use the **Keyboard** tab for on-screen keys, or use PC keys when focus is outside the editor and other text fields. AUTO keys and running Code share the physical VSU channels. The latest trigger on a channel takes over that channel's gate. When Code takes over a held key's channel, releasing the key leaves the new note playing.

## Keyboard

The fretboard shares FM2612's computer-key layout. Choose **Guitar**, **Bass**, or **Ukulele**, then **Open**, **5th**, or **12th**. Guitar also offers strings **6–3**, **5–2**, and **4–1**. The octave buttons transpose the keyboard from −2 to +2 octaves. Very low notes reach the wavetable voice's hardware floor at about 76.3 Hz.

## JavaScript

```javascript
const vsu = await useSoundChip("vsu");
vsu.setWaveBank(CH1, 0);
vsu.setVolume(CH1, 15, 5);
vsu.noteOn(CH1, "A4");
await sleep(0.25);
vsu.noteOff(CH1);
```

The helpers also accept zero-based channel numbers and MIDI note numbers. For wave voices the note is converted to the closest VSU period. For the noise voice the note controls the shift clock.

`vsu.write(offset, value)` takes an aligned byte offset from `0x01000000` and a register byte. Wave bank 0 starts at `0x000` and successive banks start `0x80` bytes apart. Modulation RAM starts at `0x280`. Channel 1 starts at `0x400`, successive channels start `0x40` bytes apart, and global stop is `0x580`. Each RAM cell or register occupies a four-byte slot.

| Channel-relative offset | Register |
| --- | --- |
| `0x00` | Start and interval |
| `0x04` | Left and right level |
| `0x08`, `0x0c` | Frequency low and high |
| `0x10`, `0x14` | Envelope and control, including the sweep/modulation or noise settings on channels 5 and 6 |
| `0x18` | Wave bank on channels 1–5 |
| `0x1c` | Sweep timing, shift, and direction on channel 5 |

### Timed playback

`build()` records writes and helpers such as `setWave()`, `noteOn()` and `noteOff()` in one synchronous callback. Use `atSeconds()` or `atSample()` for offsets from the start of the pattern. `atSample()` uses 44,100 Hz by default, or the `referenceSampleRate` passed to `build()`. Writes at the same time run in recorder order.

```javascript
const vsu = await useSoundChip("vsu");
const taps = vsu.build(b => {
  b.atSample(0).write(0x544, 0x8f).write(0x548, 0xf0).write(0x54c, 7);
  b.write(0x550, 0xf0).write(0x554, 0x01).write(0x540, 0xa5);
  b.atSeconds(0.25).write(0x540, 0xa2);
});
console.table(await vsu.compile(taps));
await vsu.schedule(taps, { name: "noise", repeatSeconds: 0.5 });
```

`compile()` lists the planned VSU register offsets and bytes without changing playback. The shared Wave RAM and Modulation RAM write locks apply at execution. `schedule()` accepts a named one-shot or repeating pattern for the Web AudioWorklet. Its result confirms acceptance. **Apply** replaces the entry's patterns after the updated script succeeds. `clearSchedule(name)` and **Stop Code** cancel future writes and release notes still owned by the affected pattern. A scheduled channel stop leaves a later keyboard or Code note sounding. An explicit write of `1` to `0x580` uses the chip's global stop.

Fresh projects and **New → Cassette** include `examples/timed-modulation-noise.js`. Open it from Files and run it for a one-second pattern with CH5 Modulation and short CH6 Noise hits. Use the Mixer to listen to each output independently.

## Run and build

Serve `docs/` over localhost, then open `http://localhost:8000/synth-vsu/`.

```sh
python3 -m http.server 8000 --directory docs
```

Build the checked-in WASM with Emscripten on your PATH.

```sh
npm run build:vsu-synth
npm run test:vsu-synth
```

The browser AudioWorklet and native callers use the same BSD-3-Clause C++ core in [`tetorica_src/native/vsu`](../../tetorica_src/native/vsu). The core models the VSU's digital timing and exposes centered stereo PCM for playback. This version uses a held DAC output and leaves the console's analog output filters and exact per-channel DAC interleave outside the model.

## References

- Nintendo's 1995 *Virtual Boy Development Manual*, revision C, section 6, describes the VSU memory map, timing, mixing, and sound registers. [Original manual scan](https://cdn3.guidessimo.com/view/1144/1144575-virtual_boy.pdf#page=133)
- Hardware captures by dasi and Guy Perfect document the noise generator's initial state and feedback. [Noise generator measurements](https://www.virtual-boy.com/forums/t/the-secrets-of-the-noise-generator/)
- The VGM specification documents VSU register writes, wait commands, and loop offsets. [VGM specification](https://vgmrips.net/wiki/VGM_Specification)
