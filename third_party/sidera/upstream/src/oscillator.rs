//! 24-bit phase accumulator oscillator (cycle-accurate).
//!
//! Clocked **once per chip cycle** by [`crate::sid::Sid`]'s decimator: each
//! cycle `freq` is added to the 24-bit accumulator. Running at chip rate is
//! what makes hard sync, ring modulation, pulse-width edges and noise
//! spectrally correct (see `SID_ANALOG_SPEC.md` §1–§2).

use crate::noise::Noise;

/// One voice's oscillator: 24-bit accumulator + noise LFSR.
#[derive(Clone, Copy)]
pub struct Oscillator {
    /// 24-bit phase accumulator (`0..=0xFFFFFF`).
    pub accumulator: u32,
    /// 16-bit frequency added each chip cycle.
    pub freq: u32,
    /// TEST bit (CONTROL bit 3): when set, the accumulator is frozen at 0.
    pub test: bool,
    /// True on the cycle when accumulator bit 23 transitioned 0→1.
    /// Consumed by hard sync the same cycle.
    pub msb_rising: bool,
    /// Noise shift register, clocked from accumulator bit 19.
    pub noise: Noise,
}

impl Oscillator {
    pub const fn new() -> Self {
        Self {
            accumulator: 0,
            freq: 0,
            test: false,
            msb_rising: false,
            noise: Noise::new(),
        }
    }

    /// Advance the accumulator by one chip cycle.
    ///
    /// Sets [`Self::msb_rising`] and clocks the noise register on each rising
    /// edge of bit 19. No-op (except clearing `msb_rising`) while TEST is set.
    #[inline(always)]
    pub fn clock(&mut self) {
        if self.test {
            self.msb_rising = false;
            return;
        }
        let prev = self.accumulator;
        self.accumulator = (self.accumulator.wrapping_add(self.freq)) & 0xFF_FFFF;

        // Bit 23 rising edge → hard-sync trigger.
        self.msb_rising = (prev & 0x80_0000) == 0 && (self.accumulator & 0x80_0000) != 0;

        // Bit 19 rising edge → clock the noise LFSR.
        if (prev & 0x08_0000) == 0 && (self.accumulator & 0x08_0000) != 0 {
            self.noise.clock();
        }
    }

    /// Set the 16-bit frequency from the two register bytes.
    #[inline(always)]
    pub fn set_freq(&mut self, lo: u8, hi: u8) {
        self.freq = (((hi as u32) << 8) | (lo as u32)) & 0xFFFF;
    }

    /// Handle a TEST-bit transition (called from `write_control`).
    #[inline(always)]
    pub fn set_test(&mut self, on: bool) {
        if on {
            self.accumulator = 0;
            self.noise.on_test_set();
        } else if self.test {
            // Falling edge of TEST: reseed the noise register.
            self.noise.on_test_clear();
        }
        self.test = on;
    }
}
