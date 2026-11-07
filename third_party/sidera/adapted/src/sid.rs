use crate::extfilt::ExternalFilter;
use crate::filter::Filter;
use crate::registers::*;
use crate::voice::Voice;

/// SID chip model.
///
/// The two revisions differ audibly: the 6581 has analogue DC offsets (giving
/// an asymmetric, "reedy" tone and audible volume-write clicks) and a strongly
/// non-linear filter; the 8580 is cleaner, symmetric and near-linear.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChipModel {
    /// MOS 6581 (original C64). Default.
    Mos6581,
    /// MOS 8580 (C64C / later).
    Mos8580,
}

/// PAL SID master clock (Hz).
pub const PAL_CLOCK: u32 = 985_248;
/// NTSC SID master clock (Hz).
pub const NTSC_CLOCK: u32 = 1_022_727;

/// Final output divisor mapping the ~20-bit external-filter output to 16-bit,
/// a conventional full-scale normalisation
/// (`(0xFFF·0xFF >> 7) · 3 voices · 15 vol · 2 / 2¹⁶`).
const OUT_DIV: i32 = ((0xFFF * 0xFF) >> 7) * 3 * 15 * 2 / (1 << 16);

/// SID MOS 6581 / 8580 emulator (cycle-accurate core).
///
/// The engine runs internally at the chip clock (~985 kHz PAL) and decimates to
/// the requested audio sample rate; the C64 output RC network provides the
/// anti-alias low-pass. See `SID_ANALOG_SPEC.md` for the full model.
///
/// Usage: construct with a sample rate, write registers, and call
/// [`Sid::clock`] once per output sample.
pub struct Sid {
    voices: [Voice; 3],
    filter: Filter,
    extfilt: ExternalFilter,
    /// Output sample rate (Hz).
    sample_rate: u32,
    /// SID master clock (Hz).
    chip_clock: u32,
    /// Fractional cycle accumulator for the decimator (Bresenham).
    ///
    /// Stays in `[0, sample_rate + chip_clock)` — well under `u32::MAX` for any
    /// real audio rate — so the decimator divide is a 32-bit `udiv` (one
    /// instruction on 32-bit cores) rather than a 64-bit division libcall.
    cycle_frac: u32,
}

impl Sid {
    /// Create a SID in its power-on reset state (6581, PAL clock).
    ///
    /// `sample_rate` of 0 is clamped to 1 to keep [`Sid::clock`]'s decimator
    /// division well-defined (a 0 Hz output rate is meaningless anyway).
    pub const fn new(sample_rate: u32) -> Self {
        Self {
            // SID sync/ring routing: voice0←voice2, voice1←voice0, voice2←voice1.
            voices: [Voice::new(2), Voice::new(0), Voice::new(1)],
            filter: Filter::new(),
            extfilt: ExternalFilter::new(),
            sample_rate: if sample_rate == 0 { 1 } else { sample_rate },
            chip_clock: PAL_CLOCK,
            cycle_frac: 0,
        }
    }

    /// Reset to power-on state, preserving sample rate, clock, chip model and
    /// the explicitly selected Tetorica research resonance/cutoff configurations.
    pub fn reset(&mut self) {
        let sr = self.sample_rate;
        let clk = self.chip_clock;
        let is_6581 = self.voices[0].is_6581;
        let calibration = self.filter.resonance_calibration_8580();
        let cutoff_calibration = self.filter.cutoff_calibration_8580();
        *self = Self::new(sr);
        self.chip_clock = clk;
        self.set_model(if is_6581 {
            ChipModel::Mos6581
        } else {
            ChipModel::Mos8580
        });
        self.filter.set_8580_resonance_calibration(calibration);
        self.filter.set_8580_cutoff_calibration(cutoff_calibration);
    }

    /// Select the chip model (default [`ChipModel::Mos6581`]).
    pub fn set_model(&mut self, model: ChipModel) {
        let is_6581 = model == ChipModel::Mos6581;
        for v in self.voices.iter_mut() {
            v.is_6581 = is_6581;
        }
        self.filter.set_model(is_6581);
    }

    /// Tetorica research-only option, disabled by default. Enabling it affects
    /// only the 8580 resonance coefficient; 6581 behavior is unchanged.
    pub fn set_8580_resonance_calibration(&mut self, enabled: bool) {
        self.filter.set_8580_resonance_calibration(enabled);
    }

    pub fn resonance_calibration_8580(&self) -> bool {
        self.filter.resonance_calibration_8580()
    }

    /// Independent research cutoff mapping, disabled by default and inert on
    /// the 6581. Does not clock the chip or reset its integrator state.
    pub fn set_8580_cutoff_calibration(&mut self, enabled: bool) {
        self.filter.set_8580_cutoff_calibration(enabled);
    }

    pub fn cutoff_calibration_8580(&self) -> bool {
        self.filter.cutoff_calibration_8580()
    }

    /// Set the SID master clock (e.g. [`PAL_CLOCK`] or [`NTSC_CLOCK`]).
    pub fn set_chip_clock(&mut self, hz: u32) {
        self.chip_clock = hz;
    }

    /// Retained for API compatibility. The cycle-accurate engine derives the
    /// chip-clock / sample-rate ratio dynamically, so this is now a no-op.
    pub fn apply_sample_rate(&mut self) {}

    /// Produce one mono audio sample (`i16`).
    ///
    /// Internally advances the engine by `chip_clock / sample_rate` chip cycles
    /// (with exact fractional carry) and returns the band-limited output.
    #[inline]
    pub fn clock(&mut self) -> i16 {
        self.cycle_frac += self.chip_clock;
        let n = self.cycle_frac / self.sample_rate;
        self.cycle_frac %= self.sample_rate;

        for _ in 0..n {
            self.cycle_once();
        }

        self.output_sample()
    }

    /// Tetorica probe adaptation: advance exactly one SID chip cycle.
    ///
    /// This bypasses the output-rate decimator. The caller owns sample timing
    /// and may interleave non-clocking register accesses at every chip cycle.
    /// The returned value is the current upstream-normalised/clamped output.
    /// Do not mix this interface with `clock`/`clock_with_voices` in one run:
    /// their private fractional sample accumulator is deliberately untouched.
    #[inline]
    pub fn tick_cycle(&mut self) -> i16 {
        self.cycle_once();
        self.output_sample()
    }

    /// Produce one mono audio sample **and** the three per-voice outputs.
    ///
    /// The mixed `i16` is bit-identical to what [`Sid::clock`] returns for the
    /// same state — the filter, VOICE-3-OFF, mixer DC offset and master volume
    /// are all applied, exactly as in normal playback. In addition, the three
    /// voices' raw `output()` values are returned as captured on the **last**
    /// chip cycle of this output sample (post-sync, post-ring-mod, **pre-filter**
    /// and **pre-VOICE-3-OFF**).
    ///
    /// This is the routing hook for hosts that play one SID voice per mixer
    /// track: route each `voices[i]` to its own channel strip while still
    /// monitoring the faithful chip mix. **Their sum is deliberately NOT equal
    /// to the mixed sample**: everything the analogue stages do (filter routing,
    /// VOICE-3-OFF mute, mixer DC, master-volume scale, the output RC network)
    /// is present in the mix but absent from the per-voice values. Use the
    /// triplet to pan/route voices, never to reconstruct the mix.
    ///
    /// The per-voice values carry the 6581's large multiplying-DAC DC offset
    /// (`voice_dc`); sum them in a wide integer and let a high-pass / the host's
    /// own external filter remove the DC, just as the real C64 output network
    /// does. When the output rate meets or exceeds the chip clock (no chip cycle
    /// elapses for this sample) the triplet is all-zero.
    #[inline]
    pub fn clock_with_voices(&mut self) -> (i16, [i32; 3]) {
        self.cycle_frac += self.chip_clock;
        let n = self.cycle_frac / self.sample_rate;
        self.cycle_frac %= self.sample_rate;

        let mut voices = [0i32; 3];
        for _ in 0..n {
            voices = self.cycle_once();
        }

        (self.output_sample(), voices)
    }

    /// Band-limit, divide and clamp the current external-filter state to `i16`.
    #[inline(always)]
    fn output_sample(&self) -> i16 {
        let sample = self.extfilt.output() / OUT_DIV;
        if sample >= 32767 {
            32767
        } else if sample < -32768 {
            -32768
        } else {
            sample as i16
        }
    }

    /// One chip-cycle of the whole engine, in hardware order:
    /// envelopes → oscillators → hard sync → filter → external filter.
    ///
    /// Returns the three voices' `output()` values for this cycle (post-sync,
    /// pre-filter) so [`Sid::clock_with_voices`] can expose them; [`Sid::clock`]
    /// discards the return.
    #[inline(always)]
    fn cycle_once(&mut self) -> [i32; 3] {
        // 1. Envelopes.
        for v in self.voices.iter_mut() {
            v.env.clock();
        }

        // 2. Oscillators (advance accumulators; set msb_rising; clock noise).
        for v in self.voices.iter_mut() {
            v.osc.clock();
        }

        // 3. Hard sync. Use the pre-sync edge snapshot so resets don't cascade.
        let edge = [
            self.voices[0].osc.msb_rising,
            self.voices[1].osc.msb_rising,
            self.voices[2].osc.msb_rising,
        ];
        let sync_en = [
            self.voices[0].control & 0x02 != 0,
            self.voices[1].control & 0x02 != 0,
            self.voices[2].control & 0x02 != 0,
        ];
        for i in 0..3 {
            let m = self.voices[i].sync_source; // this voice's master
            let mm = self.voices[m].sync_source; // master's master
                                                 // Slave i resets unless its master is itself synced on this cycle.
            let reset = sync_en[i] && edge[m] && !(sync_en[m] && edge[mm]);
            if reset {
                self.voices[i].osc.accumulator = 0;
            }
        }

        // 4. Filter (also does routing, VOICE-3-OFF, mixer DC, volume).
        let acc = [
            self.voices[0].osc.accumulator,
            self.voices[1].osc.accumulator,
            self.voices[2].osc.accumulator,
        ];
        let o0 = self.voices[0].output(acc[self.voices[0].sync_source]);
        let o1 = self.voices[1].output(acc[self.voices[1].sync_source]);
        let o2 = self.voices[2].output(acc[self.voices[2].sync_source]);
        self.filter.clock(o0, o1, o2, 0);

        // 5. External RC filter.
        self.extfilt.clock(self.filter.output());

        [o0, o1, o2]
    }

    /// Write a SID register (`addr` = offset from `$D400`, `0x00..=0x1C`).
    pub fn write_register(&mut self, addr: u8, value: u8) {
        match addr {
            V1_FREQ_LO => self.voices[0].write_freq_lo(value),
            V1_FREQ_HI => self.voices[0].write_freq_hi(value),
            V1_PULSE_LO => self.voices[0].write_pulse_lo(value),
            V1_PULSE_HI => self.voices[0].write_pulse_hi(value),
            V1_CONTROL => self.voices[0].write_control(value),
            V1_ATTACK_DECAY => self.voices[0].write_attack_decay(value),
            V1_SUSTAIN_RELEASE => self.voices[0].write_sustain_release(value),

            V2_FREQ_LO => self.voices[1].write_freq_lo(value),
            V2_FREQ_HI => self.voices[1].write_freq_hi(value),
            V2_PULSE_LO => self.voices[1].write_pulse_lo(value),
            V2_PULSE_HI => self.voices[1].write_pulse_hi(value),
            V2_CONTROL => self.voices[1].write_control(value),
            V2_ATTACK_DECAY => self.voices[1].write_attack_decay(value),
            V2_SUSTAIN_RELEASE => self.voices[1].write_sustain_release(value),

            V3_FREQ_LO => self.voices[2].write_freq_lo(value),
            V3_FREQ_HI => self.voices[2].write_freq_hi(value),
            V3_PULSE_LO => self.voices[2].write_pulse_lo(value),
            V3_PULSE_HI => self.voices[2].write_pulse_hi(value),
            V3_CONTROL => self.voices[2].write_control(value),
            V3_ATTACK_DECAY => self.voices[2].write_attack_decay(value),
            V3_SUSTAIN_RELEASE => self.voices[2].write_sustain_release(value),

            FC_LO => self.filter.write_fc_lo(value),
            FC_HI => self.filter.write_fc_hi(value),
            RES_FILT => self.filter.write_res_filt(value),
            MODE_VOL => self.filter.write_mode_vol(value),

            _ => {}
        }
    }

    /// Last value written to `MODE_VOL` (`$18`), reconstructed from chip state.
    ///
    /// `MODE_VOL` is write-only on real hardware, so the high-level helpers in
    /// [`crate::high`] use this to read-modify-write rather than clobber the
    /// fields they do not own (e.g. setting the volume without disabling the
    /// filter). Layout: bit7 = VOICE-3-OFF, bits 6..4 = filter mode, bits 3..0
    /// = master volume.
    #[inline]
    pub fn mode_vol(&self) -> u8 {
        self.filter.mode_vol_byte()
    }

    /// Last value written to voice `voice`'s `CONTROL` register (`0..=2`).
    ///
    /// `CONTROL` is write-only on real hardware; this shadow lets the
    /// [`crate::high`] helpers preserve the bits they do not own (gate, sync,
    /// ring, test, waveform). Returns 0 for `voice > 2`.
    #[inline]
    pub fn control(&self, voice: u8) -> u8 {
        match voice {
            0..=2 => self.voices[voice as usize].control,
            _ => 0,
        }
    }

    /// Read a SID register. Only `OSC3` and `ENV3` (voice 3) are meaningful.
    pub fn read_register(&self, addr: u8) -> u8 {
        match addr {
            OSC3 => {
                let src = self.voices[2].sync_source;
                self.voices[2].read_osc(self.voices[src].osc.accumulator)
            }
            ENV3 => self.voices[2].read_env(),
            _ => 0,
        }
    }

    /// Draw a pseudo-random byte from the SID's noise generator — the
    /// Commodore 64's classic hardware entropy source.
    ///
    /// The noise waveform is produced by a 23-bit Fibonacci LFSR. C64 programs
    /// have always used it for randomness: set voice 3 to the noise waveform
    /// and read `OSC3` (`$D41B`). This helper does the equivalent directly —
    /// it advances voice 3's noise register and returns the 8-bit value the
    /// chip exposes at `OSC3`. Call it repeatedly for a byte stream, or combine
    /// several bytes for wider words.
    ///
    /// The register is advanced eight steps per call to decorrelate successive
    /// draws: the low output taps are entirely replaced by freshly fed-back
    /// bits and the high taps shift across, so consecutive bytes share far less
    /// state than a single shift would leave (one step moves only one tap into
    /// the next). It is not a *full* refresh — the highest tap, at bit 22, is
    /// not reached by feedback within eight steps — but it is ample for an RNG.
    /// Period: the LFSR's 2²³−1; the `TEST` bit reseeds it.
    ///
    /// Note: this is voice 3's *actual* noise register, shared with voice-3
    /// noise audio (exactly as on real hardware). For a pure RNG, simply keep
    /// voice 3 out of the audio mix.
    pub fn noise_byte(&mut self) -> u8 {
        let noise = &mut self.voices[2].osc.noise;
        for _ in 0..8 {
            noise.clock();
        }
        (noise.output() >> 4) as u8
    }
}
