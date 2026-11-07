//! PCM renderer for fidelity comparison against the reSID 0.16 black-box oracle.
//!
//! Script format (one event per line):
//!   `<cycle> w <reg_hex> <val_hex>`   register write at absolute chip cycle
//!   `<cycle> end`                     stop
//! Lines starting with `#` and blank lines are ignored.
//!
//! Usage: `cargo run --release --example render -- <sample_rate> <6581|8580> <out.pcm>`
//! Script is read from stdin. Output is raw s16le mono.
//!
//! Register-write cycles are snapped to the nearest output-sample boundary
//! (sub-sample write timing is irrelevant for steady-state spectral checks;
//! sync/PWM timing is handled per-cycle inside the engine regardless).

use sidera::{ChipModel, Sid, PAL_CLOCK};
use std::io::{Read, Write};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let sample_rate: u32 = args.get(1).map(|s| s.parse().unwrap()).unwrap_or(44100);
    let model = match args.get(2).map(|s| s.as_str()) {
        Some("8580") => ChipModel::Mos8580,
        _ => ChipModel::Mos6581,
    };
    let out_path = args.get(3).cloned().unwrap_or_else(|| "out.pcm".into());

    let mut script = String::new();
    std::io::stdin().read_to_string(&mut script).unwrap();

    // Parse events; convert chip cycle → sample index.
    let cyc_to_sample =
        |cyc: u64| -> u64 { (cyc * sample_rate as u64 + PAL_CLOCK as u64 / 2) / PAL_CLOCK as u64 };

    // (sample_index, reg, val) writes, and an end sample.
    let mut writes: Vec<(u64, u8, u8)> = Vec::new();
    let mut end_sample: u64 = 0;
    for line in script.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let tok: Vec<&str> = line.split_whitespace().collect();
        let cyc: u64 = tok[0].parse().unwrap();
        match tok[1] {
            "w" => {
                let reg = u8::from_str_radix(tok[2].trim_start_matches("0x"), 16).unwrap();
                let val = u8::from_str_radix(tok[3].trim_start_matches("0x"), 16).unwrap();
                writes.push((cyc_to_sample(cyc), reg, val));
            }
            "end" => end_sample = cyc_to_sample(cyc),
            _ => {}
        }
    }
    writes.sort_by_key(|w| w.0);

    let mut sid = Sid::new(sample_rate);
    sid.set_model(model);

    let mut pcm: Vec<u8> = Vec::with_capacity(end_sample as usize * 2);
    let mut wi = 0;
    for s in 0..end_sample {
        while wi < writes.len() && writes[wi].0 <= s {
            sid.write_register(writes[wi].1, writes[wi].2);
            wi += 1;
        }
        let sample = sid.clock();
        pcm.extend_from_slice(&sample.to_le_bytes());
    }

    let mut min = i16::MAX;
    let mut max = i16::MIN;
    for c in pcm.chunks_exact(2) {
        let v = i16::from_le_bytes([c[0], c[1]]);
        min = min.min(v);
        max = max.max(v);
    }
    eprintln!(
        "rendered {} samples ({:.4}s) min={} max={}",
        end_sample,
        end_sample as f64 / sample_rate as f64,
        min,
        max
    );

    if out_path == "-" {
        std::io::stdout().write_all(&pcm).unwrap();
    } else {
        std::fs::write(&out_path, &pcm).unwrap();
    }
}
