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

/* Quantize a requested direct duty in [0, 1] while keeping the period fixed.
 * Periods are even 8–126 machine cycles. Each phase reserves at least two
 * cycles for LAX and ATR. Round half-cycle ties upward. Invalid inputs return 0. */
uint32_t sm510_direct_high_cycles(uint32_t period_cycles, double duty);

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

/* Return the nominal SM511 pitch, averaged over the four waveform phases
 * of a six-bit melody word. Ignore the length bit. Return 0 for a rest,
 * stop, or invalid command. */
double sm511_pitch_hz(uint32_t command);

/* Render a continuous SM511 tone starting at phase zero. Average the
 * low (0) and high (0.16) levels over each output sample interval. */
void sm511_render_tone(float *output, uint32_t frames, uint32_t sample_rate,
                       uint32_t command);

/* Play up to 256 SM511 melody words from an aligned 62.5 ms slot boundary.
 * Each byte holds one six-bit word. Bit 5 doubles the slot length. Preserve
 * phase across notes and freeze it during silent slots. Treat reserved
 * words as rests. This one-shot player ends at the stop marker or ROM end. */
void sm511_render_melody(float *output, uint32_t frames, uint32_t sample_rate,
                         const uint8_t *rom, uint32_t count);

enum sm511_controller_command {
    SM511_PRE = 0,
    SM511_SME = 1,
    SM511_RME = 2,
    SM511_TMEL = 3,
};

/* Allocate this many bytes aligned for uint32_t. Reset initializes that
 * storage with the melody disabled and a ROM full of Stop commands. */
uint32_t sm511_controller_size(void);
void sm511_controller_reset(void *storage);

/* Install up to 256 six-bit ROM words and fill the tail with Stop.
 * Preserve the clock, ROM pointer, phase and flags. */
void sm511_controller_load(void *storage, const uint8_t *rom, uint32_t count);

/* PRE uses the low eight bits of arg. TMEL returns the old stop flag and
 * clears it. The other operations return 0. Pin updates on a master tick. */
uint32_t sm511_controller_apply(void *storage, uint32_t op, uint32_t arg);

/* Write five words: address, enabled, stop flag, last pin level (0 or 1),
 * and whole elapsed 32,768 Hz master ticks. */
void sm511_controller_state(void *storage, uint32_t *output);

/* Integrate the R pin over each output sample. Pass a shared timeline of
 * count [absolute master tick, op, arg] triples sorted by tick. Keep its
 * consumed prefix stable across blocks. Same-tick operations run in order
 * before sampling the next ROM word. Null events skip the timeline for
 * this block. Late events are discarded when encountered. */
void sm511_controller_render(void *storage, float *output, uint32_t frames, uint32_t sample_rate,
                              const uint32_t *events, uint32_t count);

#ifdef __cplusplus
}
#endif
