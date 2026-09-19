# MAME K051649 (Konami SCC) adaptation

Upstream: https://github.com/mamedev/mame/blob/20d4667cdf485066a113f1ef24bae0887cd7134c/src/devices/sound/k051649.cpp
Header: https://github.com/mamedev/mame/blob/20d4667cdf485066a113f1ef24bae0887cd7134c/src/devices/sound/k051649.h

Revision: `20d4667cdf485066a113f1ef24bae0887cd7134c`.
Copyright holder: Bryan McPhail. License: BSD-3-Clause (see LICENSE).
Both original files are retained unmodified in `upstream/`.

## Scope and changes

`k051649.cpp` keeps the MAME 5-channel wavetable model: each channel holds a
32-byte signed waveform, a 12-bit frequency divider gating a 5-bit wavetable
counter, and a 4-bit volume. `sound_stream_update`'s per-sample loop becomes
`tick()`, called once per native clock cycle (the MAME device's stream runs at
`clock()`, i.e. one tick per input clock, unlike AY8910's clock/8 tick).
Channel halting below frequency 9, the shared ch4/ch5 waveram in plain SCC
mode, and the `sample >> 4` / 1024 output scale are unchanged from MAME.

MAME device registration, the address-space `scc_map`, save-state
registration and the 052539/SCC+ read-back "expose the internal counter via
the test register" behavior are removed (this is a write-only VGM sink; VGM
never reads chip state back). `k052539_waveform_w` (independent 5-channel
waveform, no ch4/ch5 sharing) is kept as the SCC+ path.

Register writes are grouped by VGM's own command shape rather than MAME's
unified `scc_map` address decode: `write(port, reg, value)` takes `port`
0-5 to select the write entry point (0=SCC waveform, 1=frequency, 2=volume,
3=key on/off, 4=SCC+/052539 waveform, 5=test) and `reg` as that entry point's
own MAME `offset` argument. This matches how the reference VGM player
(vgmplay-legacy's `ChipMapper.c`, case `0x19`) dispatches command 0xD2, not
MAME's own single 0x00-0xFF `scc_map`. Channel indices decoded from `reg` are
bounds-checked (0-4) before touching the channel array, since a malformed VGM
file's `reg` byte is untrusted input, unlike MAME's memory-mapped address bus.

Host reset additionally clears the resampling phase and waveram (MAME's
device_reset leaves waveram alone; VGM has no separate "load waveform" step
before playback, so a clean reset zeroes it) for deterministic VGM replay.
Second-chip instances are not exposed by this adaptation.

## Output model

- Five independent channels, each `(waveram[counter] * volume) >> 4`,
  summed directly (no averaging across channels), matching MAME's
  `stream.add_int(0, i, voice.sample >> 4, 1024)` additive mixer.
- Native tick rate equals the input clock (no MAME-style clock divider).
- Resampling integrates the held native ticks over each output sample using
  integer phase durations, the same technique as this repo's AY8910 adaptation
  (`third_party/mame-ay8910`), sized for a clock-rate tick instead of clock/8.
- Mutes act after native synthesis, before the additive mix; counters continue
  regardless of mute state, so unmuting resumes in phase.
- The native range is bounded by the chosen scale (5 channels x ~0.12 peak
  each); no additional headroom division or clipping is applied here.

## Verification

`node --test web/k051649.test.mjs` checks WASM output, the port/reg dispatch
for all six register groups (including the plain-SCC ch4/ch5 waveform share
and the SCC+ independent-waveform path), channel muting, reset and VGM 0xD2
parsing/seeking.

Build: `sh scripts/build_k051649_wasm.sh`.

VGM command format was checked against the official spec:
https://www.smspower.org/uploads/Music/vgmspec170.txt
(`0x9C`: K051649 clock; `0xD2 pp aa dd`: SCC1 port pp, write value dd to
register aa) and the reference dispatcher in vgmplay-legacy, which resolves
`port`/`reg` onto the same six MAME entry points named above:
https://github.com/vgmrips/vgmplay-legacy/blob/master/VGMPlay/ChipMapper.c
(case `0x19`) and
https://github.com/vgmrips/vgmplay-legacy/blob/master/VGMPlay/chips/k051649.c
