# MAME Sega PCM (315-5218) adaptation

Upstream: https://github.com/mamedev/mame/blob/f5149345d9a293d6b742b4a9bda99dc651c3e430/src/devices/sound/segapcm.cpp
Header: https://github.com/mamedev/mame/blob/f5149345d9a293d6b742b4a9bda99dc651c3e430/src/devices/sound/segapcm.h

Revision: `f5149345d9a293d6b742b4a9bda99dc651c3e430`.
Copyright holders: Hiromitsu Shioya, Olivier Galibert. License: BSD-3-Clause
(see LICENSE). Both original files are retained unmodified in `upstream/`.

Sega PCM (315-5218) is an arcade chip (OutRun, Space Harrier, System
16/18/24, ...), not a stock Mega Drive/Genesis cartridge chip. It is added
here for general VGM coverage, not as part of this project's PC-98/Genesis/
PC-88/MSX chip-gap work.

## Scope and changes

`segapcm.cpp` keeps the MAME 16-voice model: each voice reads signed 8-bit
PCM from a shared, bank-switchable ROM at a 16.8 fixed-point address, has an
independent left/right volume, a per-tick address delta (`freq`), and an
end/loop pair with coarse (top-byte only) end detection, exactly matching
`segapcm_base_device::voice_t::tick()`. The 16-channel `sega_315_5218_device`
variant's `CLOCK_DIVIDER = MaxVoices * 8 = 128` native tick rate and additive
`stream.put_int(..., 32768)` mixing are unchanged.

MAME's own device only exposes registers through its `address_map` (`map()`
in `segapcm.cpp`), built from `.select()`-based repeats across an owning
CPU's memory bus. VGM does not have a CPU or a memory bus for this chip: its
`0xC0 aaaa dd` command writes a flat 16-bit offset directly, per the VGM
spec and matching the reference player (ValleyBell/libvgm's `segapcm.c`,
which is itself derived from this same MAME device and its register-table
comment). This adaptation's `write(offset, value)` decodes that flat offset
directly (`voice = (offset >> 3) & 0xf`, `reg = offset & 7`, `offset & 0x80`
selects the static-parameter bank from the live-address/control bank),
instead of replicating MAME's CPU-facing `.select()` address map. Offsets
outside the 16 x 8-byte register window (0x00-0xFF) are silently ignored, as
untrusted VGM input rather than a real memory-mapped bus.

MAME device registration, streams, the discrete 8-voice variant, ROM banking
via `device_rom_interface`, save-state registration and the register-window
read-back handlers (VGM is write-only) are removed. Sample ROM is a plain
`std::vector<uint8_t>`, grown by `loadSampleMemory`, matching the same
resize-and-copy pattern already used by this project's other ROM/sample-fed
chips (e.g. Y8950's `y8950_load_memory` in `wasm/y8950_wasm.cpp`).

Bank shift/mask come from the VGM header's "Sega PCM interface register"
(bytes at header offsets 0x3C and 0x3E), matching how ValleyBell/libvgm's
VGM player derives `SEGAPCM_CFG.bnkshift`/`bnkmask` from that same header
field, not from MAME's own hardcoded per-game driver defaults (a generic VGM
player has no specific arcade PCB to default to). A zero mask byte falls
back to the common `0x70` mask, again matching libvgm.

Host reset reinitializes all 16 voices to the chip's own power-on defaults
(matching each `voice_t` member's default initializer in the upstream
header — notably `ctrl = 0xff`, i.e. disabled/silent until a track's own
register writes enable a voice) and clears the resampling phase. Loaded
sample ROM is not cleared by reset, matching this project's other sample-fed
chips (only a new VGM file's `clearSampleMemory()` call does that).

## Output model

- 16 independent voices, each `sample(int8) * (lvol|rvol & 0x7f)`, summed
  directly per channel (no averaging across voices), matching MAME's
  additive `stream.put_int(0, i, lout, 32768)` / `put_int(1, i, rout, 32768)`.
- Native tick rate is `clock / 128` (one tick advances all 16 voices once),
  matching `sega_315_5218_device`'s `CLOCK_DIVIDER`.
- Resampling integrates the held native ticks over each output sample using
  integer phase durations, the same technique as this project's AY8910 and
  K051649 adaptations, sized for a `clock/128` tick instead of `clock/8` or
  `clock/1`.
- Mutes act after native synthesis, before the additive mix; each voice's
  address/loop state continues to advance regardless of mute state, so
  unmuting resumes in phase.
- A second Sega PCM instance and the discrete 8-voice variant are not
  exposed by this adaptation.

## Verification

`node --test web/segapcm.test.mjs` checks WASM output, the register decode
for all seven live fields (volume, loop, end, freq, current address, ctrl),
end-of-sample looping and stop-instead-of-loop, bank shift/mask derived from
the VGM header bytes, muting, reset and VGM 0xC0/data-block-0x80 parsing.

Build: `sh scripts/build_segapcm_wasm.sh`.

VGM command/data-block/header format checked against the official spec:
https://www.smspower.org/uploads/Music/vgmspec170.txt
(`0x38`: Sega PCM clock; `0x3C`: Sega PCM interface register; `0xC0 aaaa dd`:
write value dd to memory offset aaaa; data block type `0x80`: Sega PCM ROM
data) and the reference dispatcher/config derivation:
https://github.com/ValleyBell/libvgm/blob/master/emu/cores/segapcm.c
https://github.com/ValleyBell/libvgm/blob/master/player/vgmplayer.cpp
(`_hdrBuffer[0x3C]` -> bank shift, `_hdrBuffer[0x3E]` -> bank mask)
