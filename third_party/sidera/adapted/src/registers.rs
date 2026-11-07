//! SID register addresses (offsets from `$D400`) and control bit constants.
//!
//! # Voice register layout
//!
//! Voices 1, 2, and 3 start at offsets `0x00`, `0x07`, and `0x0E` respectively.
//! Each block has the same internal layout:
//!
//! | Offset | Name            |
//! |--------|-----------------|
//! | +0     | FREQ_LO         |
//! | +1     | FREQ_HI         |
//! | +2     | PULSE_LO        |
//! | +3     | PULSE_HI (3..0) |
//! | +4     | CONTROL         |
//! | +5     | ATTACK_DECAY    |
//! | +6     | SUSTAIN_RELEASE |
//!
//! # Global registers
//!
//! | Address | Name     |
//! |---------|----------|
//! | `$15`   | FC_LO    |
//! | `$16`   | FC_HI    |
//! | `$17`   | RES_FILT |
//! | `$18`   | MODE_VOL |

// --- Voice 1 ---
pub const V1_FREQ_LO: u8 = 0x00;
pub const V1_FREQ_HI: u8 = 0x01;
pub const V1_PULSE_LO: u8 = 0x02;
pub const V1_PULSE_HI: u8 = 0x03;
pub const V1_CONTROL: u8 = 0x04;
pub const V1_ATTACK_DECAY: u8 = 0x05;
pub const V1_SUSTAIN_RELEASE: u8 = 0x06;

// --- Voice 2 ---
pub const V2_FREQ_LO: u8 = 0x07;
pub const V2_FREQ_HI: u8 = 0x08;
pub const V2_PULSE_LO: u8 = 0x09;
pub const V2_PULSE_HI: u8 = 0x0A;
pub const V2_CONTROL: u8 = 0x0B;
pub const V2_ATTACK_DECAY: u8 = 0x0C;
pub const V2_SUSTAIN_RELEASE: u8 = 0x0D;

// --- Voice 3 ---
pub const V3_FREQ_LO: u8 = 0x0E;
pub const V3_FREQ_HI: u8 = 0x0F;
pub const V3_PULSE_LO: u8 = 0x10;
pub const V3_PULSE_HI: u8 = 0x11;
pub const V3_CONTROL: u8 = 0x12;
pub const V3_ATTACK_DECAY: u8 = 0x13;
pub const V3_SUSTAIN_RELEASE: u8 = 0x14;

// --- Filter / global ---
pub const FC_LO: u8 = 0x15;
pub const FC_HI: u8 = 0x16;
pub const RES_FILT: u8 = 0x17;
pub const MODE_VOL: u8 = 0x18;

// --- Read-only ---
pub const POT_X: u8 = 0x19;
pub const POT_Y: u8 = 0x1A;
pub const OSC3: u8 = 0x1B;
pub const ENV3: u8 = 0x1C;

// --- CONTROL register bits ---
/// Gate: triggers ADSR attack when set, release when cleared.
pub const CTRL_GATE: u8 = 0x01;
/// Oscillator sync enable.
pub const CTRL_SYNC: u8 = 0x02;
/// Ring modulation enable (triangle waveform only).
pub const CTRL_RING: u8 = 0x04;
/// Test bit: resets LFSR and halts the oscillator.
pub const CTRL_TEST: u8 = 0x08;
/// Triangle waveform select.
pub const CTRL_TRI: u8 = 0x10;
/// Sawtooth waveform select.
pub const CTRL_SAW: u8 = 0x20;
/// Pulse waveform select.
pub const CTRL_PULSE: u8 = 0x40;
/// Noise waveform select.
pub const CTRL_NOISE: u8 = 0x80;

// ---------------------------------------------------------------------------
// ADSR rate / envelope timing
// ---------------------------------------------------------------------------
//
// Envelope timing lives in `src/envelope.rs` (cycle-accurate: a 15-bit rate
// counter plus a 6-segment exponential divider; see `SID_ANALOG_SPEC.md` §8).
