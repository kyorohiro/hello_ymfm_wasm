# Tetorica SM510 Synth

Tetorica SM510 Synth combines the Sharp SM510 buzzer and SM511 melody voice.
Use the upper **SM510**, **SM511**, and **Mixer** tabs to choose a voice or
adjust the mix. Use **Keyboard** and **Code** to perform and edit, or
**SM511 → Melody ROM** to edit and play the chip's 256 melody commands.

## SM510 tone source

The **Tone source** buttons in **SM510** set how that voice renders new notes.
A held note keeps its original tone until release.

| Tone source | What you hear |
| --- | --- |
| **Direct R** (default) | The direct-output mask lets the program toggle R1. Each note uses an integer number of SM510 machine cycles per half-wave, so the pitch may differ from the note’s equal-tempered frequency. |
| **DK-52 Divider** | Each playable note opens the gate on the DK-52’s fixed 4,096 Hz R1 carrier. Changing notes leaves the carrier frequency fixed. Rests close the gate. |

## SM511 melody voice

The SM511 uses a dedicated melody controller with a 256-step ROM and six bits
per step. The stored commands describe notes, rests, and stops. The controller
generates 12 chromatic pitches in either of two octaves from the 32.768 kHz
clock, with timing units of 62.5 ms or 125 ms. SM512 shares this melody
controller and expands the LCD segment map. The browser's SM511 voice
renders the controller's output in WASM built from the same C++ source as the
native core.
[Sharp Microcomputers Data Book, SM511/SM512 p. 166](https://ftpmirror.your.org/pub/misc/bitsavers/components/sharp/_dataBooks/1990_Sharp_Microcomputers_Data_Book.pdf)

With **SM511** selected, press an on-screen pad or computer key to play one
ROM note for **62.5 ms** or **125 ms**. Releasing the key can stop it early.
Enable **Repeat · Software** to continue the same ROM note for as long as
the key is held. The waveform continues across the repeated slots.
**Key tracking · Software** maps each key two octaves up and folds it into
C♯5–C7. For example, C4 sounds as C6. Moving **ROM note** or choosing an
octave switches to one fixed ROM pitch for every key. Check **Key tracking**
again to follow the keys. The hexadecimal readout shows the command that
can be used from Code. When SM511 is selected, existing `lcd-buzzer.noteOn()`
scripts follow its pitch controls and hold the tone until `noteOff()`.

### Melody ROM editor

Select a ROM address from `0x00` to `0xFF` and choose a note, **Rest**, or
**Stop**. Use **Lower octave** or **Upper octave** for each note. Notes and
rests use **62.5 ms** or **125 ms**. The editor opens with
the original demo and fills the remaining addresses with Stop commands.
**Play melody** starts at `0x00`. **Play from** starts at the selected address.
Playback ends at the first Stop or at the end of the address range.
**Copy as Code** copies all 256 commands as JavaScript for `sm511.playMelody()`.

The edited ROM is saved with the Cassette. Select SM511 and choose
**Menu → Export → Melody ROM · WAV** to export playback from `0x00` as
48 kHz mono PCM16 at the current SM511 Mixer and Master levels.

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

Use [`build()`, `compile()`, and `schedule()`](#named-timed-playback) to
inspect the ROM timing or reserve playback on the audio clock.

## Mixer

**Mixer** gives SM510 and SM511 their own level and mute controls.
The **Master** in the top toolbar adjusts the combined output in Synth and
Code. Opening Mixer keeps playback running on the selected chip.
Code can play SM510 register writes and SM511 melodies together on their
respective buses.

## Synth and Code

Open **Keyboard** to play the on-screen pads or their matching computer
keys. Use Octave and Fret to move the pitches. In **Code**, type in the
editor to edit the script, or focus the **Code** tab to play with the computer
keys. The physical note keys also work while source buttons, switches, or
sliders have focus. Use the arrow keys to adjust focused sliders.
The top **Code** button opens **Files** and the editor side by side below
**Pulse output**. The performance and chip tabs share the top of the editor
column. Select a chip tab to show its controls in that column. Select
**Code** to return to the editor. Code playback continues across these
views. **Run** starts a session and **Apply** updates it.
Both controls sit above the Code editor with **Stop Code** and the Code
status. The Melody ROM editor has its own Play and Stop controls. Run or
Apply stops editor playback, and editor playback stops the Code session.
Either Stop ends Code and Melody ROM editor playback.

The SM510 and SM511 tabs distinguish each chip’s hardware behavior from app
controls. The Melody ROM editor, Keyboard, Code, and Mixer belong to the app.

```js
const buzzer = await useSoundChip('sm510');
await buzzer.noteOn(CH1, 'C4');
await beat(0.25);
buzzer.noteOff(CH1);

buzzer.setPattern(['C4', null, 'E4', null, 'G4', 'E4', 'C5', null]);
buzzer.configure({ bpm: 144, gate: 0.4 });
await buzzer.playPattern({ loop: false });
```

`sm510.noteOn()` and `sm510.playPattern()` use the SM510 tone source set in
the app. The `sm510` register and cycle methods use the DK-52 divider. The
`sm510-direct` register and cycle methods use the direct mask.

Existing `useSoundChip('lcd-buzzer')` scripts play notes and patterns on the
selected SM510 or SM511. Use `setStep(0, 'C4')` to change the first step and
`null` for a rest. Notes accept a name or integer MIDI value from C3 through
C6. `configure()` accepts tempo (`bpm`), note length (`gate`), `volume`, and
`loop`. Gate and volume use fractions.

## SM510 buzzer demo

Open **Files → Sound chip** and try **Play R1**. The demo models the DK-52
board's R1 output, using the 32,768 Hz clock divided by eight to give a nominal
4,096 Hz square carrier. Select **Single beep**, **Double beep** or **Rapid
beeps**, toggle individual gates, or move **Step time**. Longer on intervals
and different gaps change the effect while the carrier stays fixed.

The demo shares the toolbar's **Master** control. **Play R1** always uses
the DK-52 divider, and its eight gates and step time belong to the demo.
[MAME DK-52 wiring](https://github.com/mamedev/mame/blob/master/src/mame/handheld/hh_sm510.cpp#L1754-L1800) · [SM510 R output](https://github.com/mamedev/mame/blob/master/src/devices/cpu/sm510/sm510.cpp#L43-L69)

### CPU Pulse

With **SM510** selected, press and hold a keyboard pad or its matching
computer key to play a CPU pulse. **Key tracking · Software** maps the note
to the closest available rate. Moving **On/off interval** switches to a
fixed rate for every key. Check **Key tracking** again to follow the pitch
of the held key.

The voice uses the two-page `LAX` / `ATR` / padding / `TL` routine, with
4–63 machine cycles per half-period at 16,384 machine cycles per second.
**Direct R** plays the resulting pitch, from 2,048 Hz down to about 130 Hz.
In **DK-52 Divider**, the same CPU timing gates a 4,096 Hz carrier.

**Drive** selects which pins participate. The voice auditions across R1 and
R2. With both pins selected in Direct R, the CPU alternates `0x1` and `0x2`.
In Divider mode it alternates `0x3` and `0x0`, and the enabled pins have
opposite phase. **Drive** shows **Off** with both pins disabled, **1× swing**
with one pin, and **2× swing** with both. The readout describes the voltage
across the pins in this wiring. Change **Drive** while holding a key. The
app's **Mixer → SM510** level adjusts playback volume after synthesis.

### R latch and Code

Use **Files → Sound chip → Code monitor** to route either pin or **R1 − R2**
to Pulse output and mono audio for explicit Code register writes. The monitor
defaults to R1 to match the DK-52 board wiring, and the R1 gate demo uses that
same pin. In Direct R, a steady pin level gives no sustained tone.

Use `useSoundChip('sm510')` for the DK-52 divider and
`useSoundChip('sm510-direct')` for the direct mask. Each client keeps its
mask regardless of the **Tone source** selector. Both expose immediate writes,
one-shot cycle playback, and [named timed playback](#named-timed-playback).

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
(431.16 Hz).
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

## Named timed playback

SM510 and SM511 Code clients share the `build()`, `compile()`, `schedule()`,
and `clearSchedule()` workflow. `build()` prepares the program and
`await chip.compile(plan)` returns a timing trace without changing playback.
The SM510 trace lists the recorded external R writes in order. Each row has
`register`, `value`, `machineCycle`, `masterTick`, `offsetSeconds`,
`operationIndex`, and `writeIndex`. `value` preserves the four-bit write
operand. The automatic end-of-phrase latch clear is outside the trace.
The SM511 trace lists `address`, `command`, `masterTick`, `durationTicks`,
`offsetSeconds`, and `durationSeconds` for each ROM entry. The first Stop
ends the trace with a zero-duration row.
On both chips one master tick lasts 1/32,768 second.

The following example reserves a DK-52 beep pattern and an SM511 melody on
their own Mixer channels. Each phrase takes a quarter of a second and starts
again every second.

```js
const sm510 = await useSoundChip('sm510');
const sm511 = await useSoundChip('sm511');

const pulse = sm510.build(b => {
  b.atCycle(2).write(sm510.REG_R, 0x1);
  b.atCycle(1024).write(sm510.REG_R, 0x0);
  b.atCycle(3074).write(sm510.REG_R, 0x1);
  b.atCycle(4000).write(sm510.REG_R, 0x0);
  b.atCycle(4096);
});
const melody = sm511.build([0x0d, 0x20, 0x12, 0x01]);

console.table(await sm510.compile(pulse));
console.table(await sm511.compile(melody));
await sm510.schedule(pulse, { name: 'pulse', repeatSeconds: 1 });
await sm511.schedule(melody, { name: 'melody', repeatSeconds: 1 });
```

`schedule()` resolves when the reservation is accepted. A top-level receipt
has `staged: true` until the current evaluation commits. Inside a live loop
the receipt includes `startTime` in AudioContext seconds. Omit `repeatSeconds`
to play once. The repeat period must be at least the phrase's duration and
at most 60 seconds. It is independent of BPM and aligned to whole audio
frames, with room for the complete phrase. Each repeat plays the phrase
from reset on the browser's `AudioContext` clock.

Each chip can play one timed reservation at a time. A new reservation on
that chip replaces the current one, even with a different name. `sm510` and
`sm510-direct` share this reservation. Each plan uses the DK-52 or Direct R
mode of the client that built it. SM511 can play independently. Playing a key
or using an immediate playback method on the same chip can interrupt
scheduled playback. Use
`await chip.clearSchedule(name)` from the script or loop that owns the
reservation to cancel a matching name.

Top-level reservations take effect after a successful **Run** or **Apply**.
On Apply, reusing a name replaces its reservation and omitted top-level
names are cleared. A failed Apply keeps the previous reservations. A
reservation made inside `liveLoop()` belongs to that loop. Removing the
loop or stopping it cancels its reservations. When you keep a loop on Apply,
its reservation survives removing the `schedule()` call. Cancel it explicitly
with `clearSchedule()`. **Stop Code** cancels all Code reservations.

## Native and WASM audio cores

Both C++ cores average the pin signal over each PCM sample interval using
the chip's master clock. Run `sh scripts/build_sm510.sh "" build/sm510` to
build the browser `sm510.wasm` and the native `build/sm510/libsm510.a` with
both voices. The C ABI exposes SM510 pin states and timed writes, and SM511
pitch and melody rendering.
[SM510 core](../../tetorica_src/native/sm510/sm510.cpp) · [SM511 core](../../tetorica_src/native/sm510/sm511.cpp) · [C ABI](../../tetorica_src/native/sm510/sm510.h)

## Files and Menu

The **Files** button sits next to **Menu** in both views. Use it to open or
close the file panel. `/index.js` contains the starter Code,
and `/pattern.json` holds the active eight-step pattern for Code playback.
Select a saved pattern to make it active. **＋ Pattern** keeps a named copy alongside Code and
other project files. Use **＋ JS** to create a script. Right-click a file or
folder to duplicate, rename, delete, create a folder, or undo a file change.
**Sound chip** opens the hardware guide.

New Cassettes include editable Code examples in **Files → examples**.
Run `short-beep.js`, `chirp.js`, or `trill.js` to hear the SM510 tone
source. Run `sm510-r1.js` or `sm510-cycles.js` for immediate or cycle-timed
DK-52 R1 writes, or `sm511-melody.js` for a Melody ROM phrase.

With **Auto apply** off, edited files show **●**. **Run** and **Apply** read
saved Code and saved imports. Use **Save**, Ctrl/Cmd+S, or **Menu → Save all**
to accept edits. **Menu → New → Cassette…** starts a new project. Use
**Import → Cassette · ZIP…** and **Export → Cassette · ZIP** to move the
project, including both saved files and working drafts, between browsers.

To try the browser app from a local checkout, run `python3 -m http.server --directory docs 8000` and open [Tetorica SM510 Synth](http://localhost:8000/synth-lcd-buzzer/). Run `npm run test:lcd-buzzer-synth` for the audio and Cassette tests.

The software oscillator and example sources are original. The source is available under the repository's [BSD 3-Clause license](../../LICENSE).
