// SPDX-License-Identifier: BSD-3-Clause
// Device-free direct-Probe microbenchmark, not a CPU/Worklet throughput test.
#[path = "../../tetorica_src/wasm/sid8580-probe/lib.rs"]
mod probe;
use std::hint::black_box;
use std::time::Instant;

fn main() {
    for repetition in 0..5 {
        let mut chip = probe::Probe::new(48000, 1).unwrap();
        for (register, value) in [
            (0, 0x45),
            (1, 0x23),
            (4, 0x21),
            (5, 0),
            (6, 0xf0),
            (21, 7),
            (22, 127),
            (23, 0x91),
            (24, 0x1f),
        ] {
            assert!(chip.write(register, value));
        }
        let start = Instant::now();
        let mut pcm_hash = 14695981039346656037u64;
        for _ in 0..1_000_000 {
            let active = black_box(&mut chip);
            let produced = active.run(black_box(1)).unwrap();
            for sample in active.output() {
                for byte in sample.to_le_bytes() {
                    pcm_hash = (pcm_hash ^ u64::from(byte)).wrapping_mul(1099511628211);
                }
            }
            black_box(produced);
        }
        let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(chip.cycle_count(), 1_000_000);
        assert_eq!(chip.frame_count(), 48_718);
        assert_eq!(pcm_hash, 0x08a7cc772fbcadcb);
        println!("{{\"repetition\":{repetition},\"milliseconds\":{elapsed_ms},\"cycles\":{},\"frames\":{},\"pcmFnv1a64\":\"{pcm_hash:016x}\"}}", chip.cycle_count(), chip.frame_count());
    }
}
