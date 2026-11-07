//! One SID voice: oscillator + envelope + waveform DAC with analogue DC.
//!
//! The voice produces a ~20-bit signed sample per chip cycle:
//! ```text
//! voice = (wave12 − wave_zero) · env8 + voice_DC
//! ```
//! where `wave_zero` and `voice_DC` are the measured analogue offsets of the
//! waveform and multiplying DACs (see `SID_ANALOG_SPEC.md` §5). On the 6581
//! these make the signal asymmetric and are the source of the "digi" clicks;
//! on the 8580 they are zero.

use crate::envelope::Envelope;
use crate::oscillator::Oscillator;

/// One SID voice.
#[derive(Clone, Copy)]
pub struct Voice {
    pub(crate) osc: Oscillator,
    pub(crate) env: Envelope,
    /// 12-bit pulse width (`0..=4095`).
    pub(crate) pulse_width: u16,
    /// CONTROL register value.
    pub(crate) control: u8,
    /// Index of the sync / ring-mod source voice (same neighbour for both).
    pub(crate) sync_source: usize,
    freq_lo: u8,
    freq_hi: u8,
    /// True for the 6581 (analogue offsets + stronger combined-waveform droop).
    pub(crate) is_6581: bool,
}

impl Voice {
    pub(crate) const fn new(sync_src: usize) -> Self {
        Self {
            osc: Oscillator::new(),
            env: Envelope::new(),
            pulse_width: 0,
            control: 0,
            sync_source: sync_src,
            freq_lo: 0,
            freq_hi: 0,
            is_6581: true,
        }
    }

    /// Waveform-DAC zero level for this chip model.
    #[inline(always)]
    fn wave_zero(&self) -> i32 {
        if self.is_6581 {
            0x380
        } else {
            0x800
        }
    }

    /// Multiplying-DAC DC offset for this chip model.
    #[inline(always)]
    fn voice_dc(&self) -> i32 {
        if self.is_6581 {
            0x800 * 0xFF
        } else {
            0
        }
    }

    /// 12-bit unsigned waveform output for the current accumulator state.
    ///
    /// `src_acc` is the sync/ring source voice's accumulator (used for ring
    /// modulation of the triangle). This is the raw oscillator/DAC value
    /// *before* the analogue zero offset is applied.
    #[inline(always)]
    pub(crate) fn wave12(&self, src_acc: u32) -> u32 {
        let acc = self.osc.accumulator;
        let ring = self.control & 0x04 != 0;
        // CONTROL waveform-select nibble: bit0=tri bit1=saw bit2=pulse bit3=noise.
        let wf = (self.control >> 4) & 0x0F;

        let m = self.is_6581;
        let saw = sawtooth(acc);
        let tri = || triangle(acc, src_acc, ring);
        let pul = || pulse(acc, self.pulse_width, self.osc.test);
        // Each combined waveform is a base waveform (or AND of two) passed
        // through a per-combo bit-coupling transform + amplitude gain. The
        // transform and gain were chosen to maximise the OSC3 shape/level match
        // to measured behaviour per chip model; see `bleed()` and
        // SID_ANALOG_SPEC.md §3.2. The 8580's softer coupling is a majority
        // filter; the 6581's hard droop is repeated erosion.
        match wf {
            0x0 => 0,
            0x1 => tri(),
            0x2 => saw,
            // ST: 6581 ANDs both waveforms then erodes twice; 8580 keeps saw.
            0x3 => {
                let base = if m { saw & tri() } else { saw };
                let (k, g) = if m {
                    (Bleed::Erode(2), 13)
                } else {
                    (Bleed::Erode(1), 8)
                };
                bleed_gain(base, k, g)
            }
            0x4 => pul(),
            // PT: indexed by triangle, then gated by the pulse.
            0x5 => {
                let (k, g) = if m {
                    (Bleed::Erode(1), 8)
                } else {
                    (Bleed::Majority, 3)
                };
                bleed_gain(tri(), k, g) & pul()
            }
            // PS: indexed by sawtooth, then gated by the pulse.
            0x6 => {
                let (k, g) = if m {
                    (Bleed::Erode(2), 9)
                } else {
                    (Bleed::Majority, 3)
                };
                bleed_gain(saw, k, g) & pul()
            }
            // PST: index by saw, not saw&tri — the latter erodes into the
            // pulse-low half and the pulse gate would zero it entirely.
            0x7 => {
                let (k, g) = if m {
                    (Bleed::Erode(2), 2)
                } else {
                    (Bleed::Erode(1), 8)
                };
                bleed_gain(saw, k, g) & pul()
            }
            0x8 => self.osc.noise.output(),
            // Any combination including noise collapses to (near) zero.
            _ => 0,
        }
    }

    /// Amplitude-modulated voice output for one chip cycle (~20-bit signed).
    #[inline(always)]
    pub(crate) fn output(&self, src_acc: u32) -> i32 {
        let wave = self.wave12(src_acc) as i32;
        (wave - self.wave_zero()) * (self.env.output() as i32) + self.voice_dc()
    }

    // ---- register writes -------------------------------------------------

    #[inline(always)]
    pub(crate) fn write_freq_lo(&mut self, val: u8) {
        self.freq_lo = val;
        self.osc.set_freq(self.freq_lo, self.freq_hi);
    }

    #[inline(always)]
    pub(crate) fn write_freq_hi(&mut self, val: u8) {
        self.freq_hi = val;
        self.osc.set_freq(self.freq_lo, self.freq_hi);
    }

    #[inline(always)]
    pub(crate) fn write_pulse_lo(&mut self, val: u8) {
        self.pulse_width = (self.pulse_width & 0x0F00) | (val as u16);
    }

    #[inline(always)]
    pub(crate) fn write_pulse_hi(&mut self, val: u8) {
        self.pulse_width = (self.pulse_width & 0x00FF) | (((val as u16) & 0x0F) << 8);
    }

    #[inline(always)]
    pub(crate) fn write_control(&mut self, val: u8) {
        // TEST-bit transition is handled by the oscillator.
        self.osc.set_test(val & 0x08 != 0);
        self.env.write_control(val);
        self.control = val;
    }

    #[inline(always)]
    pub(crate) fn write_attack_decay(&mut self, val: u8) {
        self.env.write_attack_decay(val);
    }

    #[inline(always)]
    pub(crate) fn write_sustain_release(&mut self, val: u8) {
        self.env.write_sustain_release(val);
    }

    /// OSC3 read: the 12-bit waveform output, right-shifted to 8 bits.
    #[inline(always)]
    pub(crate) fn read_osc(&self, src_acc: u32) -> u8 {
        (self.wave12(src_acc) >> 4) as u8
    }

    /// ENV3 read: the 8-bit envelope level.
    #[inline(always)]
    pub(crate) fn read_env(&self) -> u8 {
        self.env.output()
    }
}

// ---------------------------------------------------------------------------
// Waveform primitives (12-bit unsigned, 0..=0xFFF)
// ---------------------------------------------------------------------------

#[inline(always)]
fn sawtooth(acc: u32) -> u32 {
    (acc >> 12) & 0xFFF
}

#[inline(always)]
fn triangle(acc: u32, src_acc: u32, ring: bool) -> u32 {
    let msb = (if ring { acc ^ src_acc } else { acc }) & 0x80_0000;
    ((if msb != 0 { !acc } else { acc }) >> 11) & 0xFFF
}

#[inline(always)]
fn pulse(acc: u32, pw: u16, test: bool) -> u32 {
    if test || (acc >> 12) >= pw as u32 {
        0xFFF
    } else {
        0x000
    }
}

/// Bit-coupling transform for a combined waveform's base bits
/// (`SID_ANALOG_SPEC.md` §3.2). On the real chip, selecting several waveforms
/// wire-ANDs their DAC bits and adjacent bits pull on each other; the result is
/// a sparse, drooped version of the AND. The coupling strength differs by chip:
///
/// - **`Erode(n)`** — morphological erosion `a & (a<<1) & (a>>1)`, repeated `n`
///   times: a bit survives only if its neighbours are also set. Models the
///   6581's hard droop (dark, sparse output); deeper `n` = stronger droop.
/// - **`Majority`** — `≥2 of {left, self, right}`: a softer coupling that keeps
///   more content. Best matches the 8580's cleaner combined output.
///
/// These implement the *principle* only; no measured table values are copied. The
/// transform fixes the shape; a per-combo gain (units of ¼) restores the level
/// independently — both chosen to maximise the OSC3 shape/level match per chip
/// model (calibrated by black-box A/B against the reSID 0.16 oracle's output).
#[derive(Clone, Copy)]
enum Bleed {
    Erode(u8),
    Majority,
}

#[inline(always)]
fn bleed(a: u32, kind: Bleed) -> u32 {
    let mut a = a & 0xFFF;
    match kind {
        Bleed::Erode(n) => {
            for _ in 0..n {
                a = a & (a << 1) & (a >> 1) & 0xFFF;
            }
            a
        }
        Bleed::Majority => ((a & (a << 1)) | (a & (a >> 1)) | ((a << 1) & (a >> 1))) & 0xFFF,
    }
}

/// Apply the bit-coupling transform then the amplitude gain (units of ¼),
/// clamped to 12 bits.
#[inline(always)]
fn bleed_gain(base: u32, kind: Bleed, gain_q4: u32) -> u32 {
    (((bleed(base, kind) * gain_q4) >> 2) & 0xFFFF).min(0xFFF)
}
