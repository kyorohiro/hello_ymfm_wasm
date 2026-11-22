// SPDX-License-Identifier: BSD-3-Clause
#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Return R1 in bit 0 and R2 in bit 1 at a 32,768 Hz master tick. In direct
 * mode the output is the low two bits of R. In DK-52 divider mode each R
 * bit enables its pin and R2 uses the inverse carrier phase of R1. */
uint32_t sm510_output_pins(uint32_t master_tick, uint32_t r, uint32_t direct);

/* Render mono R1 from master tick 0 with R initially clear. Events are
 * write_count pairs of [master_tick, raw_r], sorted by tick. The final write
 * at each tick takes effect. Output is the average of the bipolar R1 wave
 * over each sample interval, or silence when R1 is disabled. */
void sm510_render_r1(float *output, uint32_t frames, uint32_t sample_rate,
                     const uint32_t *events, uint32_t write_count);

#ifdef __cplusplus
}
#endif
