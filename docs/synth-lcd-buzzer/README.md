# Tetorica SM510 Synth

Tetorica SM510 Synth is a monophonic instrument for exploring the Sharp SM510's direct and divided buzzer outputs alongside a software-tuned square wave.

- Choose an original pattern or enter a note or **Rest** in each of the eight steps. Click a step number to audition its note.
- Set the tempo, note length and volume. Each step represents an eighth note. Editing a note, tempo or note length during playback starts the updated pattern from step one.
- Use **Play**, **Stop** and **Loop** to listen. **Export WAV** saves one pass through the sequence as 48 kHz mono PCM16 using the selected tone source and volume.

## Tone source

The **Tone source** selector applies to the on-screen Keyboard, computer keys,
Step Sequencer and its previews, and the `useSoundChip('lcd-buzzer')` note
and pattern API. It is a playback preference. Cassette and pattern files
store the same MIDI notes and rests in all three modes.

| Tone source | What you hear |
| --- | --- |
| **SM510 Direct R** (default) | The direct-output mask lets the program toggle R1. Each note uses an integer number of SM510 machine cycles per half-wave, so the pitch may differ from the note’s equal-tempered frequency. |
| **DK-52 Divider** | Each playable note opens the gate on the DK-52’s fixed 4,096 Hz R1 carrier. Changing notes leaves the carrier frequency fixed. Rests close the gate. |
| **Equal temperament** | A software square wave uses standard equal-tempered pitches with A4 at 440 Hz. |

## Synth and Code

The performance tabs are **Keyboard**, **Code**, and **Step Sequencer**. The
oscilloscope stays above them. Play the on-screen pads or their matching
computer keys and use Octave and Fret to move the pitches. Keyboard stays
available while Code is open. With focus in the editor, typing edits the
script. Click a pad or the Code tab to play with the computer keys again.
The top **Code** button opens the workspace beside Files. **Run** starts a
session, **Apply** updates it, and **Stop Code** releases Code-owned sound.

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

The demo shares the instrument's **Volume** control. **Play R1** always uses
the DK-52 divider, and its eight gates and step time belong to the demo.
[MAME DK-52 wiring](https://github.com/mamedev/mame/blob/master/src/mame/handheld/hh_sm510.cpp#L1754-L1800) · [SM510 R output](https://github.com/mamedev/mame/blob/master/src/devices/cpu/sm510/sm510.cpp#L43-L69)

### R1 from Code

Use `useSoundChip('sm510')` for the DK-52 divider and
`useSoundChip('sm510-direct')` for the direct mask. Each client keeps its
mask regardless of the **Tone source** selector. Both expose
`write(REG_R, value)`, `build()`, and `playCycles()`.

Open `examples/sm510-r1.js` in **Files** and press **Run** for a DK-52 beep.
Bit 0 of `REG_R` gates the fixed R1 carrier. Write `0x1` to open the gate
and `0x0` to close it. Change the wait in seconds to shape the beep.

```js
const sm510 = await useSoundChip("sm510");
await sm510.write(sm510.REG_R, 0x1);
await sleep(0.1);
await sm510.write(sm510.REG_R, 0x0);
```

### Direct R pitch

The SM510 oscillator is nominally 32,768 Hz. One CPU machine cycle takes two
oscillator ticks, so the CPU runs at 16,384 machine cycles per second. With
the direct mask, R1 follows bit 0 of the latch. A held level gives no
sustained tone. Successive writes that alternate the level produce the tone.

One realizable program puts the high and low half-waves on separate ROM
pages. The high page runs `LAX 1`, `ATR`, `N − 4` no-ops, then `TL` to
the low page. The low page runs `LAX 0`, `ATR`, the same number of no-ops,
then `TL` back. `LAX` and `ATR` each take one cycle, the no-op (called
`SKIP` in the Sharp data book) takes one, and the two-byte `TL` takes two.
Each page therefore uses `N` cycles and `N` ROM steps. The program fits
for integer `N` from 4 through 63, with instructions laid out in the
chip's polynomial program-counter order. The SM510 voice uses the same
timing between R1 transitions.
[Sharp Microcomputers Data Book, SM510 pp. 153–157](https://bitsavers.org/components/sharp/_dataBooks/1990_Sharp_Microcomputers_Data_Book.pdf)

A full period takes `2 × N` machine cycles, giving `16,384 / (2 × N)` Hz.
The synth picks the realizable frequency closest to the requested note in Hz.
For example, C3 uses `N = 63` (130.03 Hz), and the A4 key uses `N = 19`
(431.16 Hz). Select **Equal temperament** to hear A4 at 440 Hz.
The sequencer plays complete direct R periods within each note's time
window. Live keyboard playback uses a short gain fade on release.

### Machine-cycle timing in Code

`sm510.clock` is the master clock in Hz and `sm510.machineCycleHz` is the CPU
machine-cycle rate. Both clients accept a 4-bit value for `REG_R`, with
bit 0 driving the mono R1 audio. An immediate
`write()` changes the latch when called and `sleep()` uses the Code runtime clock.
The immediate audition smooths the level changes for browser playback.
For deterministic offsets, `build()` records writes and `playCycles()` renders
one finite sequence. Cycle zero starts with the divider and latch cleared.
The last `atCycle()` sets the end, up to 30 seconds. Writes are external latch
operations, so include instruction costs in the offsets when representing a program.

```js
const direct = await useSoundChip('sm510-direct');
const firstWrite = 2; // LAX and ATR complete
const halfPeriod = 19; // machine cycles per half-wave
const halfWaves = 128;
const pulse = direct.build(b => {
  for (let i = 0; i < halfWaves; i++) {
    b.atCycle(firstWrite + i * halfPeriod).write(direct.REG_R, i % 2 === 0 ? 1 : 0);
  }
  b.atCycle(firstWrite + halfWaves * halfPeriod);
});
await direct.playCycles(pulse);
```

SM510 playback uses a [C++ core](../../tetorica_src/native/sm510/sm510.cpp)
that averages the digital signal over each PCM sample interval, including
writes between sample boundaries. Run `sh scripts/build_sm510.sh "" build/sm510`
to build the browser `sm510.wasm` and the native `build/sm510/libsm510.a`.
The [C ABI](../../tetorica_src/native/sm510/sm510.h) accepts writes as
master-tick offsets and exposes both divider and direct pin states.

## Files and Menu

Open or close **Files** in either view. `/index.js` contains the starter Code
and `/pattern.json` holds the active sequence. Select a saved pattern to load
it into the sequencer. **＋ Pattern** keeps a named copy alongside Code and
other project files. Use **＋ JS** to create a script. Right-click a file or
folder for Duplicate, Rename, and Delete, or to create a file or folder in
that part of the tree. **Sound chip** opens the hardware guide.

New Cassettes include editable Code examples in **Files → examples**.
Run `short-beep.js`, `chirp.js`, or `trill.js` to hear the selected tone
source. Run `sm510-r1.js` or `sm510-cycles.js` for immediate or cycle-timed
DK-52 R1 writes. In an existing Cassette, **Add examples** fills unused
example paths with ready-to-run copies. An existing file, directory or
pending deletion keeps its path.

With **Auto apply** off, edited files show **●**. **Run** and **Apply** read
saved Code and saved imports. Use **Save**, Ctrl/Cmd+S, or **Menu → Save all**
to accept edits. **Menu → New → Cassette…** starts a new project. Use
**Import → Cassette · ZIP…** and **Export → Cassette · ZIP** to move the
project, including both saved files and working drafts, between browsers.

To try the browser app from a local checkout, run `python3 -m http.server --directory docs 8000` and open [Tetorica SM510 Synth](http://localhost:8000/synth-lcd-buzzer/). Run `npm run test:lcd-buzzer-synth` for the audio and Cassette tests.

The software oscillator and example sources are original. The source is available under the repository's [BSD 3-Clause license](../../LICENSE).
