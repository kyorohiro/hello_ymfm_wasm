//! External RC filter — the C64 motherboard output stage (not the SID chip).
//!
//! Two single-time-constant sections after the SID: a low-pass at ~16 kHz
//! (warmth + anti-aliasing for decimation) followed by a high-pass at ~16 Hz
//! (removes the large analogue DC offsets while passing transients/clicks).
//! See `SID_ANALOG_SPEC.md` §7.

#[derive(Clone, Copy)]
pub struct ExternalFilter {
    vlp: i32,
    vhp: i32,
    vo: i32,
    /// Sub-LSB remainder for the high-pass integrator. The HP coefficient is
    /// tiny (`w0hp=105`), so the plain `>>20` truncation has a wide deadband
    /// (~2²⁰/105 ≈ 9986) that would leave a constant DC residual at idle.
    /// Carrying the remainder lets the high-pass fully remove DC (the real
    /// analogue network does), so a silent voice is truly silent.
    hp_rem: i64,
    w0lp: i32,
    w0hp: i32,
}

impl ExternalFilter {
    pub const fn new() -> Self {
        Self {
            vlp: 0,
            vhp: 0,
            vo: 0,
            hp_rem: 0,
            // 1/RC scaled by 1.048576 (so >>20 ≈ ÷10⁶, 1 MHz → seconds):
            //   LP: R=10kΩ, C=1000pF → 1/RC = 100000 → 104858
            //   HP: R= 1kΩ, C=  10µF → 1/RC =    100 →    105
            w0lp: 104_858,
            w0hp: 105,
        }
    }

    /// Advance one chip cycle with mixer input `vi` (~20-bit).
    #[inline(always)]
    pub fn clock(&mut self, vi: i32) {
        let dvlp = ((self.w0lp >> 8) * (vi - self.vlp)) >> 12;
        // High-pass with carried remainder (deadband-free DC removal).
        let num = self.hp_rem + self.w0hp as i64 * (self.vlp - self.vhp) as i64;
        let dvhp = num >> 20;
        self.hp_rem = num - (dvhp << 20);
        self.vo = self.vlp - self.vhp;
        self.vlp += dvlp;
        self.vhp += dvhp as i32;
    }

    /// Current output (~20-bit signed).
    #[inline(always)]
    pub fn output(&self) -> i32 {
        self.vo
    }
}
