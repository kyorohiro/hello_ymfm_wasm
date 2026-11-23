# Tetorica SM510 Synth

Tetorica SM510 Synth combines the Sharp SM510 buzzer and SM511 melody voice.
Use the upper **SM510 (Direct R)**, **SM510 (DK-52 Divider)**, **SM511**,
and **Mixer** tabs to choose a configuration or adjust the mix. Use
**Keyboard** and **Code** to perform and edit, or **SM511 → Melody ROM**
to edit and play the chip's 256 melody commands.

## SM510 tone source

The two SM510 tabs model separate factory mask options for the R outputs.
Both use the SM510 Mixer channel. On the chip, `ATR` can change which of its
two R pins are driven while the mask fixes the output source.

| SM510 tab | What you hear |
| --- | --- |
| **Direct R** (default) | The program toggles the R latch at whole SM510 machine cycles. **Duty** changes the pulse width. At 0% and 100% the latch holds a steady level and the audio is silent. |
| **DK-52 Divider** | Each playable note opens the gate on the DK-52’s fixed 4,096 Hz R1 carrier. Changing notes leaves the carrier frequency fixed. Rests close the gate. |

## SM511 melody voice

The SM511 uses a dedicated melody controller with a 256-step ROM and six bits
per step. The stored commands describe notes, rests, and stops. The controller
generates 12 chromatic pitches in either of two octaves from the 32.768 kHz
clock, with timing units of 62.5 ms or 125 ms. The controller drives a
single melody output pin, **R**. Use **CPU Pulse → Drive R** to switch the
output between **1× swing** and **Off** while the melody clock keeps running.
On the chip, `SME` enables melody output and `RME` disables it. Use
**Mixer → SM511** to adjust the app's playback level. SM512 shares this
melody controller and expands the LCD segment map. The browser's SM511 voice
renders the controller's output in WASM built from the same C++ source as the
native core.
[Sharp Microcomputers Data Book, SM511/SM512 pp. 161–170](https://bitsavers.trailing-edge.com/components/sharp/_dataBooks/1990_Sharp_Microcomputers_Data_Book.pdf#page=170)

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

The ROM shows 32 addresses per page in four rows of eight. Scroll the grid
sideways on narrow screens. Each address from `0x00` to `0xFF` has its own
**− / +** control.
Drag its center label left or right, or press **−** or **+**, to step through
**Stop**, **Rest**, and the notes in both SM511 octaves. Click the center to
select the address, or navigate between addresses with the arrow keys.
The **Command** menu below the grid also edits the selected address.
Use **Lower octave** and **Upper octave** to keep the pitch class when
changing octaves. Notes and rests use **62.5 ms** or **125 ms**.
The editor opens with the original demo and fills the remaining addresses
with Stop commands.

Choose a **Start address** from `0x00` to `0xFF` and press **Play melody**.
The address selected in the grid is the one you edit. During playback,
**Start address** updates the hexadecimal readout and seeks as you move the
slider. Each pass ends at the first Stop or at the end of the ROM.
**Repeat · Software** repeats the phrase from
the selected start address. If that address contains Stop, Repeat waits
silently there. Edit that command or choose a new start address to resume
playback. Turn Repeat off to finish the current pass or end the silent
wait. Melody ROM Repeat defaults on and is independent of the keyboard's
Repeat switch. Press **Stop melody** to end playback.

Changes to a note, rest, or duration take effect during playback. Start
address changes and ROM edits share a preview update. It uses the latest
values at most once per browser frame, with at least 8 ms between audio
updates for the transition. This exceeds the roughly 244 µs of a two-cycle
`PRE` instruction at the SM511's reset CPU clock. ROM editing is an app
feature for previewing changes to the hardware's fixed ROM contents.
[Sharp SM511/SM512 timing, p. 166](https://bitsavers.trailing-edge.com/components/sharp/_dataBooks/1990_Sharp_Microcomputers_Data_Book.pdf#page=175)

The player keeps its current address and elapsed position when the edited
ROM allows it. If a Stop edit cuts off the current position, Repeat returns
to the selected start address. **Copy as Code**
copies all 256 commands and the chosen start address into a one-pass script
that calls `sm511.setMelody()` and `sm511.play()`.

The edited ROM is saved with the Cassette. Select SM511 and choose
**Menu → Export → Melody ROM · WAV** to export playback from `0x00` as
48 kHz mono PCM16 with the current Drive R, SM511 Mixer and Master settings.

### SM511 from Code

`useSoundChip('sm511')` plays melody commands on the SM511 bus.
`setMelody(words)` loads 1–256 six-bit commands into Code's own 256-word ROM.
Before the first load, every address contains Stop. Each load fills the
unused addresses with Stop commands. In the low nibble, `0x0` is a rest,
`0x1` ends playback, and `0x2`–`0xD` are pitches.
Bit 4 selects the upper octave and bit 5 selects the 125 ms duration.
A clear bit 5 gives a 62.5 ms note or rest.

`await sm511.play(address)` plays from an address between `0x00` and `0xFF`.
The default is `0x00`. Playback ends at the first Stop or the end of the
ROM. Use `sm511.stop()` to stop it early.

```js
const sm511 = await useSoundChip('sm511');
sm511.setMelody([0x0d, 0x09, 0x27, 0x00, 0x15, 0x12, 0x01]);
await sm511.play(0x02);
```

`playMelody(words)` plays a standalone command array and keeps the loaded
ROM. `stopMelody()` is a compatibility name for `stop()`, which stops
immediate playback. To inspect or schedule playback of the loaded ROM, make
a snapshot with `build(address)`. The address defaults to `0x00`.
`build(words)` also accepts a command array directly at `0x00`. See
[Named timed playback](#named-timed-playback) for `compile()`, `schedule()`,
and `clearSchedule()`.

#### SM511 melody controller instructions

`setMelody(words)` supplies the emulated chip's mask ROM. It resets an
existing instruction session. The first instruction starts a C++ controller
in an AudioWorklet. Use `pre(address)` to set the ROM pointer and clear the
step counter, `sme()` to enable the R output, and `rme()` to disable it while
the controller clock continues. `tmel()` tests and clears the Stop flag.
The controller sets the flag again while its address still contains Stop.
`captureState()` observes the active controller's address, enable flag,
Stop flag, R pin and elapsed master ticks. It keeps the Stop flag intact.

```js
const sm511 = await useSoundChip('sm511');
sm511.setMelody([0x0d, 0x09, 0x12, 0x01]);
await sm511.pre(0x00);
await sm511.tmel(); // Clear any flag left by the previous address.
await sm511.sme();
while (!(await sm511.tmel())) await sleep(0.002);
await sm511.rme();
```

Code acknowledges live instructions on the audio render clock. For
deterministic timing, pass an instruction recorder to `build()`.
`atCycle()` sets the time the instruction begins. Each `PRE`, `SME` or `RME`
uses two machine cycles at the 8,192 Hz reset CPU clock. The plan includes
the loaded ROM and the final cycle. `compile()` reports instruction
completion times. Use live `tmel()` for firmware-style decisions based on
the Stop flag. A timed plan records a fixed sequence of instructions.

```js
const plan = sm511.build(b => {
  b.pre(0x02).sme();
  b.atCycle(400).rme();
  b.atCycle(512);
});
console.table(sm511.compile(plan));
await sm511.schedule(plan, { name: 'sm511-pulse' });
```

`play(address)` plays one pass through the first Stop. Instruction playback
keeps clocking until Code stops, `stop()` is called, or another SM511 voice
takes over. The two playback modes share the SM511 output and its Mixer level.

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

### JavaScript API quick reference

| `useSoundChip()` ID | Immediate playback | Prepare timed playback |
| --- | --- | --- |
| `sm510-direct` | `write(REG_R, value)` for the R latch. `noteOn()` and `noteOff()` for pitched pulses. | `build()` records `atCycle().write()` operations. `pulseTiming()` reports an executable pulse width. `playCycles()` plays a plan once. |
| `sm510-dk52` | `write(REG_R, value)` for the divider gate. `noteOn()` and `noteOff()` for gated beeps. | `build()` records `atCycle().write()` operations. `playCycles()` plays a plan once. |
| `sm511` | `setMelody(words)`, `play(address)` and `stop()` for one-shot playback. `pre()`, `sme()`, `rme()` and `tmel()` for instruction control. | `build(address)` snapshots the ROM from an address. `build(words)` makes a standalone plan. `build(b => …)` records timed instructions. |

All three clients use `compile(plan)` to inspect timing, `schedule(plan, options)`
to start a named reservation and `clearSchedule(name)` to cancel it. The two
SM510 clients also expose the app's `setPattern()` and `playPattern()` helpers.

```js
const buzzer = await useSoundChip('sm510-direct');
await buzzer.noteOn(CH1, 'C4');
await beat(0.25);
buzzer.noteOff(CH1);

buzzer.setPattern(['C4', null, 'E4', null, 'G4', 'E4', 'C5', null]);
buzzer.configure({ bpm: 144, gate: 0.4 });
await buzzer.playPattern({ loop: false });
```

`useSoundChip('sm510-direct')` and `useSoundChip('sm510-dk52')` each fix the
mask for notes, patterns, register writes, and cycle playback. Existing
`useSoundChip('sm510')` scripts use the current SM510 tab for notes and
patterns and the DK-52 divider for register and cycle playback.

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
to the closest available rate. Moving the timing slider switches to a fixed
rate for every key. Check **Key tracking** again to follow the pitch of the
held key.

Both configurations set an 8–126 machine-cycle period in steps of two.
In **Direct R**, this gives pitches from 2,048 Hz down to about 130 Hz.
In **DK-52 Divider**, the period sets how often the gate opens on a fixed
4,096 Hz carrier.

In **Direct R**, adjust **R1 phase duty** to change the fraction of each period spent
in the phase where R1 is high. Duty defaults to 50%. It can change while
you hold a note, and the panel shows the realized pitch, duty and cycle
counts for the high and low phases. Each phase of a repeating pulse takes
at least two cycles. At 100%, the latch holds the R1 phase. At 0%, it holds
the R2 phase. The scope shows the enabled pins' steady level and the audio
is silent. Keyboard, pattern playback and Pattern WAV export use the same
duty setting in Direct R. Pattern `gate` controls how much of a step sounds.

In **DK-52 Divider**, **R1 gate duty** sets the share of each period for which
the gate is open. The readout shows the actual duty and the **ON / OFF** cycle
counts. At **100%** the gate stays open for a continuous 4,096 Hz carrier on
the enabled pins. At **0%** the gate stays closed. A gate that switches on
and off takes at least two machine cycles in each phase. **Continuous** sets
the gate period to **0 cycles** and holds the gate open. Switch Continuous off
to return to the previous gate settings. The Direct R and DK-52 duty values
are saved separately. CPU Pulse applies to keyboard and Code `noteOn()`
playback. Divider patterns use their own per-step `gate`.

**Drive** selects which pins participate. The voice auditions across R1 and
R2. With both pins selected in Direct R, the CPU alternates `0x1` and `0x2`.
With only R2 enabled, it is high during the complementary phase.
In Divider mode with both pins selected, the CPU alternates `0x3` and `0x0`,
and the two carriers have opposite phase. **Drive** shows **Off** with both
pins disabled, **1× swing** with one pin, and **2× swing** with both. The
readout describes the voltage across the pins in this wiring. Change
**Drive** while holding a key. The app's **Mixer → SM510** level adjusts
playback volume after synthesis.

### R latch and Code

Use **Files → Sound chip → Code monitor** to route either pin or **R1 − R2**
to Pulse output and mono audio for explicit Code register writes. The monitor
defaults to R1 to match the DK-52 board wiring, and the R1 gate demo uses that
same pin. In Direct R, a steady pin level gives no sustained tone.

Use `useSoundChip('sm510-dk52')` for the DK-52 divider and
`useSoundChip('sm510-direct')` for the direct mask. Both expose immediate writes,
one-shot cycle playback, and [named timed playback](#named-timed-playback).

Open `examples/sm510-r1.js` in **Files** and press **Run** for a DK-52 beep.
Bit 0 of `REG_R` gates the fixed R1 carrier. Write `0x1` to open the gate
and `0x0` to close it. Change the wait in seconds to shape the beep.

```js
const sm510 = await useSoundChip("sm510-dk52");
await sm510.write(sm510.REG_R, 0x1);
await sleep(0.1);
await sm510.write(sm510.REG_R, 0x0);
```

### Direct R pitch and duty

The SM510 oscillator is nominally 32,768 Hz. One CPU machine cycle takes two
oscillator ticks, so the CPU runs at 16,384 machine cycles per second. With
the direct mask, R1 follows bit 0 of the latch. A held level gives no
sustained tone. Successive writes that alternate the level produce the tone.

The app picks a period `P = 2 × N` for `N` from 4 to 63, to get the closest
available pitch in Hz. C3 uses 126 cycles (130.03 Hz), and A4 uses 38 cycles
(431.16 Hz). The pitch of a repeating pulse is `16,384 / P`. For duty
fractions between 0 and 1, the app rounds `P × d` to the nearest cycle
and limits the result to `2` through `P − 2`. The remaining cycles make up
the low phase. The actual duty is `highCycles / P`. An A4 with 25% requested
duty has 10 high and 28 low cycles, giving about 26.32% at 431.16 Hz.
At 0 and 1, the latch holds one phase and the frequency is zero.

An SM510 program can realize these timings using `LAX` and `ATR` to change
the latch in two cycles. It places one-cycle no-ops in the gaps and uses a
one-cycle `T` to loop within a ROM page, or two-cycle `TL` jumps between
pages. A period of up to 63 cycles fits on one page. For longer periods
with a short phase of up to 59 cycles, both latch updates fit on one page
and a second page holds the remaining delay. When both phases take 60 or
more cycles, the program can put them on separate pages and use a third
page to extend a phase beyond 63 cycles. These layouts follow the SM510's
polynomial program-counter order. The app renders the resulting latch
timing with the WASM core.
[Sharp Microcomputers Data Book, SM510 pp. 149–158](https://bitsavers.trailing-edge.com/components/sharp/_dataBooks/1990_Sharp_Microcomputers_Data_Book.pdf#page=158)

The sequencer plays complete Direct R periods within each note's time
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

`sm510-direct.pulseTiming(frequency, duty)` takes a target in Hz and a duty
fraction from 0 to 1. It returns `highCycles`, `lowCycles`, `periodCycles`,
`frequency` in Hz and the realized `duty` fraction. Duty 0 or 1 gives
`frequency: 0` and keeps the target period as a reference. Use those lengths
to place explicit writes when building a sequence. The raw methods play at
the cycle offsets you specify.

```js
const direct = await useSoundChip('sm510-direct');
const t = direct.pulseTiming(440, 0.25);
const firstWrite = 2; // LAX and ATR complete
const periods = 64;
const pulse = direct.build(b => {
  for (let i = 0; i < periods; i++) {
    const high = firstWrite + i * t.periodCycles;
    b.atCycle(high).write(direct.REG_R, 1);
    b.atCycle(high + t.highCycles).write(direct.REG_R, 0);
  }
  b.atCycle(firstWrite + periods * t.periodCycles);
});
console.log(t.frequency, t.duty);
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
`offsetSeconds`, and `durationSeconds` for each ROM entry. The addresses are
absolute ROM addresses. Timing starts at zero at the plan's start address.
The first Stop ends the trace with a zero-duration row.
On both chips one master tick lasts 1/32,768 second.

The following example reserves a DK-52 beep pattern and an SM511 melody on
their own Mixer channels. Each phrase takes a quarter of a second and starts
again every second.

```js
const sm510 = await useSoundChip('sm510-dk52');
const sm511 = await useSoundChip('sm511');

const pulse = sm510.build(b => {
  b.atCycle(2).write(sm510.REG_R, 0x1);
  b.atCycle(1024).write(sm510.REG_R, 0x0);
  b.atCycle(3074).write(sm510.REG_R, 0x1);
  b.atCycle(4000).write(sm510.REG_R, 0x0);
  b.atCycle(4096);
});
sm511.setMelody([0x0d, 0x20, 0x12, 0x01]);
const melody = sm511.build();

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
that chip replaces the current one, even with a different name. `sm510`,
`sm510-direct`, and `sm510-dk52` share this reservation. Each plan uses the
DK-52 or Direct R mode of the client that built it. SM511 can play
independently. Playing a key or using an immediate playback method on the same chip can interrupt
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

## References

### Sharp Hardware Documentation

- Sharp's original data book covers the SM510, SM511 and SM512 CPU architecture,
  instruction sets, buzzer circuits, Melody ROM and development equipment.
  The page numbers below are printed on the pages. The links open the
  corresponding pages in the PDF scan.
  [Sharp Microcomputers Data Book (1990)](https://bitsavers.trailing-edge.com/components/sharp/_dataBooks/1990_Sharp_Microcomputers_Data_Book.pdf)
- **SM510**. See pp. 149–158 for the chip description, p. 155 for R1/R2 and
  the buzzer circuit, and p. 157 for the `ATR` opcode and accumulator transfer.
  [SM510 chapter](https://bitsavers.trailing-edge.com/components/sharp/_dataBooks/1990_Sharp_Microcomputers_Data_Book.pdf#page=158) ·
  [Buzzer output, p. 155](https://bitsavers.trailing-edge.com/components/sharp/_dataBooks/1990_Sharp_Microcomputers_Data_Book.pdf#page=164) ·
  [Instruction table, p. 157](https://bitsavers.trailing-edge.com/components/sharp/_dataBooks/1990_Sharp_Microcomputers_Data_Book.pdf#page=166)
- **SM511 / SM512**. See p. 161 for the single `R` output, p. 166 for the two
  CPU clock rates, the 256 × 6-bit Melody ROM and the waveforms in Fig. 5, and
  p. 170 for `PRE`, `SME`, `RME` and `TMEL`.
  [Pins, p. 161](https://bitsavers.trailing-edge.com/components/sharp/_dataBooks/1990_Sharp_Microcomputers_Data_Book.pdf#page=170) ·
  [Clock and Melody ROM, p. 166](https://bitsavers.trailing-edge.com/components/sharp/_dataBooks/1990_Sharp_Microcomputers_Data_Book.pdf#page=175) ·
  [Instruction table, p. 170](https://bitsavers.trailing-edge.com/components/sharp/_dataBooks/1990_Sharp_Microcomputers_Data_Book.pdf#page=179)

### MAME — SM5xx CPU Emulation

- SM510 CPU behavior, including the Direct R and divided output paths and
  R2's inverted divider phase.
  [SM510 CPU implementation](https://github.com/mamedev/mame/blob/master/src/devices/cpu/sm510/sm510.cpp) ·
  [R output mask options](https://github.com/mamedev/mame/blob/master/src/devices/cpu/sm510/sm510base.h#L36-L41)
- Shared CPU behavior, timers, divider and program counter. The execution
  loop accounts separately for the second byte of a two-byte instruction.
  [SM510 common CPU implementation](https://github.com/mamedev/mame/blob/master/src/devices/cpu/sm510/sm510base.cpp) ·
  [Instruction fetch and cycle accounting](https://github.com/mamedev/mame/blob/master/src/devices/cpu/sm510/sm510base.cpp#L282-L308)
- SM511/SM512 CPU behavior and the melody controller, including the waveform
  phase table, Stop flag and address timing.
  [SM511 / SM512 implementation](https://github.com/mamedev/mame/blob/master/src/devices/cpu/sm510/sm511.cpp)
- Instruction effects for the R latch and the melody controller. The
  disassembler tables help match byte encodings to SM510 and SM511 mnemonics.
  [SM5xx instruction implementation](https://github.com/mamedev/mame/blob/master/src/devices/cpu/sm510/sm510op.cpp) ·
  [MAME disassembler tables](https://github.com/mamedev/mame/blob/master/src/devices/cpu/sm510/sm510d.cpp)

### MAME — LCD Handheld Games

- The handheld drivers identify chip variants, mask options and buzzer wiring
  for individual Game & Watch and other LCD units. The Donkey Kong DK-52
  configuration routes R1 to the piezo. Mickey & Donald DM-53 routes R2.
  [Handheld LCD game drivers](https://github.com/mamedev/mame/blob/master/src/mame/handheld/hh_sm510.cpp) ·
  [DK-52 configuration](https://github.com/mamedev/mame/blob/master/src/mame/handheld/hh_sm510.cpp#L1754-L1800) ·
  [DM-53 R2 connection](https://github.com/mamedev/mame/blob/master/src/mame/handheld/hh_sm510.cpp#L1852-L1858)

### Development Tools

- Sharp lists the **SME-30** emulator as **LU4DH300**, the SM510 evaluation
  board as **LU510H2A**, and its evaluation card as **LU510H4A**. The same
  product table lists breadboard emulation for the SM511/SM512.
  [Development support tools, p. 6](https://bitsavers.trailing-edge.com/components/sharp/_dataBooks/1990_Sharp_Microcomputers_Data_Book.pdf#page=15)
- The evaluation-board and emulator sections describe the historical
  workflow for testing programs before mask-ROM production. A host PC ran
  the development tools and connected to the emulator over RS-232C. The
  emulator supported single-step execution, breakpoints and tracing.
  [SM-series evaluation boards, pp. 254–258](https://bitsavers.trailing-edge.com/components/sharp/_dataBooks/1990_Sharp_Microcomputers_Data_Book.pdf#page=263) ·
  [SME-30 emulator, p. 259](https://bitsavers.trailing-edge.com/components/sharp/_dataBooks/1990_Sharp_Microcomputers_Data_Book.pdf#page=268)
