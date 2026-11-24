# Tetorica FM2610 Synth

Play or program the YM2610 used in Neo Geo and the six-FM-channel YM2610B.
Both variants have three SSG channels, six fixed-rate ADPCM-A voices and one
pitched ADPCM-B voice. Choose the chip in the header and a source tab to play
it from the keyboard. **Mixer** controls the four source levels before the
shared **Master** level.

## Files and sounds

**Files** opens the Cassette files in either workspace. Choose **＋ Instrument**
on the Files toolbar to save the current FM sound as `.fm.json`. This format
keeps the operator key mask, operator AM, LFO, pan, AMS/PMS and CH3 Special
operator tuning. **Menu → Import → Import files…** also opens TFI and VGI and
stores each imported FM sound as an editable `.fm.json` file. **Menu → Export**
offers **Selected FM · TFI** and **Selected FM · VGI**. Both formats carry the
four operators, algorithm and feedback. VGI also carries pan, AMS and PMS.
The export message identifies settings to keep in `.fm.json`.

In **SSG**, choose **Save preset…** to store all three voices and their shared
noise and envelope settings in a `.ssg.json` file. Select a preset in Files
to apply it. You can import one through **Import files…**, export it from the
file context menu, or move it with the rest of the Cassette. **Save Kit…** in
**ADPCM-A** stores the six pad assignments and settings in a kit ZIP. In
**ADPCM-B**, **Save sample…** stores the encoded sample and voice settings in
a sample ZIP. The ADPCM-B **Draw** tool edits the waveform; **Export WAV**
writes one decoded pass of the selected range.

The selected instruments, Code and VGM files travel together in a **Cassette ·
ZIP**. Use **Auto apply** to accept file edits automatically. With Auto apply
off, **Save** accepts the selected file. **Run** and **Apply** use saved Code
and its saved imports. Use the Files context menu for rename, delete, new
folder or individual file export.

## Code examples

Fresh Cassettes include these files under `/examples`. In an existing project,
choose **Menu → New → Code examples** to add examples at unused paths. Open
an example in Files, select its chip in the header and press **Run**. **Apply**
updates the current Code session and **Stop** ends it.

| Example | Choose in the header | What it demonstrates |
| --- | --- | --- |
| `fm-ssg-ym2610.js` | Neo Geo (YM2610) | FM notes, an SSG melody and shared SSG noise and envelope |
| `fm-ssg-ym2610b.js` | YM2610B | The same performance on the six-FM-channel variant |
| `ch3-special.js` | YM2610B | Separate Block and F-NUM for the four CH3 operators |
| `adpcm-a-pads.js` | Neo Geo (YM2610) | Six original ADPCM-A samples, independent ranges and grouped pad triggers |
| `adpcm-b-pitch.js` | YM2610B | An original encoded pluck, transposed by changing playback rate |
| `timed-fm.js` | YM2610B | Sample-clock FM automation and a register trace |

`useSoundChip('ym2610')` and `useSoundChip('ym2610b')` use the chip selected
in the header. The clients expose `fm`, `ssg`, `adpcmA` and `adpcmB`.
Use `CH1` through `CH4` for logical FM channels on the YM2610 and `CH1`
through `CH6` on the YM2610B. ADPCM-A has six voices on both variants.
ADPCM-A and ADPCM-B each use their own sample bank. Upload their encoded
bytes with `loadMemory()` and select a byte range aligned to 256 bytes with
`setSample()`.

### Timed FM operations

Use `fm.build()` to record an ordered program. `atSeconds()` and `atSample()`
set offsets from the start. High-level FM operations follow the selected
chip's FM channel mapping. Use `write(port, register, value)` in the builder
to time raw writes on either port, including SSG and ADPCM registers. Upload
any sample data the program needs before reserving it.

```js
const { fm } = await useSoundChip('ym2610b');
fm.setPreset(CH1, FM_PRESETS['two-op-bell']);
const phrase = fm.build(b => {
  b.atSeconds(0).noteOn(CH1, 'E4');
  b.atSeconds(0.09).setOperator(CH1, OP4, { tl: 23 });
  b.atSeconds(0.19).noteOff(CH1);
});

const initialState = await fm.captureState();
console.table(await fm.compile(phrase, { initialState }));
await fm.schedule(phrase, { name: 'opnb-fm', repeatSeconds: 0.5 });
```

`compile()` returns the predicted port, register, value and timing of each
write. It can use the current audio state, the reset state, or a detached
`captureState()` snapshot from the same synth. `schedule()` plays the program
on the AudioWorklet's sample clock. Use `clearSchedule(name)` to remove a
reservation. Run and Apply commit top-level reservations after successful
evaluation. Reservations made in a `liveLoop()` follow that loop's lifetime.

### Code effects

`liveFx()` processes the combined Synth output after the chip and before
Master. It applies to both Code and Keyboard. VGM playback
uses a separate output route. The AudioWorklet calls `process()` for each
audio block, and **Stop** removes the Code effects.

```js
liveFx('level', {
  context: { gain: 0.5 },
  process(input, output, state, { gain }) {
    for (let channel = 0; channel < output.length; channel++) {
      for (let frame = 0; frame < output[channel].length; frame++) {
        output[channel][frame] = input[channel][frame] * gain;
      }
    }
  },
});
```

Run the script and play a key. Use `fx.updateContext('level', { gain: 0.8 })`
from Code to update the gain while keeping the same effect.

## Reference songs

**Menu → Import → VGM / VGZ…** keeps the original song in Files and extracts
its FM sounds as editable patches. Pick a song above the workspace and use
Play, Pause, Stop or the position slider. Seeking reuses remembered positions
from unmodified song playback when available, then reconstructs the song state
at the requested position.

You can edit the selected FM channel while VGM is playing. Changes affect the
next audio the song renders, and later VGM writes can take over the same
registers. Pause or Stop adopts the sound at the current song position for
editing and keyboard audition. Stopping Code also keeps its last sound.
Save captured ADPCM windows with **Save Kit…** or **Save sample…**.

## Run from source

Run `python3 -m http.server --directory docs 8000` at the repository root and
open [the Synth](http://localhost:8000/synth-fm2610/). Run
`node --test docs/synth-fm2610/*.test.mjs` for the source tests. Build the HTML
and source ZIPs with `node scripts/package_itch_fm2610_synth.mjs VERSION`.
