//! # sidera
//!
//! A `no_std`, integer-only, **cycle-accurate** SID (MOS Technology 6581/8580)
//! emulator for the Commodore 64, tuned for acoustic fidelity (verified against
//! reSID 0.16 as a black-box oracle).
//!
//! ## Properties
//!
//! - `no_std`, zero heap allocation, zero floating-point, fully deterministic.
//! - Cycle-accurate engine (chip clock) decimated to the output rate.
//! - 24-bit accumulator, oscillator sync, ring modulation, 23-bit noise LFSR.
//! - 8-bit ADSR with the real rate table + 6-segment exponential divider.
//! - Two-integrator filter with the non-linear 6581/8580 cutoff curve.
//! - Analogue model: DAC DC offsets + the C64 output RC network.
//! - 6581 / 8580 selectable via [`Sid::set_model`] (6581 default).
//!
//! ## Minimal usage
//!
//! ```rust,ignore
//! use sidera::Sid;
//! use sidera::registers::*;
//!
//! let mut sid = Sid::new(44100);
//!
//! // A4 ≈ 440 Hz, PAL C64 (chip clock = 985 248 Hz):
//! // freq_reg = (440 * 16_777_216) / 985_248 ≈ 7490 = 0x1D42
//! sid.write_register(V1_FREQ_LO,         0x42);
//! sid.write_register(V1_FREQ_HI,         0x1D);
//! sid.write_register(V1_ATTACK_DECAY,    0x09); // attack=0, decay=9
//! sid.write_register(V1_SUSTAIN_RELEASE, 0xF0); // sustain=15, release=0
//! sid.write_register(V1_CONTROL,         CTRL_GATE | CTRL_SAW);
//! sid.write_register(MODE_VOL,           0x0F); // max volume, LP filter
//!
//! loop {
//!     let sample: i16 = sid.clock();
//!     // send `sample` to your DAC or audio buffer
//! }
//! ```
//!
//! ## Frequency formula
//!
//! ```text
//! freq_reg = (note_hz * 16_777_216) / chip_clock_hz
//! ```
//!
//! | Model    | Chip clock (Hz) |
//! |----------|----------------|
//! | C64 PAL  | 985 248        |
//! | C64 NTSC | 1 022 727      |
//!
//! ## Internal architecture
//!
//! Per chip cycle (the decimator in [`Sid::clock`] runs `chip_clock /
//! sample_rate` of these per output sample):
//!
//! ```text
//! Sid::clock()
//!  ├─ Voice[0..2]            envelope → oscillator → hard sync
//!  │    ├─ Oscillator        24-bit accumulator + 23-bit noise LFSR (bit-19 edge)
//!  │    ├─ Envelope          8-bit ADSR: rate table + 6-segment exp divider
//!  │    └─ wave·env + DC      combined-waveform model + analogue DC offsets
//!  ├─ Filter                 2-integrator SVF, non-linear cutoff, routing, volume
//!  └─ ExternalFilter         C64 output RC (LP 16 kHz, HP 16 Hz) → i16
//! ```
//!
//! The C64 output RC network provides the anti-alias low-pass, so plain
//! decimation is faithful. The full analogue model (combined-waveform
//! AND-with-bleed, DC offsets, the non-linear cutoff, the 6-segment envelope)
//! is documented in `SID_ANALOG_SPEC.md`.
//!
//! Remaining approximations: combined waveforms use an algorithmic (MIT-clean)
//! model rather than measured per-chip tables, and the filter cutoff uses
//! documented breakpoints rather than a measured spline.
//!
//! ## Entropy source
//!
//! The SID's noise generator (a 23-bit LFSR) is the Commodore 64's classic
//! hardware random-number source. [`Sid::noise_byte`] exposes it directly:
//!
//! ```rust,ignore
//! let r: u8 = sid.noise_byte();           // one pseudo-random byte
//! let w = u16::from_le_bytes([sid.noise_byte(), sid.noise_byte()]);
//! ```

#![no_std]
#![forbid(unsafe_code)]
#![allow(missing_docs)]

pub mod high;
pub mod registers;

mod envelope;
mod extfilt;
/// The chip's two-integrator state-variable filter, on its own.
///
/// Public because the filter is useful **outside** a full chip: the real 6581
/// has an EXT IN pin routed into it (`Filter::clock`'s `ext` argument, routing
/// bit 3), so passing foreign audio through the SID's own non-linear cutoff and
/// resonance is a hardware feature, not a trick. A host can therefore offer it
/// as an ordinary audio effect and get the genuine article rather than an
/// imitation.
///
/// Note it clocks at the **chip rate** (~1 MHz): a host running at an audio
/// sample rate must oversample accordingly.
pub mod filter;
mod noise;
mod oscillator;
mod sid;
mod voice;

pub use sid::{ChipModel, Sid, NTSC_CLOCK, PAL_CLOCK};
