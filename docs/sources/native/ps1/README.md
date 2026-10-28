# Standalone PlayStation SPU

A CPU-free instrument port of MAME's PlayStation SPU implementation by
pSXAuthor and R. Belmont. It retains the upstream 24-voice ADPCM decoder,
sample and loop caches, stereo voice mixing, pitch, envelope rate tables,
noise, modulation, and preset-based reverb implementation. It needs no console
BIOS, game files, CPU emulator, MAME runtime, or external dependencies.

The output is fixed at 44,100 Hz, with 512 KiB of private sample RAM per
instance. This is an experimental MAME-derived compatibility core, not a claim
of hardware-exact timing or sound. In particular, upstream uses linear sample
interpolation, floating-point envelope approximations, and reverb presets.

## Source and license

Upstream: [MAME](https://github.com/mamedev/mame), pinned revision
[`a64a5d6602b19f67e091a4491f0c851a9dacf79d`](https://github.com/mamedev/mame/tree/a64a5d6602b19f67e091a4491f0c851a9dacf79d).
The following files from `src/devices/sound/` have BSD-3-Clause license
annotations naming pSXAuthor and R. Belmont:

- `spu.cpp`, `spu.h`: voices, sample cache, ADPCM decoding, register interface.
- `spu_tables.cpp`: original envelope rates and reverb preset tables.
- `spureverb.cpp`, `spureverb.h`: original preset-based reverb.

Pristine source copies are retained in [upstream/](upstream/); their exact
SHA-256 hashes are in [upstream/SHA256SUMS](upstream/SHA256SUMS). Files in the
parent directory are the adapted build inputs. Original license and author
annotations remain in every adapted source file. [LICENSE](LICENSE) contains
the BSD-3-Clause terms for the upstream code and the standalone adaptation.
Other MAME devices and the MAME framework are not included or linked.

## Build and C interface

Compile these four translation units as C++17:

```text
ps1_spu.cpp
spu.cpp
spu_tables.cpp
spureverb.cpp
```

Include [ps1_spu.h](ps1_spu.h) for the C-compatible entry points. The same core
can be compiled natively or with Emscripten. No third-party headers are needed.
All state belongs to the handle; do not access one handle concurrently.

Register addresses are even **byte offsets** from `0x1f801c00`, in the range
`0..0x3fe`. Start/repeat address register values count eight-byte units, but
ADPCM packets are 16 bytes: use even register values. Pitch `0x1000` advances
at the original sample rate. Upload actual PSX ADPCM packets, including their
END/REPEAT/LOOP flags, through `ps1_spu_load_ram`; RAM upload does not encode PCM.
A packet contains a predictor/shift byte, flags byte, and fourteen low-nibble-
first data bytes, yielding 28 PCM frames.

The first `0x1000` bytes of RAM are upstream capture buffers overwritten during
rendering. Place instrument samples at or above `0x1000`. Raw packets have no
root-note or sample-rate metadata; callers must supply tuning separately.

`ps1_spu_reset(handle, 0)` resets voices/registers/effects while retaining sample
RAM. Passing `1` additionally clears RAM. Default RAM control is `0x0004`, the
standard 512 KiB layout. Master/voice gains and SPUCNT output enable/mute must
be configured before audible playback. Render returns normalized stereo float
PCM, accepts at most 1,048,576 frames, and requires nonoverlapping outputs.
Rendering zero frames is a no-op; null output pointers are allowed only then.
Each call internally drains the upstream ring in chunks of at most 2,048 frames.

## Adaptation details and limitations

- Replaced MAME device registration, save-state, stream scheduling, host CPU,
  DMA wiring, IRQ callbacks, and timers with pull-based rendering and the C API.
  The public interface is for instruments; CPU DMA and external XA/CD audio
  streaming are not provided. Their retained upstream helpers are not exposed.
- RAM control accepts only the standard mode (`value & 0x0e == 0x04`). Other
  modes and volume-sweep register values (`bit 15`) are rejected before mutation.
  Odd start/repeat addresses and invalid register/RAM/output ranges are rejected.
- Extended current-volume register reads use the full `0x400`-byte register bank,
  correcting the upstream `0x1ff` address mask aliasing the upper half.
- Reset initializes every register, FIFO/capture counter, active voice, output
  queue, and reverb state deterministically. Reverb configuration and frequency
  multiplier are instance-local; debug-only shared cache accounting was removed.
- Original sample/loop history behavior is retained. A cache owner now survives
  loop-target rebuilding and interpolation, fixing an upstream cache lifetime
  issue exposed by overlapping samples and RAM replacement. RAM upload invalidates
  decoded caches before voices resume.
- Effective pitch ignores the register's upper two bits and modulation is capped
  at `0x3fff`, avoiding cache overshoot for out-of-range raw register values.
  Voice zero ignores its modulation bit because it has no preceding voice.
  Interpolation at zero pitch safely stitches a final packet sample instead of
  reading beyond its decoded cache.
  Packet reads wrap at the end of RAM, including cache-refresh lookahead.
- Invalid ADPCM predictor nibbles `5..15` use predictor zero to avoid reading
  outside the five-entry table. This is a safe malformed-data fallback, not a
  statement about how real hardware interprets invalid packet headers.
- The adapter enforces SPUCNT enable/unmute (`bits 15 and 14`) at output, while
  still advancing voice state. This output gate was absent from upstream mixing.
- Envelope register rates follow the pinned upstream implementation: table index
  zero is fastest; higher indexes are slower or stop. `ADSR1=0x000f` and
  `ADSR2=0x0000` give its simple fast-attack, full-sustain, fast-release preset.
  These approximations are not a promise that arbitrary hardware ADSR register
  values have cycle-accurate PS1 behavior. Changing ADSR registers takes effect
  at the next key-on; pitch and fixed volume changes update active voices.
- Reverb is off by default. Its original preset approximation and noise/modulation
  paths are retained for later compatibility work; this milestone targets
  self-authored ADPCM instrument playback. No game soundtrack compatibility is
  claimed.

Binary redistributions must retain the BSD license and attribution with their
other third-party notices.
