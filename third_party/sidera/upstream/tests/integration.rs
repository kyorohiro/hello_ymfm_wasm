//! Integration tests for `sidera`.
//!
//! These tests exercise the public API only (`Sid` + `registers`).
//! Internal types are no longer re-exported; unit-level behaviour is verified
//! through observable side-effects on the SID output.

use sidera::registers::*;
use sidera::{ChipModel, Sid};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/// Run `sid.clock()` for `n` samples and return `(any_nonzero, min, max)`.
fn run(sid: &mut Sid, n: usize) -> (bool, i16, i16) {
    let mut any_nonzero = false;
    let mut min = i16::MAX;
    let mut max = i16::MIN;
    for _ in 0..n {
        let s = sid.clock();
        if s != 0 {
            any_nonzero = true;
        }
        if s < min {
            min = s;
        }
        if s > max {
            max = s;
        }
    }
    (any_nonzero, min, max)
}

/// Warm up `warm` samples (long enough for the 6581 DC transient to settle
/// through the ~16 Hz external high-pass), then return the peak |sample| over
/// the next `n` samples. Used by "silence" tests, since the cycle-accurate
/// 6581 emits a realistic turn-on/gate DC thump that decays over a few ms.
fn peak_after(sid: &mut Sid, warm: usize, n: usize) -> i32 {
    for _ in 0..warm {
        sid.clock();
    }
    let mut peak = 0i32;
    for _ in 0..n {
        peak = peak.max((sid.clock() as i32).abs());
    }
    peak
}

// ---------------------------------------------------------------------------
// Oscillator (observed via SID output)
// ---------------------------------------------------------------------------

#[test]
fn oscillator_saw_produces_output() {
    let mut sid = Sid::new(44100);
    sid.write_register(V1_FREQ_LO, 0x00);
    sid.write_register(V1_FREQ_HI, 0x10);
    sid.write_register(V1_ATTACK_DECAY, 0x00);
    sid.write_register(V1_SUSTAIN_RELEASE, 0xFF);
    sid.write_register(V1_CONTROL, CTRL_GATE | CTRL_SAW);
    sid.write_register(MODE_VOL, 0x0F);

    let (nonzero, _, _) = run(&mut sid, 1000);
    assert!(nonzero, "sawtooth should produce non-zero output");
}

#[test]
fn oscillator_wrap_resets_with_sync() {
    // Verify that oscillator sync resets the slave phase by checking that
    // the slave oscillator (voice 0) never reaches a high phase value when
    // driven by a faster master (voice 2) with sync enabled.
    //
    // Strategy: run the SID, read OSC3 (which is actually voice 2) to confirm
    // the master is running, then verify that with CTRL_SYNC the slave output
    // differs from the master-only baseline.
    //
    // We use a very high master frequency so it wraps many times per sample
    // window, forcing voice 0 to reset frequently.
    let make_sid = |sync_on: bool| -> Sid {
        let mut sid = Sid::new(44100);
        // Voice 0 (V1): low frequency slave.
        sid.write_register(V1_FREQ_LO, 0x10);
        sid.write_register(V1_FREQ_HI, 0x01);
        sid.write_register(V1_ATTACK_DECAY, 0x00);
        sid.write_register(V1_SUSTAIN_RELEASE, 0xFF);
        let ctrl = if sync_on {
            CTRL_GATE | CTRL_SAW | CTRL_SYNC
        } else {
            CTRL_GATE | CTRL_SAW
        };
        sid.write_register(V1_CONTROL, ctrl);
        // Voice 2 (V3): high-frequency master (wraps ~256× more often than voice 0).
        sid.write_register(V3_FREQ_LO, 0x00);
        sid.write_register(V3_FREQ_HI, 0xFF);
        // Master needs to be running but can be silent (no GATE needed for sync).
        sid.write_register(V3_CONTROL, CTRL_SAW);
        sid.write_register(MODE_VOL, 0x0F);
        sid
    };

    // Warm up both SIDs identically for 100 samples so the envelope is
    // non-zero before we start comparing.
    let mut sid_plain = make_sid(false);
    let mut sid_sync = make_sid(true);
    for _ in 0..100 {
        sid_plain.clock();
        sid_sync.clock();
    }

    // After warm-up, the sync SID resets voice 0 on every master wrap,
    // which happens very frequently at freq_hi=0xFF. The two outputs must differ.
    let mut diff: i64 = 0;
    for _ in 0..4000 {
        diff += (sid_plain.clock() as i64 - sid_sync.clock() as i64).unsigned_abs() as i64;
    }
    assert!(diff > 0, "oscillator sync should alter voice 0 output");
}

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

#[test]
fn noise_waveform_produces_output() {
    let mut sid = Sid::new(44100);
    sid.write_register(V1_FREQ_LO, 0x00);
    sid.write_register(V1_FREQ_HI, 0x10);
    sid.write_register(V1_ATTACK_DECAY, 0x00);
    sid.write_register(V1_SUSTAIN_RELEASE, 0xFF);
    sid.write_register(V1_CONTROL, CTRL_GATE | CTRL_NOISE);
    sid.write_register(MODE_VOL, 0x0F);

    let (nonzero, _, _) = run(&mut sid, 2000);
    assert!(nonzero, "noise waveform should produce non-zero output");
}

#[test]
fn noise_varies_with_frequency() {
    // At a higher frequency, bit 19 of the phase toggles more often,
    // so the LFSR produces a denser noise stream.
    // The outputs at two different frequencies should differ.
    let mut sid_lo = Sid::new(44100);
    sid_lo.write_register(V1_FREQ_HI, 0x01);
    sid_lo.write_register(V1_ATTACK_DECAY, 0x00);
    sid_lo.write_register(V1_SUSTAIN_RELEASE, 0xFF);
    sid_lo.write_register(V1_CONTROL, CTRL_GATE | CTRL_NOISE);
    sid_lo.write_register(MODE_VOL, 0x0F);

    let mut sid_hi = Sid::new(44100);
    sid_hi.write_register(V1_FREQ_HI, 0x40);
    sid_hi.write_register(V1_ATTACK_DECAY, 0x00);
    sid_hi.write_register(V1_SUSTAIN_RELEASE, 0xFF);
    sid_hi.write_register(V1_CONTROL, CTRL_GATE | CTRL_NOISE);
    sid_hi.write_register(MODE_VOL, 0x0F);

    let mut diff = 0i64;
    for _ in 0..2000 {
        diff += (sid_lo.clock() as i64 - sid_hi.clock() as i64).unsigned_abs() as i64;
    }
    assert!(
        diff > 0,
        "noise should vary between different oscillator frequencies"
    );
}

// ---------------------------------------------------------------------------
// ADSR envelope
// ---------------------------------------------------------------------------

#[test]
fn envelope_attack_then_sustain() {
    // With fast attack (0) and high sustain (F), after enough samples the
    // output should stabilise at the sustain level (non-zero, non-maximum).
    let mut sid = Sid::new(44100);
    sid.write_register(V1_FREQ_LO, 0x00);
    sid.write_register(V1_FREQ_HI, 0x10);
    sid.write_register(V1_ATTACK_DECAY, 0x00); // fast attack + decay
    sid.write_register(V1_SUSTAIN_RELEASE, 0xF0); // sustain=15, release=0
    sid.write_register(V1_CONTROL, CTRL_GATE | CTRL_SAW);
    sid.write_register(MODE_VOL, 0x0F);

    // Burn through attack and decay phases.
    for _ in 0..5000 {
        sid.clock();
    }

    // In sustain the output should be non-zero and stable.
    let s1 = sid.clock();
    let s2 = sid.clock();
    assert!(s1 != 0, "output should be non-zero during sustain");
    // Allow a small deviation (waveform oscillates) but no silent gap.
    let _ = s2; // just assert it doesn't panic
}

#[test]
fn envelope_release_reaches_silence() {
    let mut sid = Sid::new(44100);
    sid.write_register(V1_FREQ_HI, 0x10);
    sid.write_register(V1_ATTACK_DECAY, 0x00); // fast
    sid.write_register(V1_SUSTAIN_RELEASE, 0xF0);
    sid.write_register(V1_CONTROL, CTRL_GATE | CTRL_SAW);
    sid.write_register(MODE_VOL, 0x0F);

    // Reach sustain.
    for _ in 0..5000 {
        sid.clock();
    }

    // Gate off → release.
    sid.write_register(V1_CONTROL, CTRL_SAW); // GATE cleared

    // Run long enough to complete release (fast release = 0).
    for _ in 0..5000 {
        sid.clock();
    }

    let s = sid.clock();
    assert_eq!(s, 0, "output should be silent after release completes");
}

#[test]
fn noise_byte_is_entropic() {
    // The SID noise LFSR is the C64 hardware RNG; noise_byte() must yield a
    // varied, well-spread stream (not constant, decent distinct count).
    let mut sid = Sid::new(44100);
    let mut seen = [0u32; 256];
    let n = 4096;
    for _ in 0..n {
        seen[sid.noise_byte() as usize] += 1;
    }
    let distinct = seen.iter().filter(|&&c| c > 0).count();
    let max_bucket = *seen.iter().max().unwrap();
    assert!(
        distinct > 200,
        "noise should cover most byte values (distinct={distinct})"
    );
    assert!(
        max_bucket < n / 8,
        "no byte value should dominate (max bucket={max_bucket} of {n})"
    );
}

#[test]
fn envelope_idle_without_gate() {
    let mut sid = Sid::new(44100);
    sid.write_register(V1_FREQ_HI, 0x10);
    sid.write_register(V1_CONTROL, CTRL_SAW); // no GATE
    sid.write_register(MODE_VOL, 0x0F);

    // The 6581 emits a brief DC thump at turn-on (voice/mixer DC offsets passing
    // through the external high-pass); after it settles there must be no tone,
    // because the envelope is frozen at zero.
    let peak = peak_after(&mut sid, 4000, 2000);
    assert!(peak <= 2, "no sustained output without GATE (peak={peak})");
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

#[test]
fn filter_lp_passes_dc() {
    let mut sid = Sid::new(44100);
    // Route all voices through the filter (default filt_voices = 0x07).
    sid.write_register(RES_FILT, 0x0F); // resonance=0, all voices filtered
    sid.write_register(FC_LO, 0x07);
    sid.write_register(FC_HI, 0x00); // very low cutoff
    sid.write_register(MODE_VOL, 0x1F); // LP mode + max volume

    sid.write_register(V1_FREQ_HI, 0x10);
    sid.write_register(V1_ATTACK_DECAY, 0x00);
    sid.write_register(V1_SUSTAIN_RELEASE, 0xFF);
    sid.write_register(V1_CONTROL, CTRL_GATE | CTRL_SAW);

    // Let the filter settle.
    for _ in 0..500 {
        sid.clock();
    }

    // With a very low cutoff LP filter, high-frequency content is attenuated.
    // The absolute output should be smaller than unfiltered.
    let mut sum: i64 = 0;
    for _ in 0..1000 {
        sum += sid.clock().unsigned_abs() as i64;
    }
    let mean_filtered = sum / 1000;

    // Compare to bypassed filter (mode = 0 → pass-through).
    let mut sid2 = Sid::new(44100);
    sid2.write_register(V1_FREQ_HI, 0x10);
    sid2.write_register(V1_ATTACK_DECAY, 0x00);
    sid2.write_register(V1_SUSTAIN_RELEASE, 0xFF);
    sid2.write_register(V1_CONTROL, CTRL_GATE | CTRL_SAW);
    sid2.write_register(MODE_VOL, 0x0F); // no filter (mode=0)
    for _ in 0..500 {
        sid2.clock();
    }
    let mut sum2: i64 = 0;
    for _ in 0..1000 {
        sum2 += sid2.clock().unsigned_abs() as i64;
    }
    let mean_direct = sum2 / 1000;

    assert!(
        mean_filtered < mean_direct,
        "LP filter at very low cutoff should attenuate: filtered={mean_filtered}, direct={mean_direct}"
    );
}

#[test]
fn filter_stable_does_not_overflow() {
    // Stress-test the filter with a loud signal for many samples.
    let mut sid = Sid::new(44100);
    sid.write_register(RES_FILT, 0xFF); // max resonance, all voices
    sid.write_register(FC_HI, 0x7F);
    sid.write_register(MODE_VOL, 0x7F); // LP+BP mode, max volume
    sid.write_register(V1_FREQ_HI, 0x40);
    sid.write_register(V1_ATTACK_DECAY, 0x00);
    sid.write_register(V1_SUSTAIN_RELEASE, 0xFF);
    sid.write_register(V1_CONTROL, CTRL_GATE | CTRL_SAW | CTRL_NOISE);

    for _ in 0..10_000 {
        let s = sid.clock();
        // i16 is always in [-32768, 32767] by type; verify no panic occurred.
        let _ = s;
    }
}

// ---------------------------------------------------------------------------
// Full SID
// ---------------------------------------------------------------------------

#[test]
fn sid_all_three_voices_contribute() {
    // Each voice individually produces output; together they should differ
    // from any single voice alone.
    let make = |v1: u8, v2: u8, v3: u8| -> Vec<i16> {
        let mut sid = Sid::new(44100);
        sid.write_register(V1_FREQ_HI, 0x10);
        sid.write_register(V2_FREQ_HI, 0x20);
        sid.write_register(V3_FREQ_HI, 0x30);
        let ad = 0x00u8;
        let sr = 0xF0u8;
        for (ctrl, a, s) in [
            (V1_CONTROL, V1_ATTACK_DECAY, V1_SUSTAIN_RELEASE),
            (V2_CONTROL, V2_ATTACK_DECAY, V2_SUSTAIN_RELEASE),
            (V3_CONTROL, V3_ATTACK_DECAY, V3_SUSTAIN_RELEASE),
        ] {
            sid.write_register(a, ad);
            sid.write_register(s, sr);
            sid.write_register(ctrl, 0x00); // all off initially
        }
        if v1 != 0 {
            sid.write_register(V1_CONTROL, v1);
        }
        if v2 != 0 {
            sid.write_register(V2_CONTROL, v2);
        }
        if v3 != 0 {
            sid.write_register(V3_CONTROL, v3);
        }
        sid.write_register(MODE_VOL, 0x0F);
        (0..1000).map(|_| sid.clock()).collect()
    };

    let on = CTRL_GATE | CTRL_SAW;
    let one = make(on, 0, 0);
    let all = make(on, on, on);

    let diff: i64 = one
        .iter()
        .zip(all.iter())
        .map(|(&a, &b)| (a as i64 - b as i64).unsigned_abs() as i64)
        .sum();
    assert!(
        diff > 0,
        "three voices should produce a different mix than one"
    );
}

#[test]
fn sid_reset_silences_output() {
    let mut sid = Sid::new(44100);
    sid.write_register(V1_FREQ_HI, 0x10);
    sid.write_register(V1_ATTACK_DECAY, 0x00);
    sid.write_register(V1_SUSTAIN_RELEASE, 0xFF);
    sid.write_register(V1_CONTROL, CTRL_GATE | CTRL_SAW);
    sid.write_register(MODE_VOL, 0x0F);

    for _ in 0..200 {
        sid.clock();
    }
    sid.reset();

    // After reset: volume = 0, all gates off → silence.
    let s = sid.clock();
    assert_eq!(s, 0, "after reset the output must be silent");
}

#[test]
fn sid_output_always_clamped_to_i16() {
    let mut sid = Sid::new(44100);
    for (ctrl, ad, sr, fhi) in [
        (V1_CONTROL, V1_ATTACK_DECAY, V1_SUSTAIN_RELEASE, V1_FREQ_HI),
        (V2_CONTROL, V2_ATTACK_DECAY, V2_SUSTAIN_RELEASE, V2_FREQ_HI),
        (V3_CONTROL, V3_ATTACK_DECAY, V3_SUSTAIN_RELEASE, V3_FREQ_HI),
    ] {
        sid.write_register(fhi, 0x7F);
        sid.write_register(ad, 0x00);
        sid.write_register(sr, 0xFF);
        sid.write_register(ctrl, CTRL_GATE | CTRL_SAW | CTRL_NOISE | CTRL_PULSE);
    }
    sid.write_register(MODE_VOL, 0xFF);

    for _ in 0..2000 {
        let s = sid.clock();
        // i16 is always in [-32768, 32767] by type; verify no panic occurred.
        let _ = s;
    }
}

#[test]
fn sid_pulse_waveform() {
    let mut sid = Sid::new(44100);
    sid.write_register(V1_FREQ_HI, 0x10);
    sid.write_register(V1_PULSE_LO, 0x00);
    sid.write_register(V1_PULSE_HI, 0x08); // 50 % duty cycle
    sid.write_register(V1_ATTACK_DECAY, 0x00);
    sid.write_register(V1_SUSTAIN_RELEASE, 0xF0);
    sid.write_register(V1_CONTROL, CTRL_GATE | CTRL_PULSE);
    sid.write_register(MODE_VOL, 0x0F);

    let (nonzero, _, _) = run(&mut sid, 2000);
    assert!(nonzero, "pulse waveform should produce non-zero output");
}

#[test]
fn sid_triangle_waveform() {
    let mut sid = Sid::new(44100);
    sid.write_register(V1_FREQ_HI, 0x10);
    sid.write_register(V1_ATTACK_DECAY, 0x00);
    sid.write_register(V1_SUSTAIN_RELEASE, 0xF0);
    sid.write_register(V1_CONTROL, CTRL_GATE | CTRL_TRI);
    sid.write_register(MODE_VOL, 0x0F);

    let (nonzero, min, max) = run(&mut sid, 2000);
    assert!(nonzero, "triangle should produce non-zero output");
    // Triangle is centred; both positive and negative excursions expected.
    assert!(max > 0, "triangle should reach positive values");
    assert!(min < 0, "triangle should reach negative values");
}

#[test]
fn sid_ring_modulation_changes_output() {
    // With ring mod, voice 1 triangle is modulated by voice 3 MSB.
    // Output with CTRL_RING differs from output without.
    let mut sid_plain = Sid::new(44100);
    sid_plain.write_register(V1_FREQ_HI, 0x10);
    sid_plain.write_register(V3_FREQ_HI, 0x30);
    sid_plain.write_register(V1_ATTACK_DECAY, 0x00);
    sid_plain.write_register(V1_SUSTAIN_RELEASE, 0xFF);
    sid_plain.write_register(V3_CONTROL, CTRL_TRI);
    sid_plain.write_register(V1_CONTROL, CTRL_GATE | CTRL_TRI); // no ring
    sid_plain.write_register(MODE_VOL, 0x0F);

    let mut sid_ring = Sid::new(44100);
    sid_ring.write_register(V1_FREQ_HI, 0x10);
    sid_ring.write_register(V3_FREQ_HI, 0x30);
    sid_ring.write_register(V1_ATTACK_DECAY, 0x00);
    sid_ring.write_register(V1_SUSTAIN_RELEASE, 0xFF);
    sid_ring.write_register(V3_CONTROL, CTRL_TRI);
    sid_ring.write_register(V1_CONTROL, CTRL_GATE | CTRL_TRI | CTRL_RING);
    sid_ring.write_register(MODE_VOL, 0x0F);

    let mut diff: i64 = 0;
    for _ in 0..2000 {
        diff += (sid_plain.clock() as i64 - sid_ring.clock() as i64).unsigned_abs() as i64;
    }
    assert!(diff > 0, "ring modulation should change the output");
}

// ---------------------------------------------------------------------------
// High-level API (read-modify-write of write-only registers)
// ---------------------------------------------------------------------------

#[test]
fn high_level_mode_vol_helpers_compose() {
    use sidera::high::{set_filter, set_voice3_off, set_volume, FilterMode};

    let mut sid = Sid::new(44100);
    set_volume(&mut sid, 10);
    set_filter(&mut sid, 1000, 50, FilterMode::LowPass, 0x01);
    // set_filter must NOT clobber the volume (it used to force 15).
    assert_eq!(
        sid.mode_vol() & 0x0F,
        10,
        "volume preserved through set_filter"
    );
    assert_eq!(sid.mode_vol() & 0x70, 0x10, "LP mode set");

    set_voice3_off(&mut sid, true);
    assert_eq!(
        sid.mode_vol() & 0x0F,
        10,
        "volume preserved through set_voice3_off"
    );
    assert_eq!(
        sid.mode_vol() & 0x70,
        0x10,
        "filter mode preserved through set_voice3_off"
    );
    assert_eq!(sid.mode_vol() & 0x80, 0x80, "VOICE-3-OFF set");

    // set_volume must keep filter mode + VOICE-3-OFF (it used to zero them).
    set_volume(&mut sid, 7);
    assert_eq!(
        sid.mode_vol(),
        0x80 | 0x10 | 7,
        "set_volume keeps mode + v3off"
    );
}

#[test]
fn high_level_note_helpers_preserve_sync_ring() {
    use sidera::high::{note_off, note_on, set_waveform, Waveform};

    let mut sid = Sid::new(44100);
    set_waveform(&mut sid, 0, Waveform::Triangle, true, true); // sync + ring
    note_on(&mut sid, 0, Waveform::Triangle);
    let c = sid.control(0);
    assert_ne!(c & CTRL_SYNC, 0, "sync preserved through note_on");
    assert_ne!(c & CTRL_RING, 0, "ring preserved through note_on");
    assert_ne!(c & CTRL_GATE, 0, "gate set by note_on");

    note_off(&mut sid, 0, Waveform::Triangle);
    let c = sid.control(0);
    assert_eq!(c & CTRL_GATE, 0, "gate cleared by note_off");
    assert_ne!(c & CTRL_SYNC, 0, "sync preserved through note_off");
    assert_ne!(c & CTRL_TRI, 0, "waveform preserved through note_off");
}

// ---------------------------------------------------------------------------
// Per-voice routing hook (clock_with_voices)
// ---------------------------------------------------------------------------

#[test]
fn clock_with_voices_mix_matches_clock() {
    // The mixed i16 from clock_with_voices() must be bit-identical to clock()
    // for an identical state history: the routing hook is purely additive and
    // must not perturb the faithful chip mix.
    let script = |sid: &mut Sid| {
        sid.write_register(V1_FREQ_LO, 0x45);
        sid.write_register(V1_FREQ_HI, 0x1D);
        sid.write_register(V1_SUSTAIN_RELEASE, 0xF0);
        sid.write_register(V2_FREQ_HI, 0x20);
        sid.write_register(V2_SUSTAIN_RELEASE, 0xF0);
        sid.write_register(V3_FREQ_HI, 0x30);
        sid.write_register(V3_SUSTAIN_RELEASE, 0xF0);
        sid.write_register(FC_HI, 0x40);
        sid.write_register(RES_FILT, 0x51); // voice 1 filtered, resonance
        sid.write_register(MODE_VOL, 0x1F); // LP + max volume
        sid.write_register(V1_CONTROL, CTRL_GATE | CTRL_SAW);
        sid.write_register(V2_CONTROL, CTRL_GATE | CTRL_TRI);
        sid.write_register(V3_CONTROL, CTRL_GATE | CTRL_PULSE);
    };

    let mut sid_plain = Sid::new(44100);
    let mut sid_hook = Sid::new(44100);
    script(&mut sid_plain);
    script(&mut sid_hook);

    for s in 0..8192u64 {
        // Gate voice 1 off mid-way to also exercise the release path.
        if s == 4000 {
            sid_plain.write_register(V1_CONTROL, CTRL_SAW);
            sid_hook.write_register(V1_CONTROL, CTRL_SAW);
        }
        let a = sid_plain.clock();
        let (b, _voices) = sid_hook.clock_with_voices();
        assert_eq!(
            a, b,
            "mixed output diverged at sample {s}: clock={a}, hook={b}"
        );
    }
}

#[test]
fn clock_with_voices_isolates_active_voice() {
    // Drive only voice 0. On the 8580 (no voice DC offset) an idle voice's raw
    // output is exactly 0, so the routing triplet must show energy on voice 0
    // and silence on voices 1 and 2 — proving per-voice separation.
    let mut sid = Sid::new(44100);
    sid.set_model(ChipModel::Mos8580);
    sid.write_register(V1_FREQ_HI, 0x10);
    sid.write_register(V1_ATTACK_DECAY, 0x00);
    sid.write_register(V1_SUSTAIN_RELEASE, 0xF0);
    sid.write_register(V1_CONTROL, CTRL_GATE | CTRL_SAW);
    sid.write_register(MODE_VOL, 0x0F);

    let mut peak = [0i32; 3];
    for _ in 0..2000 {
        let (_mix, v) = sid.clock_with_voices();
        for i in 0..3 {
            peak[i] = peak[i].max(v[i].abs());
        }
    }
    assert!(
        peak[0] > 0,
        "active voice 0 should carry energy (peak={})",
        peak[0]
    );
    assert_eq!(
        peak[1], 0,
        "idle voice 1 must be silent on 8580 (peak={})",
        peak[1]
    );
    assert_eq!(
        peak[2], 0,
        "idle voice 2 must be silent on 8580 (peak={})",
        peak[2]
    );
}

#[test]
fn sid_no_panic_on_all_register_addresses() {
    let mut sid = Sid::new(44100);
    for addr in 0x00u8..=0x1C {
        sid.write_register(addr, 0xFF);
    }
    let _ = sid.read_register(OSC3);
    let _ = sid.read_register(ENV3);
    // Just verifying no panic / out-of-bounds access.
}

#[test]
fn sid_read_osc3_zero_without_oscillator() {
    let sid = Sid::new(44100);
    assert_eq!(sid.read_register(OSC3), 0);
}

#[test]
fn sid_saw_is_centred_no_dc_bias() {
    // The sawtooth waveform must be centred on zero: the mean over a full
    // cycle should be close to zero.
    let mut sid = Sid::new(44100);
    sid.write_register(V1_FREQ_LO, 0x00);
    sid.write_register(V1_FREQ_HI, 0x04); // low freq → many samples per cycle
    sid.write_register(V1_ATTACK_DECAY, 0x00);
    sid.write_register(V1_SUSTAIN_RELEASE, 0xFF);
    sid.write_register(V1_CONTROL, CTRL_GATE | CTRL_SAW);
    // Volume max, filter mode = 0 (bypass) so the SVF does not shift the mean.
    sid.write_register(MODE_VOL, 0x0F);

    // Let envelope reach sustain.
    for _ in 0..500 {
        sid.clock();
    }

    let mut sum: i64 = 0;
    // With the chip-clock / sample-rate scaling (PAL 985 248 Hz at 44 100 Hz):
    //   freq_reg = 0x0400  →  audio freq ≈ 60.1 Hz  →  cycle ≈ 733.4 samples.
    // Because the cycle length is not an integer, we cannot pick a sample count
    // that aligns exactly.  Instead we measure many cycles so that the partial
    // cycle at the end contributes negligible DC bias:
    //   max_bias ≈ peak / (4 × num_cycles) = 32767 / (4 × 30) ≈ 273  ≪  1500.
    const MEASURE: usize = 22_000; // ≈ 30 cycles
    for _ in 0..MEASURE {
        sum += sid.clock() as i64;
    }

    let mean = sum / MEASURE as i64;
    assert!(
        mean.abs() < 1500,
        "sawtooth mean over ~30 cycles should be near zero, got {mean}"
    );
}

#[test]
fn sid_voice3_off_mutes_voice3_from_mix() {
    // MODE_VOL bit 7 = VOICE 3 OFF: voice 2 should not appear in the audio mix,
    // but OSC3/ENV3 must still return valid values (voice keeps running).
    let mut sid_on = Sid::new(44100);
    let mut sid_off = Sid::new(44100);

    for sid in [&mut sid_on, &mut sid_off] {
        sid.write_register(V3_FREQ_HI, 0x20);
        sid.write_register(V3_ATTACK_DECAY, 0x00);
        sid.write_register(V3_SUSTAIN_RELEASE, 0xFF);
        sid.write_register(V3_CONTROL, CTRL_GATE | CTRL_SAW);
    }
    // sid_on:  MODE_VOL = 0x0F → voice 3 audible
    // sid_off: MODE_VOL = 0x8F → VOICE 3 OFF (bit 7 set)
    sid_on.write_register(MODE_VOL, 0x0F);
    sid_off.write_register(MODE_VOL, 0x8F);

    // Settle past the 6581 DC transient, then measure the steady-state peak.
    // ON: voice 3 is an audible tone. OFF: only the (constant) mixer DC remains,
    // which the external high-pass removes → silence.
    let peak_on = peak_after(&mut sid_on, 4000, 2000);
    let peak_off = peak_after(&mut sid_off, 4000, 2000);
    assert!(
        peak_on > 50,
        "voice 3 should be audible without VOICE 3 OFF (peak={peak_on})"
    );
    assert!(
        peak_off <= 2,
        "voice 3 should be silent with VOICE 3 OFF (peak={peak_off})"
    );

    // OSC3 must still update (oscillator keeps running silently).
    // At freq_hi=0x20, after 700 total samples the OSC3 byte = 128 ≠ 0.
    let osc3 = sid_off.read_register(OSC3);
    assert!(
        osc3 != 0,
        "OSC3 should still advance when VOICE 3 OFF is set"
    );
}

#[test]
fn envelope_decay_is_slower_at_low_levels() {
    // The SID exponential approximation slows the decay rate at lower levels.
    // Measure the number of samples spent in two equal-width ENV3 bands:
    //   upper band: ENV3 in 128..=255
    //   lower band: ENV3 in   1..=127
    // The lower band must take significantly longer (≥ 2×).
    //
    // Implementation notes:
    //   - Voice 2 (V3) is used because ENV3 reads the envelope of voice 2.
    //   - Gate stays ON throughout so the envelope stays in Decay (not Release).
    //   - sustain = 0 forces the decay to traverse the full range down to 0.
    //   - attack nibble = 0 (fast, ~2 ms) so we reach the peak quickly.
    //   - decay nibble = 4 (114 ms at 44100 Hz, DECAY_RATES[4] = 13).
    let mut sid = Sid::new(44100);
    sid.write_register(V3_FREQ_HI, 0x10);
    sid.write_register(V3_ATTACK_DECAY, 0x04); // attack=0 (fast), decay=4 (114 ms)
    sid.write_register(V3_SUSTAIN_RELEASE, 0x00); // sustain=0 → decay traverses full range
    sid.write_register(V3_CONTROL, CTRL_GATE | CTRL_SAW);
    sid.write_register(MODE_VOL, 0x0F);

    // Burn through the fast attack phase (~90 samples at rate 743).
    for _ in 0..200 {
        sid.clock();
    }

    // Gate remains ON: envelope is now in Decay, falling toward sustain=0.
    let mut samples_upper: u32 = 0;
    let mut samples_lower: u32 = 0;

    for _ in 0..500_000 {
        sid.clock();
        let env = sid.read_register(ENV3); // reads voice 2 envelope
        if env > 127 {
            samples_upper += 1;
        } else if env > 0 {
            samples_lower += 1;
        } else {
            break; // reached silence — done
        }
    }

    // Lower half should take at least 2× longer.
    // Simulation gives ~4.9× (exp segments: 1×, 3×, 9×).
    assert!(
        samples_lower > samples_upper * 2,
        "lower decay band should take longer: upper={samples_upper}, lower={samples_lower}"
    );
}

#[test]
fn envelope_register_update_takes_effect_immediately() {
    // Writing ATTACK_DECAY while the envelope is in Decay changes the active
    // rate. On the cycle-accurate chip the change is subject to the ADSR delay
    // bug (the 15-bit rate counter is never reset), so a switch to a *faster*
    // rate only takes effect after the counter wraps — but it does take effect.
    //
    // Strategy: two identical SIDs.
    // - sid_slow: stays at slow decay (nibble=9) throughout.
    // - sid_fast: switches to fast decay (nibble=0) mid-decay; after enough
    //   samples to clear the delay bug, ENV3 must be far lower than sid_slow.
    let make = || -> Sid {
        let mut sid = Sid::new(44100);
        sid.write_register(V3_FREQ_HI, 0x10);
        sid.write_register(V3_ATTACK_DECAY, 0x09); // attack=0, decay=9 (slow)
        sid.write_register(V3_SUSTAIN_RELEASE, 0x00); // sustain=0 → full decay range
        sid.write_register(V3_CONTROL, CTRL_GATE | CTRL_SAW);
        sid.write_register(MODE_VOL, 0x0F);
        // Burn fast attack (~90 samples).
        sid
    };

    let mut sid_slow = make();
    let mut sid_fast = make();

    // Attack phase.
    for _ in 0..200 {
        sid_slow.clock();
        sid_fast.clock();
    }

    // 500 samples of slow decay on both.
    for _ in 0..500 {
        sid_slow.clock();
        sid_fast.clock();
    }

    // Switch sid_fast to fast decay; sid_slow stays slow.
    sid_fast.write_register(V3_ATTACK_DECAY, 0x00); // nibble=0 (6 ms)

    // Run long enough to clear the ADSR delay-bug wrap, then let the now-fast
    // decay crash the level. sid_slow barely moves in the same window.
    for _ in 0..3000 {
        sid_slow.clock();
        sid_fast.clock();
    }

    let env_slow = sid_slow.read_register(ENV3);
    let env_fast = sid_fast.read_register(ENV3);

    assert!(
        env_fast < env_slow,
        "live decay update should lower the level faster: slow={env_slow}, fast={env_fast}"
    );
}
