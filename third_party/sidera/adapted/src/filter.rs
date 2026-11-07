//! Two-integrator state-variable filter + mixer (cycle-accurate).
//!
//! This is the actual SID filter topology (confirmed by Bob Yannes): a summer
//! and two integrators forming an IIR filter, with a **non-linear** cutoff map
//! and a mild resonance range. It also performs voice routing, the VOICE-3-OFF
//! mute, the analogue mixer DC offset, and the master-volume multiply.
//! See `SID_ANALOG_SPEC.md` §6.
//!
//! Note: a voice routed into the filter with no filter mode selected is
//! *silenced* (the real chip does this — it is not a pass-through).

/// 2·π · 1.048576 in fixed point (µ-units): `w0 = f0_hz * K / 1_000_000`,
/// chosen so that `(w0 · V) >> 20` divides by ~10⁶ (1 MHz → seconds).
const W0_K: i64 = 6_588_397;

/// Cutoff stability ceiling for the 1-cycle integrator update (16 kHz).
const FC_CEIL_HZ: i64 = 16_000;

// Tetorica research-only 8580 damping calibration. Independently fitted from
// black-box reference responses, not copied from reference implementation code:
// Q(r) = (1024 / 1448) * exp(0.08571821144447545 * r), round(1024 / Q(r)).
// RES=0 retains the original integer coefficient. Disabled by default.
const RESEARCH_8580_Q1024: [i64; 16] = [
    1448, 1329, 1220, 1120, 1028, 943, 866, 795, 729, 669, 614, 564, 518, 475, 436, 400,
];

#[derive(Clone, Copy)]
pub struct Filter {
    // Filter state (integrator outputs).
    vlp: i32,
    vbp: i32,
    vhp: i32,
    /// Sum of the non-filtered (directly routed) voices, captured each cycle.
    vnf: i32,

    /// 11-bit cutoff register (`0..=2047`).
    fc: u16,
    /// Resonance nibble (`0..=15`).
    res: u8,
    /// Routing bits: bit0=voice1, bit1=voice2, bit2=voice3, bit3=ext.
    filt: u8,
    /// VOICE 3 OFF (MODE_VOL bit 7).
    voice3off: bool,
    /// Filter mode: bit0=LP, bit1=BP, bit2=HP.
    mode: u8,
    /// Master volume (`0..=15`).
    vol: u8,

    // Derived coefficients.
    w0_ceil_1: i64,
    q1024: i64,
    mixer_dc: i32,
    is_6581: bool,
    research_8580_resonance_calibration: bool,
}

impl Filter {
    pub const fn new() -> Self {
        Self {
            vlp: 0,
            vbp: 0,
            vhp: 0,
            vnf: 0,
            fc: 0,
            res: 0,
            filt: 0,
            voice3off: false,
            mode: 0,
            vol: 0,
            // Coefficients consistent with fc=0, res=0, 6581.
            w0_ceil_1: 0,
            q1024: 1_448,
            mixer_dc: -453,
            is_6581: true,
            research_8580_resonance_calibration: false,
        }
    }

    /// Select the chip model (recomputes cutoff, resonance and DC offset).
    pub fn set_model(&mut self, is_6581: bool) {
        self.is_6581 = is_6581;
        self.mixer_dc = if is_6581 {
            -((0xFFF * 0xFF / 18) >> 7)
        } else {
            0
        };
        self.set_w0();
        self.set_q();
    }

    /// Tetorica research option: change only 8580 resonance damping.
    /// Does not reset integrators, clock the chip or alter cutoff/routing.
    pub fn set_8580_resonance_calibration(&mut self, enabled: bool) {
        self.research_8580_resonance_calibration = enabled;
        self.set_q();
    }

    pub fn resonance_calibration_8580(&self) -> bool {
        self.research_8580_resonance_calibration
    }

    /// Advance the filter by one chip cycle.
    ///
    /// `v1,v2,v3,ext` are the ~20-bit voice/external outputs for this cycle.
    #[inline(always)]
    pub fn clock(&mut self, v1: i32, v2: i32, v3: i32, ext: i32) {
        // Scale each source from ~20 to ~13 bits.
        let v1 = v1 >> 7;
        let v2 = v2 >> 7;
        // Voice 3 is NOT silenced by VOICE-3-OFF if it is routed through the filter.
        let v3 = if self.voice3off && (self.filt & 0x04) == 0 {
            0
        } else {
            v3 >> 7
        };
        let ext = ext >> 7;

        // Route each source into the filter (Vi) or around it (Vnf).
        let mut vi = 0i32;
        let mut vnf = 0i32;
        if self.filt & 0x01 != 0 {
            vi += v1
        } else {
            vnf += v1
        }
        if self.filt & 0x02 != 0 {
            vi += v2
        } else {
            vnf += v2
        }
        if self.filt & 0x04 != 0 {
            vi += v3
        } else {
            vnf += v3
        }
        if self.filt & 0x08 != 0 {
            vi += ext
        } else {
            vnf += ext
        }
        self.vnf = vnf;

        // Two-integrator loop. i64 products guard against transient overflow
        // (the 32-bit intermediates stay bounded here).
        let dvbp = ((self.w0_ceil_1 * self.vhp as i64) >> 20) as i32;
        let dvlp = ((self.w0_ceil_1 * self.vbp as i64) >> 20) as i32;
        self.vbp -= dvbp;
        self.vlp -= dvlp;
        self.vhp = ((self.vbp as i64 * self.q1024) >> 10) as i32 - self.vlp - vi;
    }

    /// Mixed filter output (~20-bit) for this cycle, before the external filter.
    ///
    /// Selected LP/BP/HP outputs are summed unweighted; the non-filtered voices
    /// and the mixer DC offset are added, then scaled by master volume.
    #[inline(always)]
    pub fn output(&self) -> i32 {
        let mut vf = 0i32;
        if self.mode & 0x01 != 0 {
            vf += self.vlp
        }
        if self.mode & 0x02 != 0 {
            vf += self.vbp
        }
        if self.mode & 0x04 != 0 {
            vf += self.vhp
        }
        (self.vnf + vf + self.mixer_dc) * self.vol as i32
    }

    // ---- register writes -------------------------------------------------

    #[inline(always)]
    pub fn write_fc_lo(&mut self, val: u8) {
        self.fc = (self.fc & 0x7F8) | (val as u16 & 0x007);
        self.set_w0();
    }

    #[inline(always)]
    pub fn write_fc_hi(&mut self, val: u8) {
        self.fc = ((val as u16) << 3) | (self.fc & 0x007);
        self.set_w0();
    }

    #[inline(always)]
    pub fn write_res_filt(&mut self, val: u8) {
        self.res = (val >> 4) & 0x0F;
        self.filt = val & 0x0F;
        self.set_q();
    }

    /// MODE_VOL: VOICE-3-OFF (bit7) / filter mode (bits 6..4) / volume (bits 3..0).
    #[inline(always)]
    pub fn write_mode_vol(&mut self, val: u8) {
        self.voice3off = val & 0x80 != 0;
        self.mode = (val >> 4) & 0x07;
        self.vol = val & 0x0F;
    }

    /// Reconstruct the last `MODE_VOL` byte from the decomposed fields.
    ///
    /// `MODE_VOL` is write-only on the chip; this lets the high-level API
    /// read-modify-write instead of clobbering bits it does not own.
    #[inline(always)]
    pub fn mode_vol_byte(&self) -> u8 {
        ((self.voice3off as u8) << 7) | (self.mode << 4) | self.vol
    }

    // ---- coefficient derivation -----------------------------------------

    /// Map the 11-bit cutoff register to `w0` via the non-linear curve.
    #[inline(always)]
    fn set_w0(&mut self) {
        let f0 = cutoff_hz(self.fc, self.is_6581);
        let f0_ceil = if f0 > FC_CEIL_HZ { FC_CEIL_HZ } else { f0 };
        self.w0_ceil_1 = f0_ceil * W0_K / 1_000_000;
    }

    /// `q1024 = 1024 / Q`, `Q = 0.707 + res/15` (range ≈ [0.707, 1.707]).
    #[inline(always)]
    fn set_q(&mut self) {
        if !self.is_6581 && self.research_8580_resonance_calibration {
            self.q1024 = RESEARCH_8580_Q1024[self.res as usize];
            return;
        }
        let q_milli = 707 + (1000 * self.res as i64) / 15;
        self.q1024 = 1_024_000 / q_milli;
    }
}

/// Non-linear FC→cutoff-frequency map (`SID_ANALOG_SPEC.md` §6.2).
///
/// MIT-clean: the breakpoints reproduce the *documented* shape of each chip
/// model (6581: ~220 Hz→18 kHz tanh with a discontinuity at FCHI=0x80; 8580:
/// near-linear ~30 Hz→12.5 kHz). They are not copied from any measured
/// spline. Linear interpolation between breakpoints.
#[inline(always)]
fn cutoff_hz(fc: u16, is_6581: bool) -> i64 {
    // (FC register value, cutoff Hz) breakpoints, FC ascending.
    const PTS_6581: &[(i64, i64)] = &[
        (0, 220),
        (128, 235),
        (256, 250),
        (384, 300),
        (512, 430),
        (640, 760),
        (768, 1600),
        (896, 3200),
        (1023, 6000),
        (1024, 4600), // discontinuity at FCHI=0x80
        (1152, 7000),
        (1408, 12000),
        (1664, 16000),
        (2047, 18000),
    ];
    const PTS_8580: &[(i64, i64)] = &[
        (0, 30),
        (256, 1600),
        (512, 3300),
        (1024, 6500),
        (1536, 9800),
        (2047, 12500),
    ];

    let pts = if is_6581 { PTS_6581 } else { PTS_8580 };
    let x = fc as i64;
    let mut i = 0;
    while i + 1 < pts.len() && pts[i + 1].0 <= x {
        i += 1;
    }
    if i + 1 >= pts.len() {
        return pts[pts.len() - 1].1;
    }
    let (x0, y0) = pts[i];
    let (x1, y1) = pts[i + 1];
    if x1 == x0 {
        return y1;
    }
    y0 + (y1 - y0) * (x - x0) / (x1 - x0)
}
