//! ADSR envelope generator (cycle-accurate, 8-bit).
//!
//! Clocked once per chip cycle. A 15-bit rate counter divides the chip clock
//! down to envelope steps; decay/release additionally pass through a
//! 6-segment exponential divider. See `SID_ANALOG_SPEC.md` §8.
//!
//! The output is the 8-bit envelope level (`0..=255`), exactly as the chip's
//! multiplying DAC sees it.

/// Rate-counter comparison periods, indexed by the 4-bit A/D/R setting.
/// Number of chip cycles between candidate envelope steps.
const RATE_PERIOD: [u16; 16] = [
    9, 32, 63, 95, 149, 220, 267, 313, 392, 977, 1954, 3126, 3907, 11720, 19532, 31251,
];

/// The 16 sustain levels: both nibbles of the envelope are compared to the
/// 4-bit sustain value, so level `s` maps to `s * 0x11`.
#[inline(always)]
const fn sustain_level(s: u8) -> u8 {
    (s << 4) | s
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum State {
    Attack = 0,
    DecaySustain = 1,
    Release = 2,
}

/// ADSR envelope generator.
#[derive(Clone, Copy)]
pub struct Envelope {
    rate_counter: u16,
    rate_period: u16,
    exp_counter: u8,
    exp_period: u8,
    /// 8-bit envelope level (`ENV3` exposes this).
    pub env: u8,
    hold_zero: bool,
    attack: u8,
    decay: u8,
    sustain: u8,
    release: u8,
    gate: bool,
    state: State,
}

impl Envelope {
    pub const fn new() -> Self {
        Self {
            rate_counter: 0,
            rate_period: RATE_PERIOD[0],
            exp_counter: 0,
            exp_period: 1,
            env: 0,
            hold_zero: true,
            attack: 0,
            decay: 0,
            sustain: 0,
            release: 0,
            gate: false,
            state: State::Release,
        }
    }

    /// 8-bit envelope output.
    #[inline(always)]
    pub fn output(&self) -> u8 {
        self.env
    }

    /// Advance one chip cycle.
    ///
    /// Faithful reproduction of the SID rate/exponential counters, including
    /// the ADSR delay bug (the rate counter is never reset on register writes).
    #[inline(always)]
    pub fn clock(&mut self) {
        // ADSR delay bug: if rate_period was set below the current counter,
        // the counter wraps the full 0x8000 before it can match again.
        self.rate_counter = self.rate_counter.wrapping_add(1);
        if self.rate_counter & 0x8000 != 0 {
            self.rate_counter = self.rate_counter.wrapping_add(1) & 0x7FFF;
        }

        if self.rate_counter != self.rate_period {
            return;
        }
        self.rate_counter = 0;

        // Attack always steps; decay/release are gated by the exponential
        // counter. The first attack step also resets the exponential counter.
        self.exp_counter = self.exp_counter.wrapping_add(1);
        if self.state == State::Attack || self.exp_counter == self.exp_period {
            self.exp_counter = 0;

            if self.hold_zero {
                return;
            }

            match self.state {
                State::Attack => {
                    self.env = self.env.wrapping_add(1);
                    if self.env == 0xFF {
                        self.state = State::DecaySustain;
                        self.rate_period = RATE_PERIOD[self.decay as usize];
                    }
                }
                State::DecaySustain => {
                    if self.env != sustain_level(self.sustain) {
                        self.env = self.env.wrapping_sub(1);
                    }
                }
                State::Release => {
                    self.env = self.env.wrapping_sub(1);
                }
            }

            // Reload the exponential divider period from the new level.
            self.exp_period = match self.env {
                0xFF => 1,
                0x5D => 2,
                0x36 => 4,
                0x1A => 8,
                0x0E => 16,
                0x06 => 30,
                0x00 => {
                    self.hold_zero = true;
                    1
                }
                _ => self.exp_period,
            };
        }
    }

    /// CONTROL-register write: handle the gate transition.
    #[inline(always)]
    pub fn write_control(&mut self, control: u8) {
        let gate_next = control & 0x01 != 0;
        if !self.gate && gate_next {
            // Gate on → attack.
            self.state = State::Attack;
            self.rate_period = RATE_PERIOD[self.attack as usize];
            self.hold_zero = false;
        } else if self.gate && !gate_next {
            // Gate off → release.
            self.state = State::Release;
            self.rate_period = RATE_PERIOD[self.release as usize];
        }
        self.gate = gate_next;
    }

    #[inline(always)]
    pub fn write_attack_decay(&mut self, val: u8) {
        self.attack = (val >> 4) & 0x0F;
        self.decay = val & 0x0F;
        match self.state {
            State::Attack => self.rate_period = RATE_PERIOD[self.attack as usize],
            State::DecaySustain => self.rate_period = RATE_PERIOD[self.decay as usize],
            State::Release => {}
        }
    }

    #[inline(always)]
    pub fn write_sustain_release(&mut self, val: u8) {
        self.sustain = (val >> 4) & 0x0F;
        self.release = val & 0x0F;
        if self.state == State::Release {
            self.rate_period = RATE_PERIOD[self.release as usize];
        }
    }
}
