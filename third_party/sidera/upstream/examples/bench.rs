//! Throughput micro-benchmark: render N seconds of audio and report
//! cycles/sample-rate ratio and samples/sec. `cargo run --release --example bench`.
use sidera::registers::*;
use sidera::Sid;
use std::time::Instant;

fn setup(active_voices: usize, filtered: bool) -> Sid {
    let mut sid = Sid::new(44_100);
    let blocks = [
        (V1_FREQ_HI, V1_ATTACK_DECAY, V1_SUSTAIN_RELEASE, V1_CONTROL),
        (V2_FREQ_HI, V2_ATTACK_DECAY, V2_SUSTAIN_RELEASE, V2_CONTROL),
        (V3_FREQ_HI, V3_ATTACK_DECAY, V3_SUSTAIN_RELEASE, V3_CONTROL),
    ];
    for (i, (fhi, ad, sr, ctrl)) in blocks.iter().enumerate() {
        sid.write_register(*fhi, 0x10 + i as u8 * 0x08);
        sid.write_register(*ad, 0x00);
        sid.write_register(*sr, 0xF0);
        // Voices beyond `active_voices` are left gated-off (envelope at 0).
        if i < active_voices {
            sid.write_register(*ctrl, CTRL_GATE | CTRL_SAW);
        }
    }
    if filtered {
        sid.write_register(FC_HI, 0x40);
        sid.write_register(RES_FILT, 0x51); // voice 1 filtered
        sid.write_register(MODE_VOL, 0x1F); // LP + max vol
    } else {
        sid.write_register(MODE_VOL, 0x0F); // no filter routed (common case)
    }
    sid
}

fn bench(label: &str, active: usize, filtered: bool, seconds: u32) {
    let mut sid = setup(active, filtered);
    let n = 44_100u64 * seconds as u64;
    let mut acc: i64 = 0;
    let t = Instant::now();
    for _ in 0..n {
        acc += sid.clock() as i64;
    }
    let el = t.elapsed().as_secs_f64();
    println!(
        "{label:<18} {active} voix: {:.1} Msamples/s  (x{:.0} temps réel)  [checksum {acc}]",
        n as f64 / el / 1e6,
        n as f64 / 44_100.0 / el,
    );
}

fn main() {
    // Warm caches.
    bench("warmup", 3, true, 1);
    for active in [1usize, 2, 3] {
        bench("filtre actif", active, true, 20);
    }
    for active in [1usize, 2, 3] {
        bench("sans filtre", active, false, 20);
    }
}
