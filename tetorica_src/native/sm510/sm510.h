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

/* Find the closest direct-output pitch in Hz. The allowed half-periods of
 * 4–63 machine cycles fit one LAX, one ATR, padding and a two-cycle TL
 * in each ROM page. Ties use the shorter half-period. Return 0 for a
 * nonfinite or nonpositive target. */
uint32_t sm510_direct_half_cycles(double target_hz);

/* Render a direct-output note in steady state with equal half-periods.
 * Start high at 0.16 and then alternate with 0, averaging over each sample
 * interval just like the direct R1 timeline. */
void sm510_render_direct_note(float *output, uint32_t frames, uint32_t sample_rate,
                              uint32_t half_cycles);

/* Use the same event format and initial latch as sm510_render_r1. The R1
 * pin follows bit 0 of the latch at all times. Average levels of 0 and 0.16
 * over each sample interval. */
void sm510_render_direct_r1(float *output, uint32_t frames, uint32_t sample_rate,
                            const uint32_t *events, uint32_t write_count);

#ifdef __cplusplus
}
#endif
