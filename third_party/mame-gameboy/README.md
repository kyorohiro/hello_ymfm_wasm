# MAME Game Boy APU (LR35902 DMG) adaptation

Upstream: https://github.com/mamedev/mame/blob/0e6df89e98f10a05af5fd4df32572982e1709c81/src/devices/sound/gb.cpp
Header: https://github.com/mamedev/mame/blob/fca00cace9e40ca70d82bbcc6dbd82167325e12b/src/devices/sound/gb.h

Revisions: `.cpp` at `0e6df89e98f10a05af5fd4df32572982e1709c81`, `.h` at
`fca00cace9e40ca70d82bbcc6dbd82167325e12b` (each file's own last-touched
commit; they had not diverged in between). Copyright holders: Wilbert Pol,
Anthony Kruize (thanks-to Shay Green). License: BSD-3-Clause (see LICENSE).
Both original files are retained unmodified in `upstream/`.

Only the base DMG (`dmg_apu_device`) variant is adapted; CGB04/AGB variants
in the same upstream file are not used by VGM's "GameBoy DMG" chip type.

## Scope and changes

`gameboy_apu.cpp` keeps the documented DMG APU model bit-for-bit: two square
channels (sweep on channel 1 only, envelope on both), a wavetable channel
reading 4-bit samples from 16 bytes of wave RAM, a noise channel with a
15-bit (or 7-bit "short") LFSR, the shared length counter/envelope/sweep
tick functions, the 8192-cycle/8-step frame sequencer (length at steps
0/2/4/6, sweep at 2/6, envelope at 7), the exact NR10-NR52 write side
effects (including the length-enable "extra clock" quirk gated by frame
sequencer step parity), and the final `convert_output`/pan/master-volume
mix. These come directly from `sound_w_internal`, `tick_length`,
`tick_sweep`, `tick_envelope`, `calculate_next_sweep`, `apply_next_sweep`,
`update_square_channel`, `dmg_apu_device::update_wave_channel`,
`update_noise_channel`, `noise_period_cycles`, `apu_power_off` and
`sound_stream_update` in the upstream file.

The upstream's cycle-catchup design (`update_state()` fast-forwarding by
bulk cycle counts between register accesses, driven by a `sound_stream`/
`emu_timer` pair) is replaced with a plain per-native-cycle `tick()`, matching
the tick-then-resample structure this project's other chip adaptations use
(see `third_party/mame-ay8910`). Each square/wave/noise channel's own
"advance every N cycles" behavior is kept exact (dividing by 4, 2 and
`divisor << shift` respectively) via a per-channel sub-cycle counter, rather
than the upstream's division-based bulk shortcut; this is a change in
*how* elapsed cycles are consumed, not in the resulting waveform.

MAME's `wave_r`/`sound_r` (VGM never reads register state back), device
registration, streams/timers, save-state registration, the DMG-specific
`corrupt_wave_ram()` glitch (triggering channel-3 retrigger at an exact bad
moment scrambles wave RAM on real hardware; MAME itself marks the whole
device `imperfect_features::SOUND`), and the CGB04/AGB variants are removed.

VGM's `0xB3 aa dd` command carries a flat register offset relative to GB I/O
0xFF10 (`aa` = 0x00-0x2F: NR10-NR52 with the real hardware's unused gaps at
0x05/0x0F/0x17-0x1F, then wave RAM at 0x20-0x2F), matching the official VGM
spec and this project's other flat-offset-write chips (e.g. Sega PCM's
`0xC0 aaaa dd`). Wave RAM writes are routed through the same accessibility
rule as MAME's dedicated `dmg_apu_device::wave_w` (always writable when
channel 3 is off; only during its exact sample-read cycle when on), which is
*not* gated by the APU's own power state — unlike NR10-NR52, which mirrors
MAME's `dmg_apu_device::sound_w` gate (only NR52/NR11/NR21/NR31/NR41 stay
writable while powered off).

Host reset reinitializes the chip to the documented DMG power-on state
(including the real wave RAM garbage pattern from `device_reset()`) and
clears the resampling phase.

## Output model

- Four channels, each `0xf - (signal * envelope) * 2` (wave channel has no
  envelope; its `signal` already carries the output-level shift), matching
  `convert_output` and the additive `stream.put_int(..., 15 * 4 * (1 + 7))`
  mix after per-channel panning and the NR50 master-volume multiply.
- Native tick rate equals the input clock (no divider), matching this
  project's K051649 adaptation's tick model. Square/wave/noise channels each
  keep MAME's own internal cycle divisors (4, 2, `divisor << shift`).
- Resampling integrates the held native ticks over each output sample using
  integer phase durations, the same technique as this project's other chip
  adaptations.
- Mutes act after native synthesis, before the additive mix; the frame
  sequencer, length/envelope/sweep counters and noise LFSR continue
  regardless of mute state, so unmuting resumes in phase.
- The DMG wave-RAM corruption glitch is not reproduced (MAME itself flags it
  imperfect); retriggering channel 3 leaves wave RAM untouched instead.

## Verification

`node --test web/gameboy_apu.test.mjs` checks WASM output: register writes
for all four channels (frequency/duty/envelope/sweep/length/wave RAM/noise
polynomial), the documented Hz formulas for both square channels and the
wave channel, DAC-disable silencing, the length-enable extra-clock quirk,
noise short/long mode, panning (NR51) and master volume (NR50), muting,
reset and VGM `0xB3` command parsing/dispatch.

Build: `sh scripts/build_gameboy_apu_wasm.sh`.

VGM command/header format checked against the official spec:
https://www.smspower.org/uploads/Music/vgmspec170.txt
(`0x80`: GameBoy DMG clock, LR35902, typical 4194304; `0xB3 aa dd`: GameBoy
DMG, write value dd to register aa).
