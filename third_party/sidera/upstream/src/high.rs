//! High-level interface for the SID emulator.
//!
//! This module provides human-friendly conversion functions that translate
//! musical and acoustic parameters into the low-level register writes expected
//! by [`Sid`]. No state is held here — every function takes a `&mut Sid` and
//! writes the appropriate registers immediately.
//!
//! # Units
//!
//! | Parameter      | Unit                              |
//! |----------------|-----------------------------------|
//! | Frequency      | Hz (`u32`) or MIDI note (`u8`)    |
//! | Attack / Decay / Release | milliseconds (`u16`) |
//! | Sustain        | percent 0-100 (`u8`)              |
//! | Pulse width    | percent 0-100 (`u8`)              |
//! | Filter cutoff  | Hz (`u16`, ~220 Hz – 18 kHz, 6581 curve) |
//! | Resonance      | percent 0-100 (`u8`)              |
//!
//! # No-std note
//!
//! All arithmetic is integer-only. MIDI-to-frequency conversion is computed
//! from twelve fixed-point semitone ratios (see [`midi_freq_reg`]) rather than
//! floating-point exponentiation or a full per-note lookup table.

use crate::{
    registers::{
        CTRL_GATE, CTRL_NOISE, CTRL_PULSE, CTRL_RING, CTRL_SAW, CTRL_SYNC, CTRL_TEST, CTRL_TRI,
        FC_HI, FC_LO, MODE_VOL, RES_FILT, V1_ATTACK_DECAY, V1_CONTROL, V1_FREQ_HI, V1_FREQ_LO,
        V1_PULSE_HI, V1_PULSE_LO, V1_SUSTAIN_RELEASE,
    },
    Sid,
};

// ---------------------------------------------------------------------------
// Chip clock model
// ---------------------------------------------------------------------------

/// SID chip clock variants, used for Hz-to-register-value conversion.
///
/// The clock frequency determines the relationship between the oscillator
/// frequency register and the resulting audio pitch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChipClock {
    /// PAL systems (most European C64s): 985 248 Hz.
    Pal,
    /// NTSC systems (North American C64s): 1 022 727 Hz.
    Ntsc,
}

impl ChipClock {
    /// Returns the raw clock frequency in Hz.
    #[inline(always)]
    pub const fn hz(self) -> u32 {
        match self {
            ChipClock::Pal => 985_248,
            ChipClock::Ntsc => 1_022_727,
        }
    }
}

// ---------------------------------------------------------------------------
// Waveform
// ---------------------------------------------------------------------------

/// Available oscillator waveforms.
///
/// Combined waveforms (e.g. pulse + sawtooth simultaneously) are not exposed
/// by this interface. Use [`Sid::write_register`] with the raw CONTROL byte
/// for that.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Waveform {
    /// Falling sawtooth ramp.
    Saw,
    /// Triangle with optional ring modulation.
    Triangle,
    /// Variable-width pulse (square when width = 50 %).
    Pulse,
    /// Pseudo-random noise.
    Noise,
}

// ---------------------------------------------------------------------------
// Filter mode
// ---------------------------------------------------------------------------

/// Filter routing and mode selection.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FilterMode {
    /// Filter bypassed for all voices.
    Off,
    /// Low-pass output.
    LowPass,
    /// Band-pass output.
    BandPass,
    /// High-pass output.
    HighPass,
    /// Band-reject (notch): low-pass + high-pass summed.
    BandReject,
}

// ---------------------------------------------------------------------------
// MIDI-to-frequency conversion (computed, no per-note table)
// ---------------------------------------------------------------------------

/// Equal-temperament semitone ratios `2^(s/12)` for `s = 0..=11`, stored in
/// Q24 fixed point as `round(2^(s/12) × 2²⁴)`.
///
/// These twelve values are the only stored constants: every MIDI note's
/// register value is derived from them by an octave shift, replacing the former
/// 256-entry `MIDI_FREQ_PAL` / `MIDI_FREQ_NTSC` lookup tables. Q24 is the
/// sweet spot — it still reproduces every note exactly (Q21 is the minimum),
/// yet the ratios fit in `u32` and the whole conversion fits in `u64`.
const SEMITONE_RATIO_Q24: [u32; 12] = [
    16_777_216, // 2^(0/12)  = 1.0  (= 2²⁴)
    17_774_841, // 2^(1/12)
    18_831_788, // 2^(2/12)
    19_951_585, // 2^(3/12)
    21_137_968, // 2^(4/12)
    22_394_897, // 2^(5/12)
    23_726_566, // 2^(6/12)
    25_137_421, // 2^(7/12)
    26_632_170, // 2^(8/12)
    28_215_802, // 2^(9/12)
    29_893_600, // 2^(10/12)
    31_671_166, // 2^(11/12)
];

/// Oscillator frequency register value for a MIDI `note` (0-127) at the given
/// [`ChipClock`].
///
/// Reproduces `round(440 × 2^((n-69)/12) × 2²⁴ / clock_hz)` exactly, using
/// integer-only fixed-point arithmetic (verified bit-for-bit against the former
/// PAL and NTSC tables for all 128 notes). Values exceeding the SID's 16-bit
/// register range are clamped to 65 535 (MIDI >= 107 on PAL, >= 108 on NTSC).
pub const fn midi_freq_reg(note: u8, clock: ChipClock) -> u16 {
    // `n - 69` (relative to A4 = MIDI 69), biased by +72 (six octaves) so the
    // quotient and remainder stay non-negative — this keeps `/` and `%` valid
    // in a const context without needing `div_euclid` / `rem_euclid`.
    let biased = (note & 0x7F) as i32 + 3; // = (n - 69) + 72, range 3..=130
    let octave = biased / 12 - 6; // -6..=4
    let semitone = (biased % 12) as usize; // 0..=11

    // 2^(semitone/12) in Q24 (scaled by 2^24).
    let ratio = SEMITONE_RATIO_Q24[semitone] as u64;

    // Target: round( 440 × 2²⁴ × 2^octave × ratio / (clock_hz × 2²⁴) ).
    // Fold 2^octave into the numerator (octave >= 0) or the denominator
    // (octave < 0) so a single rounded division finishes the job. The widest
    // intermediate, `p << 4`, stays below 2^62 and fits in u64.
    let p = 440u64 * (1u64 << 24) * ratio; // 440 × 2²⁴ × ratio  (< 2^58)
    let clock_hz = clock.hz() as u64;

    let (num, den) = if octave >= 0 {
        (p << octave, clock_hz << 24)
    } else {
        (p, clock_hz << (24 - octave)) // 24 - octave == 24 + |octave|, <= 30
    };

    let value = (num + den / 2) / den; // round to nearest
    if value > 65_535 {
        65_535
    } else {
        value as u16
    }
}

// ---------------------------------------------------------------------------
// ADSR time table (ms per nibble)
// ---------------------------------------------------------------------------

/// Attack times in milliseconds for each of the 16 ADSR nibble values, from the
/// SID datasheet.
///
/// This is the single source of truth for envelope timing: Decay and Release
/// use the *same* steps scaled ×3 (a hardware property of the 6581/8580
/// envelope generator), so no separate decay/release table is stored — it is
/// derived on demand (`3 × attack_ms`). All access goes through [`attack_ms`].
const ATTACK_MS_TABLE: [u16; 16] = [
    2, 8, 16, 24, 38, 56, 68, 80, 100, 250, 500, 800, 1000, 3000, 5000, 8000,
];

/// Attack time in milliseconds for ADSR nibble `n` (only the low 4 bits are
/// used). Decay/Release times are `3 ×` this value.
#[inline(always)]
pub(crate) const fn attack_ms(n: u8) -> u16 {
    ATTACK_MS_TABLE[(n & 0x0F) as usize]
}

/// Returns the nibble (0-15) whose Attack time is closest to `ms`.
#[inline(always)]
const fn closest_attack_nibble(ms: u16) -> u8 {
    closest_scaled_nibble(ms, 1)
}

/// Returns the nibble (0-15) whose Decay/Release time is closest to `ms`.
///
/// Decay/Release times are exactly `3 ×` the Attack times, so `3 × attack_ms`
/// reproduces the former `DECAY_MS_TABLE` entry-for-entry (not merely an
/// approximation). Feeding those scaled candidates to the same nearest-neighbour
/// search therefore yields the identical nibble a stored decay table would,
/// without storing one.
#[inline(always)]
const fn closest_decay_nibble(ms: u16) -> u8 {
    closest_scaled_nibble(ms, 3)
}

/// Nibble (0-15) whose `scale × attack_ms` time is closest to `ms`.
/// `scale` is 1 for Attack and 3 for Decay/Release.
const fn closest_scaled_nibble(ms: u16, scale: u16) -> u8 {
    let mut best = 0u8;
    let mut best_dist = u16::MAX;
    let mut i = 0u8;
    while i < 16 {
        let t = attack_ms(i) * scale; // max 8000 × 3 = 24000, fits u16
        let dist = t.abs_diff(ms);
        if dist < best_dist {
            best = i;
            best_dist = dist;
        }
        i += 1;
    }
    best
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Base register offset for each voice (0-indexed).
#[inline(always)]
const fn voice_base(voice: u8) -> u8 {
    voice * 7
}

/// Writes FREQ_LO / FREQ_HI for `voice` with the given 16-bit register value.
#[inline(always)]
fn write_freq(sid: &mut Sid, voice: u8, freq_reg: u16) {
    let base = voice_base(voice);
    sid.write_register(base + V1_FREQ_LO, (freq_reg & 0xFF) as u8);
    sid.write_register(base + V1_FREQ_HI, (freq_reg >> 8) as u8);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Sets the oscillator frequency for `voice` (0, 1, or 2) in Hz.
///
/// The conversion is `freq_reg = (hz × 2²⁴) / clock_hz`, performed in `u64`
/// to avoid overflow, then clamped to `u16`. Out-of-range frequencies are
/// silently clamped.
///
/// `voice` values outside 0-2 are ignored.
pub fn set_frequency_hz(sid: &mut Sid, voice: u8, hz: u32, clock: ChipClock) {
    if voice > 2 {
        return;
    }
    // Use u64 for the intermediate product (hz * 2^24 can exceed u32).
    let freq_reg = ((hz as u64) << 24) / (clock.hz() as u64);
    let freq_reg = freq_reg.min(65535) as u16;
    write_freq(sid, voice, freq_reg);
}

/// Sets the oscillator frequency for `voice` from a MIDI note number (0-127).
///
/// The register value is computed on the fly for the given [`ChipClock`] (see
/// [`midi_freq_reg`]); no floating-point arithmetic is involved. Notes above
/// the SID's range are clamped.
///
/// `voice` values outside 0-2 are ignored.
pub fn set_frequency_midi(sid: &mut Sid, voice: u8, note: u8, clock: ChipClock) {
    if voice > 2 {
        return;
    }
    let freq_reg = midi_freq_reg(note, clock);
    write_freq(sid, voice, freq_reg);
}

/// Sets the waveform and the sync / ring flags for `voice`.
///
/// `sync` and `ring` enable oscillator sync and ring modulation respectively.
/// The GATE and TEST bits are preserved (read from the chip's CONTROL shadow),
/// so changing the waveform of a sounding note does not retrigger or silence
/// it. Use [`note_on`] / [`note_off`] to drive the gate.
///
/// `voice` values outside 0-2 are ignored.
pub fn set_waveform(sid: &mut Sid, voice: u8, waveform: Waveform, sync: bool, ring: bool) {
    if voice > 2 {
        return;
    }
    let wave_bit = match waveform {
        Waveform::Triangle => CTRL_TRI,
        Waveform::Saw => CTRL_SAW,
        Waveform::Pulse => CTRL_PULSE,
        Waveform::Noise => CTRL_NOISE,
    };
    // Preserve the gate and test bits; we own waveform / sync / ring.
    let kept = sid.control(voice) & (CTRL_GATE | CTRL_TEST);
    let ctrl = kept | wave_bit | (CTRL_SYNC * sync as u8) | (CTRL_RING * ring as u8);
    let base = voice_base(voice);
    sid.write_register(base + V1_CONTROL, ctrl);
}

/// Sets the pulse width for `voice` as a percentage of the cycle (0-100).
///
/// 0 % and 100 % both produce a constant level (silence). 50 % gives a
/// square wave. Values above 100 are clamped to 100.
///
/// `voice` values outside 0-2 are ignored.
pub fn set_pulse_width_pct(sid: &mut Sid, voice: u8, percent: u8) {
    if voice > 2 {
        return;
    }
    let pct = percent.min(100) as u32;
    // 12-bit pulse width register: 0x000-0xFFF.
    let pw = (pct * 4095 + 50) / 100; // round to nearest
    let base = voice_base(voice);
    sid.write_register(base + V1_PULSE_LO, (pw & 0xFF) as u8);
    sid.write_register(base + V1_PULSE_HI, ((pw >> 8) & 0x0F) as u8);
}

/// Sets the ADSR envelope for `voice`.
///
/// Times are in milliseconds; sustain is a percentage (0-100).
/// Each time value is quantised to the nearest of the 16 steps the SID
/// supports. Attack steps (ms): 2, 8, 16, 24, 38, 56, 68, 80, 100, 250,
/// 500, 800, 1 000, 3 000, 5 000, 8 000. Decay/Release steps (ms): 6, 24,
/// 48, 72, 114, 168, 204, 240, 300, 750, 1 500, 2 400, 3 000, 9 000,
/// 15 000, 24 000. Sustain is mapped linearly to the 16-step nibble.
///
/// `voice` values outside 0-2 are ignored.
pub fn set_envelope(sid: &mut Sid, voice: u8, attack: u16, decay: u16, sustain: u8, release: u16) {
    if voice > 2 {
        return;
    }
    let a = closest_attack_nibble(attack);
    let d = closest_decay_nibble(decay);
    let s = (sustain.min(100) as u16 * 15 + 50) / 100; // 0-15
    let r = closest_decay_nibble(release);

    let base = voice_base(voice);
    sid.write_register(base + V1_ATTACK_DECAY, (a << 4) | d);
    sid.write_register(base + V1_SUSTAIN_RELEASE, (s as u8) << 4 | r);
}

/// Opens the gate for `voice`, triggering the Attack phase.
///
/// Sets the given `waveform` and the GATE bit while preserving the current
/// sync / ring / test bits (read from the chip's CONTROL shadow), so a note
/// keeps any modulation routing set earlier.
///
/// `voice` values outside 0-2 are ignored.
pub fn note_on(sid: &mut Sid, voice: u8, waveform: Waveform) {
    if voice > 2 {
        return;
    }
    let wave_bit = match waveform {
        Waveform::Triangle => CTRL_TRI,
        Waveform::Saw => CTRL_SAW,
        Waveform::Pulse => CTRL_PULSE,
        Waveform::Noise => CTRL_NOISE,
    };
    let kept = sid.control(voice) & (CTRL_SYNC | CTRL_RING | CTRL_TEST);
    let base = voice_base(voice);
    sid.write_register(base + V1_CONTROL, kept | wave_bit | CTRL_GATE);
}

/// Closes the gate for `voice`, triggering the Release phase.
///
/// Clears only the GATE bit; the waveform and the sync / ring / test bits are
/// preserved from the chip's CONTROL shadow. The `waveform` argument is kept
/// for source compatibility but is no longer used.
///
/// `voice` values outside 0-2 are ignored.
pub fn note_off(sid: &mut Sid, voice: u8, _waveform: Waveform) {
    if voice > 2 {
        return;
    }
    let base = voice_base(voice);
    // GATE cleared, every other CONTROL bit preserved.
    sid.write_register(base + V1_CONTROL, sid.control(voice) & !CTRL_GATE);
}

/// Inverse of the 6581 cutoff curve: pick the 11-bit FC register that yields a
/// cutoff nearest `hz`. Uses the same documented breakpoints as
/// `filter::cutoff_hz` (default 6581 model). The one decreasing segment at the
/// 0x80 discontinuity is skipped so the inverse is monotonic.
fn fc_reg_for_hz(hz: u16) -> u16 {
    // (FC, Hz) ascending — exact mirror of filter.rs PTS_6581, with the single
    // decreasing segment at the FCHI=0x80 discontinuity (1024, 4600) dropped so
    // the inverse stays monotonic. Keep these values in sync with PTS_6581.
    const PTS: &[(i32, i32)] = &[
        (0, 220),
        (128, 235),
        (256, 250),
        (384, 300),
        (512, 430),
        (640, 760),
        (768, 1600),
        (896, 3200),
        (1023, 6000),
        (1152, 7000),
        (1408, 12000),
        (1664, 16000),
        (2047, 18000),
    ];
    let h = hz as i32;
    if h <= PTS[0].1 {
        return 0;
    }
    let last = PTS.len() - 1;
    if h >= PTS[last].1 {
        return 2047;
    }
    let mut i = 0;
    while i + 1 < PTS.len() && PTS[i + 1].1 < h {
        i += 1;
    }
    let (x0, y0) = PTS[i];
    let (x1, y1) = PTS[i + 1];
    (x0 + (x1 - x0) * (h - y0) / (y1 - y0)).clamp(0, 2047) as u16
}

/// Configures the global filter.
///
/// `cutoff_hz` is mapped through the 6581 cutoff curve (usable range
/// ~220 Hz – 18 kHz) to the nearest FC register value. `resonance_pct` is
/// 0-100. `voices` is a bitmask of voices to route through the filter
/// (bit 0 = voice 1, bit 1 = voice 2, bit 2 = voice 3).
pub fn set_filter(sid: &mut Sid, cutoff_hz: u16, resonance_pct: u8, mode: FilterMode, voices: u8) {
    let fc_reg = fc_reg_for_hz(cutoff_hz);
    sid.write_register(FC_LO, (fc_reg & 0x07) as u8);
    sid.write_register(FC_HI, (fc_reg >> 3) as u8);

    // Resonance nibble: 0-15.
    let res_nibble = (resonance_pct.min(100) as u16 * 15 + 50) / 100;
    let filt_voices = voices & 0x07;
    sid.write_register(RES_FILT, ((res_nibble as u8) << 4) | filt_voices);

    // MODE_VOL: bits 6-4 = filter mode. Preserve VOICE-3-OFF (bit7) and the
    // master volume (bits 3-0) via the chip's MODE_VOL shadow.
    let mode_bits: u8 = match mode {
        FilterMode::Off => 0x00,
        FilterMode::LowPass => 0x10,
        FilterMode::BandPass => 0x20,
        FilterMode::HighPass => 0x40,
        FilterMode::BandReject => 0x50, // LP + HP
    };
    let kept = sid.mode_vol() & 0x8F; // keep bit7 + volume nibble
    sid.write_register(MODE_VOL, kept | mode_bits);
}

/// Sets the master output volume (0-15).
///
/// Values above 15 are clamped. The filter mode and VOICE-3-OFF bits in
/// MODE_VOL are preserved (read from the chip's MODE_VOL shadow), so this can
/// be combined freely with [`set_filter`] / [`set_voice3_off`] in any order.
pub fn set_volume(sid: &mut Sid, volume: u8) {
    let kept = sid.mode_vol() & 0xF0; // keep VOICE-3-OFF + mode bits
    sid.write_register(MODE_VOL, kept | volume.min(15));
}

/// Mutes voice 3 from the output mix while keeping its oscillator running.
///
/// This is the "voice 3 off" feature of the SID, typically used to turn
/// voice 3 into a dedicated modulation source (e.g. for filter frequency
/// modulation via the OSC3 register) without it contributing to the audio
/// output.
///
/// Only MODE_VOL bit 7 is touched; the filter mode and master volume are
/// preserved via the chip's MODE_VOL shadow.
pub fn set_voice3_off(sid: &mut Sid, off: bool) {
    let cur = sid.mode_vol();
    let byte = if off { cur | 0x80 } else { cur & !0x80 };
    sid.write_register(MODE_VOL, byte);
}
