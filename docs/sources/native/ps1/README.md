# Standalone PlayStation SPU

A CPU-free instrument port of MAME's PlayStation SPU implementation by
pSXAuthor and R. Belmont. It retains the upstream 24-voice ADPCM decoder,
sample and loop caches, stereo voice mixing, pitch, envelope rate tables,
noise, modulation, and preset-based reverb implementation. It needs no console
BIOS, game files, CPU emulator, MAME runtime, or external dependencies.

The output is fixed at 44,100 Hz, with 512 KiB of private sample RAM per
instance. This is an experimental MAME-derived compatibility core, not a claim
of hardware-exact timing or sound. The adaptation uses PS1 four-point Gaussian voice interpolation, while
floating-point envelope approximations and reverb presets remain.

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

- Voice interpolation now uses the 512 PS1 hardware coefficient values documented
  by [PSX-SPX / no$psx](https://psx-spx.consoledev.net/soundprocessingunitspu/#4-point-gaussian-interpolation).
  These are numeric hardware data, transcribed independently of emulator code;
  the new implementation is part of this BSD-3-Clause adaptation. Pristine
  MAME sources under `upstream/` are unchanged. The default replaces linear
  interpolation; there is no compatibility mode or additional API switch.
  Phase bits 4..11 select four separately arithmetic-shifted products of the
  current and preceding three decoded samples, before envelope and mixing.
  History starts at zero on KON/reset, survives packet/loop/cache boundaries,
  and consumes skipped samples at high pitch. Noise bypasses interpolation;
  pitch modulation receives post-envelope Gaussian output. Coefficients retain
  the hardware's roughly 0.996 DC gain rather than being renormalized.


- Opt-in instrument controls added in 0.1.7: `ps1_spu_refresh_envelope` rereads
  ADSR rates while preserving the current envelope level and sample position;
  `ps1_spu_audition_key` uses 128-frame per-voice ramps for manual key transitions
  and floors only very fast manual releases. Slow and infinite release settings
  are retained. Manual Off and raw KOFF both use the ADSR rates last latched by
  KON or explicit refresh; neither applies deferred ADSR register writes. The
  cached release rate remains separate from the effective 128-frame manual
  floor, so removing that floor does not require rereading authored registers.
  Repeated Off calls also preserve deferred edits. These extensions do not change
  raw register KON/KOFF or the original key-on-latched ADSR path. They are sound-design aids, not emulated
  hardware registers. Calling raw KON/KOFF resets any pending audition ramp.
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
  Interpolation at zero pitch holds the current sample and three-sample history
  without reading beyond its decoded cache.
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

## Optional software mixer headroom

`ps1_spu_set_mix_headroom(handle, divisor)` opts into a wide voice accumulator
with retained fractional dry output. Default divisor 1 is the original path.
Divisors 2–32 scale after accumulation rather than reducing voice registers;
a host can compensate afterward without magnifying extra volume-rounding noise.
This is a software instrument extension, not a hardware register. Configure it
before rendering; changing it discards queued output. Reset retains the setting.
The existing integer reverb algorithm and its quantization remain.

Optional software sample bank: `ps1_spu_set_host_pcm` copies signed mono PCM outside physical SPU RAM (up to 30 minutes at 44.1 kHz). `ps1_spu_set_host_mask` selects voices at key-on. Gaussian interpolation, PMON, ADSR, mixing and reverb still run in the SPU core. Reset preserves the bank; zero frames clears it. Default register/RAM playback is unchanged. The browser host labels this Software audio; it is not additional PS1 hardware RAM.
