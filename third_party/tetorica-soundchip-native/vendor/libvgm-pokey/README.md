# Atari POKEY audio core

This is a standalone C++14 audio adaptation of the BSD-3-Clause POKEY 4.9
implementation in libvgm. It provides four channels per independently owned
`Pokey` instance, including polynomial noise, joined counters, high-clock
modes, audio high-pass interactions, volume-only output and two-tone audio
behavior. No ROM, music data, MAME runtime or libvgm runtime is required.

## Sources and license

- Unmodified source: [upstream/pokey.c](upstream/pokey.c).
- Repository: <https://github.com/ValleyBell/libvgm>.
- Fixed repository commit: `61b62d64455e039de2a1d01498afa9e9b5f1cb88`.
- Original path: [`emu/cores/pokey.c`](https://github.com/ValleyBell/libvgm/blob/61b62d64455e039de2a1d01498afa9e9b5f1cb88/emu/cores/pokey.c).
- Original file SHA-256: `f90898d3f8b774f7e7ffefafa47f61ffeea893599582f32bed08c83542757ef9`.
- Original copyright holders: Brad Oliver, Eric Smith, Juergen Buchmueller.
- Standalone adaptation: kyorohiro, 2026.
- License: [BSD-3-Clause](LICENSE), expressly declared by the source file.

The original credits Ron Fries' POKEY emulator information, Atari's hardware
manual, Perry McFarlane's polynomial information, Mike Saarna's A7800 MAME
work, and Altirra-related polynomial corrections. Those attribution comments
are retained in both the upstream snapshot and adapted source. This is an
adaptation of that implementation, not a newly authored POKEY algorithm.

libvgm's `pokey.h`, `EmuStructs.h`, `EmuHelper.h`, `stdtype.h`, `SoundDevs.h`,
`EmuCores.h`, `snddef.h` and `emutypes.h` are **not** included or linked.
The source file's BSD declaration is not assumed to license those separate
framework files. This directory supplies its own small C++ API and integer
type aliases, with no libvgm device registration or dependency definitions.

## Standalone API

```cpp
#include "pokey.h"

Pokey first(1789790, 44100);
Pokey second(1789790, 44100);  // Separate counters, polynomials and phase.
first.writeRegister(0x0f, 0x03);  // SKCTL: enable normal chip clocks.
first.writeRegister(0x00, 72);    // AUDF1.
first.writeRegister(0x01, 0xaf);  // AUDC1: pure tone, volume 15.
first.writeRegister(0x09, 0);    // STIMER.
first.generate(left, right, frames);
```

Constructor order is whole-Hz `clock`, then host `sampleRate`. Accepted clocks
are `1..100000000`; accepted sample rates are `8000..384000`.
`validConfiguration()` exposes the same bounds. An invalid direct C++
constructor configuration falls back to `1789790 / 44100`; a surrounding
validated API should reject it before construction. The upper clock bound
is an arithmetic bound, not a claim that rendering at 100 MHz is inexpensive.

The class is noncopyable and nonmovable. All mutable state and polynomial
tables belong to its heap-allocated instance. It is not internally locked;
use one rendering thread per instance or synchronize access externally.
`reset()` restores deterministic libvgm power-on defaults, clears monitor
mutes and the resampling remainder, and does not allocate. The upstream
reset initializes SKCTL to `3` for compatibility with logs that omit it.

Register addresses are local `0x00..0x0f`. Invalid writes are ignored and
invalid reads return `0xff`; addresses are not silently folded modulo 16.
`readRegister()` returns the **read-side hardware/status register**, not a
write-side register shadow: reading `0x0a`, for example, reads RANDOM.
Reads are non-timing peeks and do not advance clocks or alter state. RANDOM
therefore advances with `generate()` and remains fixed while SKCTL holds
the polynomial generator in reset.

`mute(channel, bool)` accepts zero-based channels `0..3`; invalid channels
are ignored. It masks only the output sum. Dividers, joined counters,
polynomials, audio filtering and RANDOM continue unchanged. The mask applies
to the next output sample even if that sample starts part-way through a
native tick or the channel is holding volume-only output. This fixes the
upstream monitor-mute cache behavior without modifying chip phase.

## Output and resampling

`generate(left, right, frames)` writes planar floats, with the same mono
signal in both buffers. Both pointers must be non-null for a non-empty
block; a null pointer leaves the chip and the other buffer unchanged.
The buffers may refer to the same mono destination. Rendering allocates no
memory, and zero frames do not advance the chip.

The output preserves the upstream **legacy linear** calculation: add the
four active 4-bit channel volumes, multiply by the integer gain
`32767 / 11 / 4 = 744`, clamp that native-tick sum to `32767`, then divide
by `32768` for floating-point output. This intentionally retains upstream
clipping and unipolar DC. It does not add normalization, centering, an
output filter, board amplification or a Mixer default.

Every native clock interval is integrated into each host frame using integer
rational overlaps: one native tick spans `sampleRate` units, and one host
frame spans `clock` units. A persistent remainder handles fractional ticks
and arbitrary block sizes without clock rounding or dropped ticks. The
64-bit weighted sum is divided once per host frame. The first native state
is advanced before its output interval, matching the upstream per-tick
update order. A register write can update combinational volume/control
output at the write boundary without advancing native time or clearing the
remainder. This box integration reduces clock-rate aliasing; it is not a
band-limited resampler or an analog POKEY output circuit.

## Differences and I/O boundaries

- The libvgm device tables, configuration structures, allocator entry
  points, common headers and framework macros were replaced with original
  standalone glue and standard C++ integer types.
- The original channel counter, borrow, noise polynomial, joined-channel,
  audio high-pass and two-tone algorithms are retained. The raw-output
  recomputation was factored into a helper so writes need not advance time.
- Monitor mute was moved outside the emulated chip into the final output
  mix. Upstream's mute mask could leave cached volume-only output stale.
- Unexposed analog output modes and their resistor/voltage lookup table
  were removed. Only the legacy linear output is available.
- No CPU scheduler, interrupt output callback, external serial pins,
  keyboard matrix or paddle input callbacks are provided. Read-side
  status follows the retained audio port's deterministic stub behavior;
  it does not constitute a full POKEY I/O-device emulator. In particular,
  unconnected paddles retain the upstream maximum value of 228, and external
  serial/keyboard events cannot be supplied.
- The upstream STIMER limitation remains: channel-counter reset is
  immediate rather than delayed by the documented four chip clocks.

## Two POKEYs and Atari arcade Tetris

Create two `Pokey` objects and mix their output externally. Resetting,
muting or writing one object cannot affect the other. Two chips provide
eight channels; they do not inherently imply stereo output.

The [official MAME Atari Tetris driver](https://github.com/mamedev/mame/blob/39eb9e44c394df9aec8186f2d2ef7517ace232e1/src/mame/atari/atetris.cpp)
creates two POKEYs, each clocked from `MASTER_CLOCK / 8` with the master
constant `14,318,181`, and routes both to one mono speaker at gain `0.50`.
This API accepts integer Hz, so callers representing that divider must
choose and document a whole-Hz approximation; the fractional value is
`1,789,772.625 Hz` (nearest whole Hz: `1,789,773`). The general default
`1,789,790 Hz` follows the upstream Atari 800 reference, not the Tetris
board clock. No Tetris board filter, amplifier, CPU, ROM or game behavior
is emulated here.
