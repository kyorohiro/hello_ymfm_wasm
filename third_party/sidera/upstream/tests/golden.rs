//! Golden-PCM regression tests.
//!
//! Each scenario drives the SID with a fixed register script for a fixed number
//! of samples and hashes the resulting `i16` stream (FNV-1a, stable across
//! platforms/Rust versions — no external deps). The hashes below lock the
//! current, oracle-verified behaviour: any change to the engine that alters the
//! output will flip a hash and fail here, pointing at exactly which scenario
//! changed. Update the constants deliberately (and re-verify vs the reSID 0.16
//! oracle) when an intentional behavioural change lands.

use sidera::registers::*;
use sidera::{ChipModel, Sid};

/// One register write at an absolute output-sample index.
struct W(u64, u8, u8);

/// Render `nsamples` of a scenario and return an FNV-1a hash of the PCM stream.
fn render_hash(model: ChipModel, writes: &[W], nsamples: u64) -> u64 {
    let mut sid = Sid::new(44_100);
    sid.set_model(model);
    let mut h: u64 = 0xcbf2_9ce4_8422_2325; // FNV-1a offset basis
    let mut wi = 0;
    for s in 0..nsamples {
        while wi < writes.len() && writes[wi].0 <= s {
            sid.write_register(writes[wi].1, writes[wi].2);
            wi += 1;
        }
        let sample = sid.clock();
        for b in sample.to_le_bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01b3); // FNV prime
        }
    }
    h
}

const N: u64 = 8192; // ~0.19 s per scenario

// Scenario builders ---------------------------------------------------------

fn s_saw_lp() -> Vec<W> {
    vec![
        W(0, V1_FREQ_LO, 0x45),
        W(0, V1_FREQ_HI, 0x1D),
        W(0, V1_SUSTAIN_RELEASE, 0xF0),
        W(0, FC_HI, 0x40),
        W(0, RES_FILT, 0x51),
        W(0, MODE_VOL, 0x1F),
        W(0, V1_CONTROL, 0x21),
    ]
}
fn s_combined_st() -> Vec<W> {
    vec![
        W(0, V1_FREQ_LO, 0x45),
        W(0, V1_FREQ_HI, 0x1D),
        W(0, V1_SUSTAIN_RELEASE, 0xF0),
        W(0, MODE_VOL, 0x0F),
        W(0, V1_CONTROL, 0x31),
    ]
}
fn s_combined_pst() -> Vec<W> {
    vec![
        W(0, V1_FREQ_LO, 0x45),
        W(0, V1_FREQ_HI, 0x1D),
        W(0, V1_PULSE_HI, 0x08),
        W(0, V1_SUSTAIN_RELEASE, 0xF0),
        W(0, MODE_VOL, 0x0F),
        W(0, V1_CONTROL, 0x71),
    ]
}
fn s_noise() -> Vec<W> {
    vec![
        W(0, V1_FREQ_LO, 0x00),
        W(0, V1_FREQ_HI, 0x20),
        W(0, V1_SUSTAIN_RELEASE, 0xF0),
        W(0, MODE_VOL, 0x0F),
        W(0, V1_CONTROL, 0x81),
    ]
}
fn s_sync() -> Vec<W> {
    vec![
        W(0, V1_FREQ_LO, 0x10),
        W(0, V1_FREQ_HI, 0x08), // master (voice0)
        W(0, V2_FREQ_LO, 0x45),
        W(0, V2_FREQ_HI, 0x1D),
        W(0, V2_SUSTAIN_RELEASE, 0xF0),
        W(0, MODE_VOL, 0x0F),
        W(0, V2_CONTROL, 0x23), // slave saw+sync+gate
    ]
}
fn s_adsr() -> Vec<W> {
    // attack/decay/sustain/release cycle, gate on then off mid-way.
    vec![
        W(0, V1_FREQ_LO, 0x45),
        W(0, V1_FREQ_HI, 0x1D),
        W(0, V1_ATTACK_DECAY, 0x4A),
        W(0, V1_SUSTAIN_RELEASE, 0x84),
        W(0, MODE_VOL, 0x0F),
        W(0, V1_CONTROL, 0x11),
        W(4000, V1_CONTROL, 0x10), // gate off → release
    ]
}
fn s_ringmod() -> Vec<W> {
    vec![
        W(0, V1_FREQ_LO, 0x10),
        W(0, V1_FREQ_HI, 0x04), // modulator (voice2 = ring src of v0)
        W(0, V3_FREQ_LO, 0x00),
        W(0, V3_FREQ_HI, 0x10),
        W(0, V1_SUSTAIN_RELEASE, 0xF0),
        W(0, MODE_VOL, 0x0F),
        W(0, V1_CONTROL, 0x15), // tri + ring + gate
    ]
}

/// (label, model, builder, expected FNV-1a hash)
fn scenarios() -> Vec<(&'static str, ChipModel, Vec<W>, u64)> {
    use ChipModel::*;
    vec![
        ("6581 saw+LP", Mos6581, s_saw_lp(), 0x3693_54f6_36ff_c526),
        (
            "6581 saw+tri",
            Mos6581,
            s_combined_st(),
            0x81a5_633b_106c_1d45,
        ),
        ("6581 pst", Mos6581, s_combined_pst(), 0x0ae9_1286_d528_0f7f),
        ("6581 noise", Mos6581, s_noise(), 0x107b_6eae_b70f_3084),
        ("6581 sync", Mos6581, s_sync(), 0x1df5_1332_cc0e_09b9),
        ("6581 adsr", Mos6581, s_adsr(), 0xe3f8_4aad_384a_ed2f),
        ("6581 ringmod", Mos6581, s_ringmod(), 0x8b45_8553_d8f9_0b46),
        ("8580 saw+LP", Mos8580, s_saw_lp(), 0xdea1_228b_59c3_5068),
        (
            "8580 saw+tri",
            Mos8580,
            s_combined_st(),
            0x3fa0_5f22_e2d3_02e3,
        ),
        ("8580 pst", Mos8580, s_combined_pst(), 0x5a31_0f44_17e8_e9f6),
    ]
}

// ---------------------------------------------------------------------------
// OSC3 waveform-table regression.
//
// Sweeps voice 3 over a full accumulator cycle (freq=0x1000 → the top 12
// accumulator bits advance by 1 per cycle) and hashes the 4096-entry OSC3
// table for each waveform setting. This locks the *waveform DAC* directly —
// in particular the combined-waveform model (saw+tri, pulse+tri, pulse+saw,
// pulse+saw+tri), whose shape/level was tuned against the reSID 0.16 oracle. These
// hashes are sidera's own output (no oracle data is embedded); re-verify the
// combined-waveform fidelity vs the reSID 0.16 oracle before updating them.
// ---------------------------------------------------------------------------

/// Sweep one waveform's OSC3 output over a full accumulator cycle, FNV-1a hash.
fn osc3_table_hash(model: ChipModel, ctrl: u8, pw: u16) -> u64 {
    let mut sid = Sid::new(985_248); // 1 chip cycle per clock() call
    sid.set_model(model);
    sid.write_register(V3_FREQ_LO, 0x00);
    sid.write_register(V3_FREQ_HI, 0x10); // freq = 0x1000
    sid.write_register(V3_PULSE_LO, (pw & 0xFF) as u8);
    sid.write_register(V3_PULSE_HI, ((pw >> 8) & 0x0F) as u8);
    sid.write_register(V3_CONTROL, ctrl);
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for _ in 0..4096 {
        let _ = sid.clock();
        h ^= sid.read_register(OSC3) as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

#[test]
fn golden_osc3_tables() {
    use ChipModel::*;
    // (label, model, control waveform byte, expected hash)
    let cases: &[(&str, ChipModel, u8, u64)] = &[
        ("6581 tri", Mos6581, 0x10, 0x2cdc_1fba_505b_5125),
        ("6581 saw", Mos6581, 0x20, 0xd1ca_eddf_1dbe_bd25),
        ("6581 pulse", Mos6581, 0x40, 0x1425_6e9a_60fa_3b25),
        ("6581 saw+tri", Mos6581, 0x30, 0xe0b3_4b85_a5c6_cbc5),
        ("6581 pulse+tri", Mos6581, 0x50, 0xb33a_148e_d3f5_d725),
        ("6581 pulse+saw", Mos6581, 0x60, 0xaa83_848d_243f_eea5),
        ("6581 pulse+saw+tri", Mos6581, 0x70, 0xaeab_17be_b7e5_8e35),
        ("8580 tri", Mos8580, 0x10, 0x2cdc_1fba_505b_5125),
        ("8580 saw", Mos8580, 0x20, 0xd1ca_eddf_1dbe_bd25),
        ("8580 pulse", Mos8580, 0x40, 0x1425_6e9a_60fa_3b25),
        ("8580 saw+tri", Mos8580, 0x30, 0x2b79_b710_3986_b525),
        ("8580 pulse+tri", Mos8580, 0x50, 0xcc56_2dfb_8b2e_1065),
        ("8580 pulse+saw", Mos8580, 0x60, 0x3a3b_0952_8c53_61e5),
        ("8580 pulse+saw+tri", Mos8580, 0x70, 0xae8e_8153_08db_e825),
    ];
    let mut mismatches = Vec::new();
    for (label, model, ctrl, expected) in cases {
        let got = osc3_table_hash(*model, *ctrl, 0x800);
        if got != *expected {
            mismatches.push(format!(
                "  {label:20} expected {expected:#018x}  got {got:#018x}"
            ));
        }
    }
    assert!(
        mismatches.is_empty(),
        "OSC3 table hash mismatch (waveform DAC output changed — re-verify the \
         combined-waveform fidelity vs the reSID 0.16 oracle, then update the \
         constants in tests/golden.rs):\n{}",
        mismatches.join("\n")
    );
}

#[test]
fn golden_pcm_regression() {
    let mut mismatches = Vec::new();
    for (label, model, writes, expected) in scenarios() {
        let got = render_hash(model, &writes, N);
        if got != expected {
            mismatches.push(format!(
                "  {label:16} expected {expected:#018x}  got {got:#018x}"
            ));
        }
    }
    assert!(
        mismatches.is_empty(),
        "golden PCM hash mismatch (engine output changed — re-verify vs the reSID 0.16 \
         oracle, then update the constants in tests/golden.rs):\n{}",
        mismatches.join("\n")
    );
}
