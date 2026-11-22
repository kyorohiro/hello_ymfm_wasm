# Tetorica SM510 Synth

Tetorica SM510 Synth is a monophonic software instrument inspired by the piezo buzzers in early LCD handhelds powered by Sharp SM510-family chips. It generates a two-level pulse and uses short fades at the start and end of each beep to reduce clicks.

- Choose an original pattern or enter a note or **Rest** in each of the eight steps. Click a step number to audition its note.
- Set the tempo, note length and volume. Each step represents an eighth note. Editing a note, tempo or note length during playback starts the updated pattern from step one.
- Use **Play**, **Stop** and **Loop** to listen. **Export WAV** saves one pass through the sequence as 48 kHz mono PCM16 at the selected volume.

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

The demo shares the instrument's Volume control. Its settings are local to
the demo. The eight-step sequencer, Keyboard, and
pitched Code examples use a separate software-tuned voice. [MAME DK-52 wiring](https://github.com/mamedev/mame/blob/master/src/mame/handheld/hh_sm510.cpp#L1754-L1800) · [SM510 R output](https://github.com/mamedev/mame/blob/master/src/devices/cpu/sm510/sm510.cpp#L43-L69)

### R1 from Code

Open `examples/sm510-r1.js` in **Files** and press **Run**. Bit 0 of `REG_R`
gates the fixed R1 carrier. Write `0x1` to open the gate and `0x0` to close
it. Change the wait in seconds to shape the beep.

```js
const sm510 = await useSoundChip("sm510");
await sm510.write(sm510.REG_R, 0x1);
await sleep(0.1);
await sm510.write(sm510.REG_R, 0x0);
```

### Machine-cycle timing

The SM510 oscillator is nominally 32,768 Hz. One CPU machine cycle takes two
oscillator ticks (about 61 µs). `LAX` and `ATR` each take one machine cycle.
An alternating `LAX` / `ATR` instruction sequence can change the latch every two
machine cycles (about 122 µs), before any branch overhead. The divider advances
every oscillator tick. With R1 enabled, bit 2 gives a period of eight ticks and
four ticks per half-wave. In a direct-output mask configuration the pin instead
follows the latch. [MAME CPU timing](https://github.com/mamedev/mame/blob/master/src/devices/cpu/sm510/sm510base.h#L69-L75) · [Divider and CPU execution](https://github.com/mamedev/mame/blob/master/src/devices/cpu/sm510/sm510base.cpp#L211-L227) · [ATR](https://github.com/mamedev/mame/blob/master/src/devices/cpu/sm510/sm510op.cpp#L234-L239)

`sm510.clock` is the master clock in Hz and `sm510.machineCycleHz` is the CPU
machine-cycle rate. `REG_R` identifies the host's 4-bit latch. An immediate
`write()` changes the latch when called and `sleep()` uses the Code runtime clock.
For deterministic offsets, `build()` records writes and `playCycles()` renders
one finite sequence. Cycle zero starts with the divider and latch cleared.
The last `atCycle()` sets the end, up to 30 seconds. Writes are external latch
operations. Include instruction costs in the offsets when representing a program.

```js
const sm510 = await useSoundChip("sm510");
const pulse = sm510.build(b => {
  b.atCycle(2).write(sm510.REG_R, 0x1);    // LAX and ATR complete
  b.atCycle(1640).write(sm510.REG_R, 0x0); // 1,638 cycles later
});
await sm510.playCycles(pulse);
```

The DK-52 demo and the two SM510 Code paths use one [C++ core](../../tetorica_src/native/sm510/sm510.cpp).
It averages the digital signal over each PCM sample interval, including writes
between sample boundaries. Run `sh scripts/build_sm510.sh "" build/sm510` to
build the browser `sm510.wasm` and the native `build/sm510/libsm510.a`. The
[C ABI](../../tetorica_src/native/sm510/sm510.h) accepts writes as master-tick
offsets and exposes both divider and direct pin states.

## Files and Menu

Open or close **Files** in either view. `/index.js` contains the starter Code
and `/pattern.json` holds the active sequence. Select a saved pattern to load
it into the sequencer. **＋ Pattern** keeps a named copy alongside Code and
other project files. Use **＋ JS** to create a script. Right-click a file or
folder for Duplicate, Rename, and Delete, or to create a file or folder in
that part of the tree. **Sound chip** opens the hardware guide.

New Cassettes include five editable Code examples in **Files → examples**.
Run `short-beep.js`, `chirp.js`, or `trill.js` to explore the software-tuned
voice. Run `sm510-r1.js` or `sm510-cycles.js` for immediate or cycle-timed R1 writes. In an existing
Cassette, **Add examples** fills unused example paths with ready-to-run copies.
An existing file, directory or pending deletion keeps its path.

With **Auto apply** off, edited files show **●**. **Run** and **Apply** read
saved Code and saved imports. Use **Save**, Ctrl/Cmd+S, or **Menu → Save all**
to accept edits. **Menu → New → Cassette…** starts a new project. Use
**Import → Cassette · ZIP…** and **Export → Cassette · ZIP** to move the
project, including both saved files and working drafts, between browsers.

To try the browser app from a local checkout, run `python3 -m http.server --directory docs 8000` and open [Tetorica SM510 Synth](http://localhost:8000/synth-lcd-buzzer/). Run `npm run test:lcd-buzzer-synth` for the audio and Cassette tests.

The software oscillator and example sources are original. The source is available under the repository's [BSD 3-Clause license](../../LICENSE).
