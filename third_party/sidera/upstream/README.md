# sidera

**MOS Technology 6581/8580 (SID) emulator for Rust — `no_std`, integer-only, cycle-accurate**

`sidera` is a Rust library that reproduces the *sound* of the Commodore 64's SID chip — not bit-exactly, but acoustically. It is designed to run on embedded targets, real-time audio threads, and any context where heap allocation and floating-point are unavailable or undesirable.

The engine runs **cycle-accurately** at the chip clock (~985 kHz PAL) and decimates to the output rate, the way the real chip does. This is what makes hard sync, ring modulation, pulse-width and noise spectrally correct. The acoustically-important analogue behaviour of the 6581/8580 — combined-waveform AND-with-bleed, the analogue DC offsets, the non-linear filter cutoff, the C64 output RC network, and the 6-segment exponential envelope — is modelled per [`SID_ANALOG_SPEC.md`](SID_ANALOG_SPEC.md).

Fidelity is verified against [reSID](https://en.wikipedia.org/wiki/ReSID) 0.16 (Dag Lem), used purely as an external **black-box oracle** — its rendered audio output only, never its source or data tables (spectral-similarity A/B). Typical results vs the oracle: **spectral cosine ≈ 0.997–1.000** for pure waveforms, hard sync, the resonant filter and the envelope; combined waveforms ≈ 0.94–0.97 (8580) and ≈ 0.64–0.86 (6581, the hard case; pulse+saw+tri ~0.37 — see *Limitations*).

## Motivation

The usual way to get SID sound in Rust is [`resid-rs`](https://crates.io/crates/resid-rs), a direct port of reSID. It works, but it has been **effectively unmaintained for years**, and — being a line-by-line port — it inherits reSID's **GPL** licence and is neither `no_std` nor allocation-/float-free.

`sidera` exists because I hit a concrete bug in that path: an arithmetic-overflow panic in the envelope generator (`attempt to subtract with overflow`) that crashes on certain sound effects — reported as [binaryfields/resid-rs#13](https://github.com/binaryfields/resid-rs/issues/13) back in 2022. The issue is still open and untouched years later, with no fix merged. Rather than keep waiting on a patch that never landed in a dormant project, I decided it was more productive to write a fresh emulator. So `sidera` is a clean, independent reimplementation rather than a port: **MIT-licensed**, `no_std`, integer-only, and maintained — with reSID kept strictly as a black-box verification oracle (see below), not as a code base to copy.

## Properties

| Property            | Value                                         |
|---------------------|-----------------------------------------------|
| `no_std`            | ✅                                             |
| Heap allocation     | ❌ none                                        |
| Floating-point      | ❌ none                                        |
| Internal clock      | Cycle-accurate (chip rate), Bresenham decimation |
| Phase accumulator   | 24-bit                                        |
| Voices              | 3                                             |
| Chip models         | 6581 (default) / 8580 — `Sid::set_model`      |
| Noise LFSR          | 23-bit, clocked by accumulator bit 19 (real edge) |
| Oscillator sync     | ✅ (cycle-accurate)                            |
| Ring modulation     | ✅ (cycle-accurate)                            |
| Combined waveforms  | AND-with-bleed model (per chip model)         |
| ADSR                | 8-bit, rate table + 6-segment exp divider, ADSR delay bug |
| Filter              | Two-integrator SVF, non-linear cutoff curve   |
| Analogue model      | wave/voice/mixer DC offsets + C64 output RC filter |

## Two interfaces

`sidera` exposes two layers that can be used independently or together.

### High-level interface (`sidera::high`)

Human-friendly functions: frequencies in Hz or MIDI notes, envelope times in milliseconds, sustain and resonance as percentages. No state is held in this module — every function takes a `&mut Sid` and writes the appropriate registers immediately.

```rust
use sidera::Sid;
use sidera::high::{self, ChipClock, FilterMode, Waveform};

let mut sid = Sid::new(44100);

// Voice 0: sawtooth, A4, fast attack, long release
high::set_frequency_midi(&mut sid, 0, 69, ChipClock::Pal); // A4 = 440 Hz
high::set_envelope(&mut sid, 0, 10, 200, 70, 800);         // A=10ms D=200ms S=70% R=800ms
high::set_waveform(&mut sid, 0, Waveform::Saw, false, false);

// Low-pass filter at 1 200 Hz, 60 % resonance, routed to voice 0
high::set_filter(&mut sid, 1200, 60, FilterMode::LowPass, 0b001);

// Master volume
high::set_volume(&mut sid, 15);

// Trigger note
high::note_on(&mut sid, 0, Waveform::Saw);

// Audio loop @ 44 100 Hz
loop {
    let sample: i16 = sid.clock();
    // → audio buffer / DAC
}

// Release
high::note_off(&mut sid, 0, Waveform::Saw);
```

#### High-level API reference

| Function | Parameters | Description |
|---|---|---|
| `set_frequency_hz` | `voice, hz: u32, clock: ChipClock` | Frequency in Hz |
| `set_frequency_midi` | `voice, note: u8, clock: ChipClock` | MIDI note 0-127, table lookup |
| `set_waveform` | `voice, Waveform, sync: bool, ring: bool` | Waveform + sync/ring flags |
| `set_pulse_width_pct` | `voice, percent: u8` | Pulse width 0-100 % |
| `set_envelope` | `voice, attack_ms, decay_ms, sustain_pct, release_ms` | Full ADSR |
| `note_on` | `voice, Waveform` | Open gate → Attack |
| `note_off` | `voice, Waveform` | Close gate → Release |
| `set_filter` | `cutoff_hz, resonance_pct, FilterMode, voice_mask` | Global filter |
| `set_volume` | `volume: u8` | Master volume 0-15 |
| `set_voice3_off` | `off: bool` | Mute voice 3 from mix (modulation source) |

**`ChipClock`**: `Pal` (985 248 Hz) or `Ntsc` (1 022 727 Hz).

**`Waveform`**: `Saw`, `Triangle`, `Pulse`, `Noise`.

**`FilterMode`**: `Off`, `LowPass`, `BandPass`, `HighPass`, `BandReject`.

ADSR times are quantised to the nearest of the 16 steps the SID supports. Attack steps (ms): 2, 8, 16, 24, 38, 56, 68, 80, 100, 250, 500, 800, 1 000, 3 000, 5 000, 8 000. Decay/Release steps (ms): 6, 24, 48, 72, 114, 168, 204, 240, 300, 750, 1 500, 2 400, 3 000, 9 000, 15 000, 24 000.

MIDI notes above 107 (PAL) or 108 (NTSC) exceed the SID's 16-bit frequency register range and are clamped to 65 535.

> **CONTROL register caveat**: `note_on` / `note_off` cannot preserve sync or ring bits
> set by a previous `set_waveform` call, because the CONTROL register is write-only on
> the real chip and `sidera` does not shadow it. Use `Sid::write_register` directly when
> those flags must survive gate transitions.

---

### Low-level interface (`sidera::registers` + `Sid::write_register`)

Direct register writes give full control over every SID feature, including combined waveforms, the oscillator test bit, and fine-grained filter routing.

```rust
use sidera::Sid;
use sidera::registers::*;

let mut sid = Sid::new(44100);

// A4 ≈ 440 Hz, PAL: freq_reg = (440 × 16_777_216) / 985_248 ≈ 7493
sid.write_register(V1_FREQ_LO, 0x45);
sid.write_register(V1_FREQ_HI, 0x1D);

// Attack=2ms, Decay=48ms, Sustain=max, Release=300ms
sid.write_register(V1_ATTACK_DECAY,    0x02);
sid.write_register(V1_SUSTAIN_RELEASE, 0xF8);

// Sawtooth, gate on
sid.write_register(V1_CONTROL, CTRL_SAW | CTRL_GATE);

// Volume 15
sid.write_register(MODE_VOL, 0x0F);

loop {
    let sample: i16 = sid.clock();
}
```

#### Frequency formula

```
freq_reg = (note_hz × 16_777_216) / clock_hz
```

| Model    | Clock Hz  |
|----------|-----------|
| C64 PAL  | 985 248   |
| C64 NTSC | 1 022 727 |

#### Register map

| Address        | Name                 | Description                              |
|----------------|----------------------|------------------------------------------|
| `$00`          | `V1_FREQ_LO`         | Voice 1 frequency, low byte              |
| `$01`          | `V1_FREQ_HI`         | Voice 1 frequency, high byte             |
| `$02`          | `V1_PULSE_LO`        | Voice 1 pulse width, low byte            |
| `$03`          | `V1_PULSE_HI`        | Voice 1 pulse width, bits 3..0           |
| `$04`          | `V1_CONTROL`         | Voice 1 control                          |
| `$05`          | `V1_ATTACK_DECAY`    | Attack (7..4) / Decay (3..0)             |
| `$06`          | `V1_SUSTAIN_RELEASE` | Sustain (7..4) / Release (3..0)          |
| `$07`–`$0D`    | Voice 2              | Same layout                              |
| `$0E`–`$14`    | Voice 3              | Same layout                              |
| `$15`          | `FC_LO`              | Filter cutoff bits 2..0                  |
| `$16`          | `FC_HI`              | Filter cutoff bits 10..3                 |
| `$17`          | `RES_FILT`           | Resonance (7..4) / voice routing (3..0)  |
| `$18`          | `MODE_VOL`           | Voice-3-off (7) / filter mode (6..4) / volume (3..0) |
| `$1B`          | `OSC3`               | Voice 3 phase, high byte (read-only)     |
| `$1C`          | `ENV3`               | Voice 3 envelope level (read-only)       |

#### CONTROL register bits

| Bit | Constant     | Function                       |
|-----|--------------|--------------------------------|
| 0   | `CTRL_GATE`  | ADSR gate                      |
| 1   | `CTRL_SYNC`  | Oscillator sync                |
| 2   | `CTRL_RING`  | Ring modulation                |
| 3   | `CTRL_TEST`  | Freeze oscillator / reset LFSR |
| 4   | `CTRL_TRI`   | Triangle waveform              |
| 5   | `CTRL_SAW`   | Sawtooth waveform              |
| 6   | `CTRL_PULSE` | Pulse waveform                 |
| 7   | `CTRL_NOISE` | Noise waveform                 |

---

## Architecture

`Sid::clock()` advances the engine by `chip_clock / sample_rate` chip cycles
(exact fractional carry) and returns one band-limited sample. Each chip cycle:

```
per chip cycle (≈985 kHz PAL):
  ├─ envelopes.clock()        15-bit rate counter + 6-segment exp divider (8-bit)
  ├─ oscillators.clock()      acc += freq (24-bit); msb edge; noise on bit-19 edge
  ├─ hard sync                reset slave accumulators on master MSB edge
  ├─ voice.output            (wave12 − wave_zero)·env8 + voice_DC   [analogue DC]
  │    ├─ saw   = acc >> 12
  │    ├─ tri   = fold(acc) [± ring mod]
  │    ├─ pulse = acc>>12 ≥ pw
  │    ├─ noise = 23-bit LFSR taps
  │    └─ combined = AND-with-bleed (per chip model)
  ├─ filter.clock(v1,v2,v3)   2-integrator SVF, non-linear cutoff, routing, mixer DC
  └─ extfilt.clock()          C64 output RC: LP 16 kHz then HP 16 Hz

per output sample:
  └─ extfilt.output() / OUT_DIV  →  clamp  →  i16
```

The C64 output RC network (modelled in `extfilt.rs`) provides the anti-alias
low-pass, so plain point-decimation is acoustically faithful.

### Noise LFSR

Clocked by the real rising edge of accumulator bit 19 (cycle-accurate — no
fractional-counter approximation). The 12-bit output uses the SID's fixed,
non-contiguous taps. Seed `0x7FFFF8`, reseeded when the TEST bit is cleared.

### ADSR

8-bit envelope, clocked at chip rate. A 15-bit rate counter selects the step
period from the published rate table; decay/release pass through a 6-segment
exponential divider (periods 1, 2, 4, 8, 16, 30 at levels 255, 93, 54, 26, 14,
6). Attack is linear. The **ADSR delay bug** (rate counter never reset on
register writes) is reproduced — some C64 tunes depend on it.

---

## Limitations

- **Combined waveforms** use an algorithmic model — the bit-coupling shape rule
  (erosion for the 6581's hard droop, a majority filter for the 8580's softer
  coupling), the per-chip structure, and the droop amplitude — with no lookup
  tables of any kind. The droop targets were obtained by *black-box measurement*
  of the reSID 0.16 oracle's OSC3 output (facts about the chip's behaviour, not
  reSID's code or `.dat` tables; see [`SID_ANALOG_SPEC.md`](SID_ANALOG_SPEC.md) §3.3,
  locked by the `golden_osc3_tables` test). The 8580 combinations match the oracle
  very well (spectral cos ≈ 0.94–0.97); the 6581 combinations (heavily drooped,
  quiet, chip-dependent on hardware) match more loosely (≈ 0.64–0.86 by combo;
  pulse+saw+tri is near-noise on hardware so its *shape* match plateaus ~0.37,
  though its level is correct). **Exact** combined timbres would require measured
  per-chip lookup tables, which `sidera` deliberately does not carry — a user
  may drop in their own measurements.
- **Filter cutoff curve** uses documented breakpoints (6581 tanh-shaped with the
  0x80 discontinuity; 8580 near-linear) rather than a measured per-chip spline.
- **No per-chip variation**: real 6581s vary noticeably unit-to-unit; `sidera`
  models one representative curve per revision.

## Fidelity oracle

The `examples/render` binary renders a register script to PCM, for spectral A/B
comparison against reSID 0.16 (the methodology used to calibrate the analogue
models). reSID is GPL and is used **only as an external, black-box oracle** — its
rendered output is compared against `sidera`'s; no reSID code or data table is read,
copied, or linked into this crate.

## License

MIT
