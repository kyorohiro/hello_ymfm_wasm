# SID 6581/8580 — Abstract behavioural specification

> **Purpose.** This document specifies the *acoustically relevant* behaviour of the
> MOS 6581/8580 (SID) sound chip, so that `sidera` can reproduce the chip's sound
> faithfully (not bit-exactly, but acoustically equivalent).
>
> **Provenance / licence.** This is a *behavioural* description of the hardware,
> written from the published understanding of the chip (Yannes' circuit, the SID
> Programmer's Reference Guide, and community reverse-engineering documentation).
> Acoustic fidelity is calibrated and checked by **black-box A/B comparison** of
> rendered audio against **reSID 0.16** (Dag Lem) — its *rendered output only*
> (PCM and the OSC3 register sweep), never its source or `.dat` tables. reSID is
> GPL; it is used solely as an external verification oracle and is never linked
> into the MIT crate.
>
> **What this does and does not claim.** We do **not** claim never having seen
> reSID — it is the canonical SID reverse-engineering reference, and some short
> scalar facts used here (the ADSR rate/exponential periods, the noise-LFSR taps,
> the analogue DC-offset codes, the combined-waveform droop targets) entered common
> knowledge through it. The claim is narrower and is what actually matters for
> copyright: **no reSID source code and no reSID data table (`.dat`) is copied,
> transcribed, or linked into this crate.** Copyright protects *expression* (code,
> the specific arrangement of a table), not *facts* about a physical chip or its
> *observable behaviour*. What is reused here is only such unprotectable facts plus
> black-box measurements of the oracle's output. Where a bit-exact emulator would
> ship *measured* data (combined-waveform OSC3 samples, filter cutoff spline
> points), this spec instead prescribes an algorithmically generated model, so the
> MIT crate carries no externally-derived data table.

---

## 0. Why the previous `sidera` sounded wrong

The root cause is architectural, not a tuning issue:

1. **Wrong clock domain.** `sidera` advanced its phase accumulator **once per audio
   sample** (44.1 kHz) with a pre-scaled increment. The real chip advances the
   accumulator **once per chip cycle** (~985 kHz PAL) and the analogue output is
   *then* band-limited and resampled. Running at sample rate aliases everything
   that depends on sub-sample timing: **hard sync**, **ring modulation**, **pulse
   width** edges, and the **noise** spectrum. No amount of post-hoc tuning fixes
   this; the engine must clock at chip rate and decimate.

2. **Combined waveforms OR'ed.** Real combined waveforms behave like a *wired-AND
   with analogue bleed*, not an OR. OR makes saw+triangle and pulse+saw far too
   bright/buzzy.

3. **No analogue DC structure.** The 6581 has three DC offsets (waveform-DAC zero,
   envelope-DAC offset, mixer offset) and an output RC network. These produce the
   characteristic **asymmetry**, the **"digi" clicks** on volume writes, and the
   overall tonal balance. `sidera` had none of this and instead applied an
   *invented* `soft_clip()` saturation that the chip does not have.

4. **Linear filter cutoff.** The 6581 cutoff map is strongly non-linear
   (tanh-shaped with a discontinuity); a linear map gives the wrong "sweep" feel.

5. **Coarse envelope curve.** The decay/release exponential is a **6-segment**
   piecewise-linear curve clocked by an internal divider, not a 3-segment one.

This spec addresses all five.

---

## 1. Clock domain & top-level signal chain

```
                          per chip cycle (PAL 985248 Hz, NTSC 1022727 Hz)
  ┌────────────────────────────────────────────────────────────────────┐
  │  for each of 3 voices:                                              │
  │    oscillator.clock()      accumulator += freq        (24-bit)      │
  │    (after all 3)           synchronize()              hard sync     │
  │    envelope.clock()        ADSR rate/exp counters                   │
  │  voice.output = (wave12(acc) − wave_zero) · env8 + voice_DC         │
  │  filter.clock(v1,v2,v3,ext)   two-integrator SVF, non-linear w0     │
  │  Vf = (Σ unfiltered + Σ filtered + mixer_DC) · volume               │
  │  extfilt.clock(Vf)            RC: LP 16 kHz then HP 16 Hz           │
  └────────────────────────────────────────────────────────────────────┘
                          │  decimate to audio rate
                          ▼
                    i16 audio sample
```

Everything above the decimation line runs at **chip rate**. The decimation stage
turns the ~1 MHz internal stream into the requested output rate (e.g. 44.1 kHz).

### 1.1 Decimation

SID resamplers commonly offer point-sampling, linear interpolation, or a windowed-sinc
resampler. For `sidera` the recommended, `no_std`/integer-friendly choice is:

- **Accumulate-and-emit point sampling** driven by a fixed-point ratio
  `cycles_per_sample = chip_clock / sample_rate` (Q16). Each `Sid::clock()` call runs
  the engine forward by `floor` or `ceil` of that many chip cycles (Bresenham-style
  fractional carry so the long-term average is exact), and returns the last internal
  sample. The **external RC filter (§6) provides the anti-alias low pass**, exactly as
  on real hardware (the C64's 16 kHz output pole), so plain point sampling is acoustically
  acceptable. A short box/FIR average over the cycles of one output sample is an optional
  upgrade.

> The public API (`Sid::new(sample_rate)`, `Sid::clock() -> i16`, `write_register`,
> `read_register`, `high::*`) is unchanged. Only the *internals* move to chip rate.

---

## 2. Oscillator (per voice)

- **Accumulator**: 24-bit, `acc = (acc + freq) & 0xFFFFFF` each chip cycle.
  `freq` is the 16-bit value from `FREQ_LO`/`FREQ_HI`. Output pitch
  `Fout = freq · Fclk / 2^24`.
- **TEST bit** (`CONTROL` bit 3): while set, the accumulator is held at 0 and does
  not count; the noise shift register is held reset. Clearing TEST reloads the noise
  register seed (see §4). Pulse output is forced to `0xFFF` while TEST is set.
- **MSB-rising flag**: set true on the cycle where accumulator bit 23 transitions
  0→1. Used for hard sync.

### 2.1 Hard sync

Computed *after* all three oscillators have advanced on the same cycle:

```
if source.msb_rising && this.sync_enabled
   && !(this.sync_enabled && source_of_source.msb_rising):
       this.accumulator = 0
```

The guard handles the chained special case (a sync source that is itself synced on the
same cycle does not propagate). SID routing is fixed: voice0←voice2, voice1←voice0,
voice2←voice1.

> This is *only correct at chip-cycle granularity*. At sample-rate granularity the
> reset happens up to ~22 cycles late, which is the main reason synced leads sounded
> wrong before.

---

## 3. Waveform generator — 12-bit unsigned output

The waveform DAC produces a **12-bit unsigned** value (`0x000..0xFFF`), nominally
centred near `0x800`. (The voice stage in §5 subtracts the DC zero level.)

### 3.1 Pure waveforms

- **Sawtooth** (`__S_`): `acc >> 12` (upper 12 bits). Rising ramp.
- **Triangle** (`___T`): take `msb = acc bit 23`. If ring mod is on, replace it with
  `msb = (acc bit 23) XOR (sync_source acc bit 23)`. Then
  `tri = ((msb ? ~acc : acc) >> 11) & 0xFFF`. The MSB folds the ramp; the result has
  **half the horizontal resolution** of the saw (bit 0 of the 12-bit value is always 0).
- **Pulse** (`_P__`): `(TEST || (acc >> 12) >= pw) ? 0xFFF : 0x000`, where `pw` is the
  12-bit pulse-width register. A pure digital comparator → square edges.
- **Noise** (`N___`): see §4.

### 3.2 Combined waveforms — the AND-with-bleed model

When two or more of {triangle, saw, pulse} are selected, the bits are *wired together*
on the chip. A 0 in one waveform pulls the shared line toward 0 (the "AND" myth), but a
0 also **droops neighbouring bits** — the line is analogue, not a clean AND. The result:

- It is **always ≤ the bitwise AND** of the component waveforms.
- It **changes slightly over time** while the accumulator bits are held constant
  (more neighbours droop), and shows ±1-bit non-determinism between identical samples.
- Combinations **including noise** collapse to (near) **zero** after a few cycles
  (the shift register starves); model as **0**.

A bit-exact emulator approximates this with **measured OSC3 lookup tables** (8-bit
samples, one table per combination per chip model). `sidera` deliberately uses **no
such tables**.

**MIT-clean model prescribed for `sidera`:**

The dominant, *audible* component of the effect is the AND-style bit interaction plus the
"only the highest run of bits survives" drooping. A good integer approximation that needs
no measured data:

1. Compute the component 12-bit values (saw value `s`, triangle value `t`, pulse mask `p`
   which is `0xFFF` or `0x000`).
2. For the **oscillator combinations** (`__ST`, no pulse): take `a = s AND t12` (6581) or
   `a = s` (8580), then apply a **neighbour-coupling** transform. Two work well:
   **erosion** `out = a & (a<<1) & (a>>1) & 0xFFF` (keep a bit only if its neighbours
   survive — can be repeated for a stronger droop), and **majority** `≥2 of {left, self,
   right}` = `(a&(a<<1)) | (a&(a>>1)) | ((a<<1)&(a>>1))` (keeps more content). See step 4
   for which to use.
3. For combinations **with pulse** (`_PS_`, `_P_T`, `_PST`): compute the non-pulse
   combination as above (indexed by `s`, or `t` for `_P_T`), then **gate by the pulse**:
   `out = combo & p` (when pulse is low the whole thing is 0).
4. **Chip-model bias**: the 6581 thins harder and sits lower (darker, "reedy") → **erosion**
   (1–2 passes per combo); the 8580 couples more softly (brighter, cleaner) → **majority**
   for its pulse combinations, erosion for the rest. This is what `voice.rs::bleed()`
   implements (`Bleed::Erode(n)` / `Bleed::Majority`); see §3.3-P5 for the measured gain.

> This is an *approximation of an approximation*; the goal is acoustic plausibility, not
> bit equality with any reference. It can be calibrated by black-box A/B (§8). If a future
> contributor wants exact tables, they must **measure their own** or generate them from a
> permissively-licensed model.

### 3.3 Principles behind the combined-waveform model

The combined-waveform behaviour is characterised from the chip's *observable output*
(the OSC3 register sweep over a full accumulator cycle, indexed by the saw value — or
`tri>>1` for pulse+triangle). The droop targets below were obtained honestly: by
**measuring the OSC3 output of the reSID 0.16 oracle as a black box** (the `osc3_dump`
driver renders the sweep and records the register values — it does not read reSID's
`.dat` arrays). The result is a set of *facts* about the chip's behaviour — RMS ratios,
sparsity, neighbour-bit agreement — which are **not** copyrightable expression and from
which the model above is built. No lookup-table values are carried in the crate; only
these principles.

- **P1 — Droop amplitude.** The combined output's AC-RMS relative to the bitwise
  AND of the components: **6581 ≈ 0.17**, **8580 ≈ 1.0**. So the 6581 is ~15 dB
  quieter than a naive AND; the 8580 is about the same loudness. → set per-combo
  gains to hit these.
- **P2 — Sparsity.** Output is non-zero on only **~5 % of phases (6581)** /
  **~13 % (8580)** — mostly zero with occasional spikes. → erosion (which thins to
  a sparse set) is the right shape primitive; OR (which fills) is exactly wrong.
- **P3 — Neighbour-bit rule.** An output bit at position *p* matches
  `idx_p AND idx_{p+1}` far better (~0.78 agreement) than `idx_p` alone (~0.52):
  a bit survives mainly when a neighbour is also set. → morphological erosion
  `a & (a<<1) & (a>>1)`; the 6581 needs a second bleed-up step.
- **P4 — Model structure.** The **8580** output is well-predicted by the *index
  waveform alone* (`saw`, or `tri` for pulse+triangle) — the second oscillator
  barely matters. The **6581** droops so hard that the AND with the second
  waveform is needed (for saw+tri) to reproduce its sparse output. → 8580 keys
  off the index; 6581 erodes `index AND partner` for ST, the index alone for the
  pulse combos.
- **P5 — Coupling strength differs by chip.** The 6581's coupling is hard →
  **erosion** (`a & (a<<1) & (a>>1)`, repeated 1–2× per combo) best fits its
  sparse, dark output. The 8580's coupling is softer → for the **pulse** combos a
  **majority filter** (`≥2 of {left, self, right}`,
  `(a&(a<<1)) | (a&(a>>1)) | ((a<<1)&(a>>1))`) keeps the right amount of content;
  measured OSC3 shape-correlation vs the oracle then rises from ~0.70/0.75 to
  **~0.91/0.95** (pulse+tri / pulse+saw). saw+tri and pulse+saw+tri stay on
  erosion on both chips.

These principles are what `voice.rs` implements: `bleed()` applies the per-combo
bit-coupling transform (`Bleed::Erode(n)` or `Bleed::Majority`, per P3/P4/P5) and
`bleed_gain()` then applies a per-combo amplitude gain for level (per P1); the
combinations stay sparse (per P2). The transform + gain per (combo, chip) are
chosen to maximise the OSC3 shape/level match to the oracle, no table values
copied. Regression-locked by `golden_osc3_tables` in `tests/golden.rs`.

> **Why not just keep OR?** OR sets a bit whenever *either* source has it → the output is
> brighter and louder than any component. The real effect is the opposite (AND-ish,
> darker, quieter). Even a plain bitwise AND is already far closer than OR; the droop is
> the refinement.

---

## 4. Noise (LFSR)

- 23-bit Fibonacci LFSR. Seed on reset / on TEST-clear: `0x7FFFF8`.
- **Clocked by accumulator bit 19** (one shift each time bit 19 transitions 0→1).
  At chip rate this is a *real* bit-19 edge test — **not** a fractional counter. The
  fractional counter was a sample-rate workaround and must be removed once the engine
  is cycle-accurate.
- Feedback bit: `bit0 = ((sr >> 22) ^ (sr >> 17)) & 1`; then `sr = ((sr << 1) | bit0) & 0x7FFFFF`.
- **Output tap mapping** (12-bit, non-contiguous — these *are* fixed wiring, not measured
  data, so they may be reproduced):
  ```
  out =  ((sr & 0x400000) >> 11)
       | ((sr & 0x100000) >> 10)
       | ((sr & 0x010000) >>  7)
       | ((sr & 0x002000) >>  5)
       | ((sr & 0x000800) >>  4)
       | ((sr & 0x000080) >>  1)
       | ((sr & 0x000010) <<  1)
       | ((sr & 0x000004) <<  2)
  ```
  (8 bits placed into the upper bits of the 12-bit word.) The previous "bits [22..7]"
  approximation gave the wrong spectral colour.
- TEST set, or combining noise with other waveforms, can fill the register with zeros and
  lock it (silent). Model: combinations with noise → 0 (§3.2).

---

## 5. Voice = waveform × envelope, with analogue DC (the asymmetry)

The 8-bit envelope multiplies the 12-bit waveform in the multiplying DAC. Crucially the
**zero level of the waveform DAC is not 0x800**, and the multiplying DAC adds its own
offset:

```
voice_output = (wave12 − wave_zero) · env8 + voice_DC          // ~20-bit signed
```

| Quantity   | 6581             | 8580   | Meaning                                   |
|------------|------------------|--------|-------------------------------------------|
| `wave_zero`| `0x380`          | `0x800`| measured "zero" of the waveform DAC       |
| `voice_DC` | `0x800 · 0xFF`   | `0`    | multiplying-DAC DC offset                 |

Consequences (6581):
- The signal swing is **asymmetric** about zero (positive excursion larger than negative),
  because `wave_zero = 0x380 ≠ 0x800`. This asymmetry is part of the 6581 timbre.
- A non-zero `voice_DC` means each *active* voice contributes a constant offset; when the
  envelope or volume changes, that offset jumps → **clicks** ("digi" tricks rely on this).

The 8580 has no offsets (`wave_zero = 0x800`, `voice_DC = 0`) → cleaner, symmetric.

> These constants are *measured voltages expressed as DAC codes*; they are short scalar
> facts about the chip, not a data table. Reproduce them.

---

## 6. Filter & mixer

### 6.1 Two-integrator state-variable filter (confirmed circuit)

State `Vlp, Vbp, Vhp`. Each clocked cycle (with `Vi` = sum of filter-routed voices):

```
dVbp = (w0_ceil · Vhp) >> S_bp
dVlp = (w0_ceil · Vbp) >> S_lp
Vbp -= dVbp
Vlp -= dVlp
Vhp  = (Vbp · 1024/Q) >> 10  −  Vlp  −  Vi
```

- Voices are scaled down (~`>> 7`, 20→13 bits) before entering, to keep the integer
  integrators in range.
- `w0 = 2π · fc` where `fc` is the **non-linear** cutoff frequency from §6.2. `w0` is
  scaled so the `>> 20` divides by ~10^6 (1 MHz clock → seconds). For the 1-cycle update,
  `w0` must be **clamped to ≤ 2π·16 kHz** for stability; for multi-cycle (`delta_t>8`)
  updates it must be clamped to ≤ 2π·4 kHz and the step subdivided.
- **Q (resonance)**: `1024/Q` with `Q ≈ 0.707 + res/15` over `res ∈ 0..15`
  (so `Q ∈ [0.707, ~1.7]`). Note the SID resonance range is mild — nothing like a
  self-oscillating Moog. The previous `Q = 2^res_shift` up to 64 was wildly too high.
- **Mode mixing is unweighted**: the selected LP/BP/HP outputs are simply *summed*
  (`Vf = (lp?Vlp) + (bp?Vbp) + (hp?Vhp)`), which is how band-reject (LP+HP) arises.

### 6.2 Non-linear cutoff map (the "SID sound")

`fc` (11-bit register `FC`, 0..2047) → cutoff frequency Hz:

- **6581**: ≈ 220 Hz at FC=0, rising in a **tanh / S-curve** to ~18 kHz, with a
  **discontinuity around FCHI = 0x80** (FC≈1024): the curve jumps *down* (~6000→4600 Hz)
  then climbs again. The steep region is in the lower third of the range. This irregular
  map is *the* reason 6581 filter sweeps sound "vocal/wobbly" and vary chip-to-chip.
- **8580**: very close to a **linear** map ~30 Hz → ~12 kHz.

A bit-exact emulator stores ~30 measured spline points and interpolates. **MIT-clean approach for
`sidera`**: encode a small set of (FC, Hz) breakpoints chosen to reproduce the *documented
shape* (the numbers above are published characteristics, not a proprietary table) and
linearly interpolate between them into a 2048-entry `w0` table built at construction.
Keep the 6581 discontinuity at 0x80. Provide a per-model table.

### 6.3 Mixer DC offset & volume

```
Vf_out = (Σ Vnf  +  Σ Vf  +  mixer_DC) · volume        // volume ∈ 0..15
```

| Quantity   | 6581                         | 8580 |
|------------|------------------------------|------|
| `mixer_DC` | `−(0xFFF · 0xFF / 18) >> 7`   | `0`  |

The mixer DC is *removed* by the external high-pass (§7), but its **transient** when
`volume` changes is exactly the audible "volume-register click" used for sample playback.

> Do **not** apply the invented `soft_clip()`. The chip does not soft-clip here; loudness
> is bounded by the finite DAC range and the external filter, and final hard-limiting to
> i16 only guards against numeric overflow at the very end (§7).

---

## 7. External RC filter (C64 board, not the chip)

Two STC sections on the C64 motherboard, *after* the SID:

```
Vlp += (w0lp · (Vi  − Vlp)) >> k1          // low-pass,  ~16 kHz
Vhp += (w0hp · (Vlp − Vhp)) >> k2          // high-pass, ~16 Hz
Vo   = Vlp − Vhp
```

- LP pole ≈ 16 kHz (`1/RC`, R=10 kΩ, C=1000 pF): the gentle treble roll-off that makes
  the C64 sound "warm" and provides anti-aliasing for decimation.
- HP pole ≈ 16 Hz: removes the large DC offsets from §5/§6 so the waveform is centred,
  while passing the *transients* (clicks) through.
- When this stage is disabled, the maximum DC offset must be subtracted explicitly so the
  output isn't railed.

Final: scale `Vo` to 16-bit and **hard-clamp** to `[-32768, 32767]` only as an overflow
guard (the analogue path should rarely reach it).

---

## 8. Envelope (ADSR) — the 6-segment exponential

A 15-bit **rate counter** divides the chip clock. Each cycle `rate_counter++`; when it
equals `rate_period` (selected by the active A/D/R nibble via the rate table), the counter
zeroes and the envelope *may* step.

### 8.1 Rate periods (cycles between candidate steps)

Indexed by the 4-bit setting (these are the published Programmer's-Reference-derived
periods; reproduce them — they are short scalar facts):

```
[ 9, 32, 63, 95, 149, 220, 267, 313, 392, 977, 1954, 3126, 3907, 11720, 19532, 31251 ]
```

### 8.2 Exponential divider (decay/release only)

A second counter divides the stepping further so decay/release approximate an exponential.
The divider **period changes with the current envelope level**:

| envelope level | exp period |
|----------------|-----------|
| 0xFF           | 1         |
| 0x5D (93)      | 2         |
| 0x36 (54)      | 4         |
| 0x1A (26)      | 8         |
| 0x0E (14)      | 16        |
| 0x06 (6)       | 30        |
| 0x00           | 1 (+ freeze) |

So decay/release slow down in six steps as they approach zero — this is the SID's
characteristic soft tail. **Attack is linear** (the exponential counter is reset on every
attack step).

### 8.3 States & quirks

- **Attack**: `env++` until `0xFF`, then → Decay. Linear.
- **Decay/Sustain**: `env--` (with exp divider) until `env == sustain_level`, then hold.
  `sustain_level[s] = s · 0x11` (both nibbles compared → 0x00,0x11,…,0xFF).
- **Release**: gate-off → `env--` (with exp divider) down to 0, then **freeze at 0**
  (`hold_zero`).
- **ADSR delay bug** (audible, used deliberately): the rate counter is *never reset* on
  gate or register writes. If a new (smaller) rate period is written below the current
  counter value, the counter must wrap the full 0x8000 before it can match → a long,
  audible delay before the envelope moves. Worth modelling for authenticity.
- Envelope output is 8-bit (`0..0xFF`); `ENV3` exposes voice-3's value.

> The previous `sidera` mapped the envelope to 16-bit with a 3-segment (1/3/9) curve and
> derived rate tables empirically. Replace with the 8-bit counter, the rate table above,
> and the 6-segment divider, clocked at chip rate.

---

## 9. Implementation checklist for `sidera`

Ordered by acoustic impact (do top-down):

1. **Cycle-accurate core** (§1): clock oscillators/envelope/filter at chip rate; add a
   fractional decimator in `Sid::clock()`. Removes the noise fractional counter (§4).
2. **Combined waveforms** AND-with-bleed (§3.2) — replace OR. *(Biggest single win for
   typical tunes.)*
3. **Analogue DC + external RC filter** (§5–§7) — replace the invented `soft_clip()` with
   the real DC structure + RC network. Adds the 6581 colour and the digi clicks.
4. **Non-linear filter cutoff + correct Q** (§6.2, §6.1) — replace the linear map and the
   absurd `Q` range.
5. **6-segment envelope at chip rate** (§8) — replace the 3-segment sample-rate ADSR.
6. **Chip-model switch** (6581 vs 8580): all the per-model constants above. Expose it on
   `Sid` (default 6581).

Verification: render identical register scripts through the reSID 0.16 oracle and through
`sidera`, compare per-test with tolerance (level dB, spectral similarity, envelope
correlation) — the same Tier-2 methodology used for the IT/OpenMPT and DW/Paula oracles.
Calibrate the combined-waveform droop depth and the cutoff breakpoints against the oracle.

### 9.1 Status — implemented & verified

All six items are implemented (commit set introducing `oscillator.rs`,
`noise.rs`, `envelope.rs`, `voice.rs`, `filter.rs`, `extfilt.rs`, rewritten
`sid.rs`). Verified vs the reSID 0.16 oracle (black-box spectral-cosine A/B on
rendered audio, 6581 & 8580, 44.1 kHz):

| Test            | 6581 cos | 8580 cos | level Δ |
|-----------------|----------|----------|---------|
| sawtooth        | 0.997    | 0.997    | ≤0.1 dB |
| triangle        | 1.000    | 1.000    | ≤0.1 dB |
| pulse 50 %      | 0.998    | 0.998    | ≤0.1 dB |
| LP filter       | 0.997    | 0.999    | ≤0.7 dB |
| resonant sweep  | 0.998    | 0.995    | ≤0.4 dB |
| hard sync       | 0.997    | 0.997    | ≤0.1 dB |
| ADSR pluck      | 1.000    | 0.994    | ≤0.1 dB |
| saw+tri (comb.) | 0.64     | 0.94     | ≤5.7 dB² |
| pulse+saw       | 0.74     | 0.97     | ≤1.6 dB |
| pulse+tri       | 0.86     | 0.96     | ≤2.5 dB |
| pulse+saw+tri   | 0.37¹    | 0.96     | ≤2.1 dB |

¹ 6581 pulse+saw+tri is the residual weak *shape* case — a rare, near-noise,
very quiet combination on the harder-to-model chip; the spectral match plateaus
around 0.37 (the measured table itself is only ~0.4 % non-zero). Its **level is
correct**: this combo indexes the **saw** waveform (as a table-based emulator does), not
`saw AND tri` — the latter erodes entirely into the pulse-low half so the pulse
gate would zero it, leaving the voice silent in steady state.

² The 6581 combined waveforms are all *very quiet* (saw+tri renders at
≈ −38 dBFS); the larger dB deltas there are level errors on near-silent signals,
not audible discrepancies — the OSC3 raw-level error is only ≈ 2–3 dB.

Pure waveforms, the filter, hard sync and the envelope are essentially exact.
Combined waveforms use the principled model below; they beat the old OR model
substantially (OR gave ≈0.3 / 0.5 on the 6581 combinations) but exact per-chip
combined timbres still require the measured OSC3 tables.

**Combined-waveform model** (`voice.rs::bleed()` + `bleed_gain()`), built from
the principles in §3.3:

- A base waveform (or `saw AND tri` for 6581 saw+tri) is passed through a
  per-combo bit-coupling transform: **erosion** `a & (a<<1) & (a>>1)` (1–2
  passes) for the 6581's hard droop, and a **majority** filter
  (`≥2 of {left, self, right}`) for the 8580's softer coupling on the pulse
  combinations. Pulse combos are then gated by the pulse.
- Per-combo gains (×¼) restore the measured droop amplitude (P1); they were read
  off the table AC-RMS, not the table values.
- Regression-locked by `golden_osc3_tables` in `tests/golden.rs`.

For exact timbres, replace `bleed()`/`bleed_gain()` with measured tables indexed
by the saw/triangle value — supply your own measurements to stay MIT.

### 9.2 Decimation note

The integer external high-pass carries a sub-LSB remainder (`extfilt.rs::hp_rem`)
so DC is fully removed; without it the `w0hp=105` coefficient leaves a constant
DC residual (a deadband of ~2²⁰/105). A naive integer high-pass shows this residual;
carrying the remainder is a strict improvement (silent voices are truly silent) and also
lifted the low-frequency spectral match (filter/envelope tests → 0.99+).
