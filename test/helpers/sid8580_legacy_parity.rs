// SPDX-License-Identifier: BSD-3-Clause
// Compile with both unmodified upstream and adapted Sidera rlibs. The cycle
// adapter must leave the original audio-rate public interfaces bit identical.
extern crate sidera;
extern crate sidera_upstream;

fn main() {
    let mut samples = 0u64;
    for rate in [44100, 48000, 96000] {
        for model in [0, 1] {
            let mut original = sidera_upstream::Sid::new(rate);
            let mut adapted = sidera::Sid::new(rate);
            original.set_model(if model == 0 {
                sidera_upstream::ChipModel::Mos6581
            } else {
                sidera_upstream::ChipModel::Mos8580
            });
            adapted.set_model(if model == 0 {
                sidera::ChipModel::Mos6581
            } else {
                sidera::ChipModel::Mos8580
            });
            for frame in 0..rate {
                if frame == rate / 2 {
                    original.reset();
                    adapted.reset();
                }
                if frame % 137 == 0 {
                    for register in 0..25 {
                        let value = ((frame / 137 + u32::from(register) * 37) & 255) as u8;
                        original.write_register(register, value);
                        adapted.write_register(register, value);
                    }
                }
                if frame & 1 == 0 {
                    assert_eq!(original.clock(), adapted.clock());
                } else {
                    assert_eq!(original.clock_with_voices(), adapted.clock_with_voices());
                }
                assert_eq!(original.read_register(27), adapted.read_register(27));
                assert_eq!(original.read_register(28), adapted.read_register(28));
                samples += 1;
            }
        }
    }
    println!("Original clock/clock_with_voices exact parity: {samples} samples, 6 rate/model combinations");
}
