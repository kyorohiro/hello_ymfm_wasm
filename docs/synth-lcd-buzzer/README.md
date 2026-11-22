# Tetorica SM510 Synth

Tetorica SM510 Synth combines the Sharp SM510 buzzer, SM511 melody voice,
and an equal-tempered square wave. Use the upper **SM510**, **SM511**,
**lcd-buzzer**, and **Mixer** tabs to choose a voice or adjust the mix.
Use the lower **Keyboard**, **Code**, and **Step Sequencer**
tabs to perform and edit. The selected chip supplies the Keyboard, computer
keys, step previews, Step Sequencer, WAV export, and the `lcd-buzzer` Code
client. Cassette and pattern files store the MIDI notes and rests.

- Choose an original pattern or enter a note or **Rest** in each of the eight steps. Click a step number to audition its note.
- Set the tempo, note length and volume. Each step represents an eighth note. Editing a note, tempo or note length during playback starts the updated pattern from step one.
- Use **Play**, **Stop** and **Loop** to listen. **Export WAV** saves one pass through the sequence as 48 kHz mono PCM16 using the selected chip's mixer level, mute state, and Master.

## SM510 tone source

The **Tone source** buttons in **SM510** set how that voice renders new notes.
A held note keeps its original tone until release.

| Tone source | What you hear |
| --- | --- |
| **Direct R** (default) | The direct-output mask lets the program toggle R1. Each note uses an integer number of SM510 machine cycles per half-wave, so the pitch may differ from the note’s equal-tempered frequency. |
| **DK-52 Divider** | Each playable note opens the gate on the DK-52’s fixed 4,096 Hz R1 carrier. Changing notes leaves the carrier frequency fixed. Rests close the gate. |

The **lcd-buzzer** tab plays the software square wave in equal temperament
from C3 to C6, with A4 at 440 Hz. It has its own level and mute in **Mixer**.

## SM511 melody voice

The SM511 uses a dedicated melody controller with a 256-step ROM and six bits
per step. The stored commands describe notes, rests, and stops. The controller
generates 12 chromatic pitches in either of two octaves from the 32.768 kHz
clock, with timing units of 62.5 ms or 125 ms. The browser's SM511 voice
renders the controller's output in WASM built from the same C++ source as
the native core.
[Sharp Microcomputers Data Book, SM511/SM512 p. 166](https://ftpmirror.your.org/pub/misc/bitsavers/components/sharp/_dataBooks/1990_Sharp_Microcomputers_Data_Book.pdf)

Open **SM511** and use **Play melody** and **Stop melody** to audition the
included original tune. Use **ROM note**, **Lower octave** or **Upper octave**,
and **62.5 ms** or **125 ms** to assemble one command for **Play ROM note**.
The hex value shown beside the buttons is the command to use in Code.
SM511 performance maps the
existing MIDI keys and steps two octaves up and folds them into C♯5–C7.
For example, C4 sounds as C6. SM511 sequence playback rounds note and rest
boundaries to 62.5 ms ticks and packs them into 62.5 ms or 125 ms commands.

### SM511 from Code

`useSoundChip('sm511')` plays melody commands on the SM511 bus.
`playMelody()` accepts 1–256 six-bit commands. In the low nibble,
`0x0` is a rest, `0x1` ends playback, and `0x2`–`0xD` are pitches.
Bit 4 selects the upper octave and bit 5 selects the 125 ms duration.
A clear bit 5 gives a 62.5 ms note or rest. The player ends on the first stop
command or after the last command. Use `stopMelody()` to stop it early.

```js
const chip = await useSoundChip('sm511');
await chip.playMelody([0x0d, 0x09, 0x27, 0x00, 0x15, 0x12, 0x01]);
```

## Mixer

**Mixer** gives SM510, SM511, and lcd-buzzer their own level and mute controls before
the shared **Master**. Master and the Step Sequencer's **Volume** adjust the
same gain. Opening Mixer keeps playback running on the selected chip.
Code can play SM510 register writes and SM511 melodies together on their
respective buses.

## Synth and Code

Open **Keyboard** to play the on-screen pads or their matching computer
keys. Use Octave and Fret to move the pitches. In **Code**, type in the
editor to edit the script, or focus the **Code** tab to play with the computer
keys. The physical note keys also work while source buttons, switches, or
sliders have focus. Use the arrow keys to adjust focused sliders.
The top **Code** button moves **Keyboard**, **Code**, and **Step Sequencer**
next to the chip tabs. **Run** starts a session and **Apply** updates it.
Both controls sit below the Code editor with
**Stop Code**. **Play** and **Stop** sit below the Step Sequencer. Run or
Apply stops manual sequence playback. Play stops the Code session, including
a running script that is waiting between notes. Either Stop stops both
transports. A script can still use `playPattern()` as part of Code playback.

The SM510 and SM511 tabs distinguish each chip’s hardware behavior from app
controls. The ROM preview, Keyboard, Code, and Step Sequencer belong to the
app. The lcd-buzzer comparison voice and Mixer levels also run in software.

```js
const buzzer = await useSoundChip('lcd-buzzer');
await buzzer.noteOn(CH1, 'C4');
await beat(0.25);
buzzer.noteOff(CH1);

buzzer.setPattern(['C4', null, 'E4', null, 'G4', 'E4', 'C5', null]);
buzzer.configure({ bpm: 144, gate: 0.4 });
await buzzer.playPattern({ loop: false });
```

Existing `useSoundChip('lcd-buzzer')` scripts use the note and pattern
performance API. Use `setStep(0, 'C4')` to change the first step and `null`
for a rest. Notes accept a name or integer MIDI value from C3 through C6.
`configure()` accepts tempo (`bpm`), note length (`gate`), `volume`, and
`loop`. Gate and volume use fractions.

## SM510 buzzer demo

Open **Files → Sound chip** and try **Play R1**. The demo models the DK-52
board's R1 output, using the 32,768 Hz clock divided by eight to give a nominal
4,096 Hz square carrier. Select **Single beep**, **Double beep** or **Rapid
beeps**, toggle individual gates, or move **Step time**. Longer on intervals
and different gaps change the effect while the carrier stays fixed.

The demo shares the instrument's **Volume** control. **Play R1** always uses
the DK-52 divider, and its eight gates and step time belong to the demo.
[MAME DK-52 wiring](https://github.com/mamedev/mame/blob/master/src/mame/handheld/hh_sm510.cpp#L1754-L1800) · [SM510 R output](https://github.com/mamedev/mame/blob/master/src/devices/cpu/sm510/sm510.cpp#L43-L69)

### R latch and Code

The **SM510** tab shows the two-bit **R latch** in binary and hexadecimal.
Toggle **R1** (bit 0) and **R2** (bit 1) to write the latch by hand. Use
**Monitor** to route either pin or **R1 − R2** to Pulse output and mono audio.
This applies to manual controls and explicit Code register writes. The DK-52
board model, Keyboard, and Step Sequencer use R1.

In **Direct R**, select **Monitor R2** and toggle R2 to see High and Low. A
steady level gives no sustained tone. In **DK-52 Divider**, either enabled
pin produces 4,096 Hz, with opposite phases. Turn both pins on and select
**R1 − R2** to hear the same pitch with twice the signal swing. The readout
follows cycle sequences at the screen's refresh rate.

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
(431.16 Hz). Select **lcd-buzzer** to hear A4 at 440 Hz.
The sequencer plays complete direct R periods within each note's time
window. Live keyboard playback uses a short gain fade on release.

### Machine-cycle timing in Code

`sm510.clock` is the master clock in Hz and `sm510.machineCycleHz` is the CPU
machine-cycle rate. Both clients accept a four-bit operand for `REG_R`.
The low two bits fill the latch. An immediate `write()` changes the latch
when called and `sleep()` uses the Code runtime clock.
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

## Native and WASM audio cores

Both C++ cores average the pin signal over each PCM sample interval using
the chip's master clock. Run `sh scripts/build_sm510.sh "" build/sm510` to
build the browser `sm510.wasm` and the native `build/sm510/libsm510.a` with
both voices. The C ABI exposes SM510 pin states and timed writes, and SM511
pitch and melody rendering.
[SM510 core](../../tetorica_src/native/sm510/sm510.cpp) · [SM511 core](../../tetorica_src/native/sm510/sm511.cpp) · [C ABI](../../tetorica_src/native/sm510/sm510.h)

## Files and Menu

The **Files** button sits next to **Mixer** in both views. Use it to open or
close the file panel. `/index.js` contains the starter Code
and `/pattern.json` holds the active sequence. Select a saved pattern to load
it into the sequencer. **＋ Pattern** keeps a named copy alongside Code and
other project files. Use **＋ JS** to create a script. Right-click a file or
folder for Duplicate, Rename, and Delete, or to create a file or folder in
that part of the tree. **Sound chip** opens the hardware guide.

New Cassettes include editable Code examples in **Files → examples**.
Run `short-beep.js`, `chirp.js`, or `trill.js` to hear the selected tone
source. Run `sm510-r1.js` or `sm510-cycles.js` for immediate or cycle-timed
DK-52 R1 writes, or `sm511-melody.js` for a Melody ROM phrase. In an existing Cassette, **Add examples** fills unused
example paths with ready-to-run copies. An existing file, directory or
pending deletion keeps its path.

With **Auto apply** off, edited files show **●**. **Run** and **Apply** read
saved Code and saved imports. Use **Save**, Ctrl/Cmd+S, or **Menu → Save all**
to accept edits. **Menu → New → Cassette…** starts a new project. Use
**Import → Cassette · ZIP…** and **Export → Cassette · ZIP** to move the
project, including both saved files and working drafts, between browsers.

To try the browser app from a local checkout, run `python3 -m http.server --directory docs 8000` and open [Tetorica SM510 Synth](http://localhost:8000/synth-lcd-buzzer/). Run `npm run test:lcd-buzzer-synth` for the audio and Cassette tests.

The software oscillator and example sources are original. The source is available under the repository's [BSD 3-Clause license](../../LICENSE).
