// SPDX-License-Identifier: BSD-3-Clause
#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Allocate vsu_size() bytes aligned for uint32_t, then initialize them
 * with vsu_reset(). The caller owns the storage. */
uint32_t vsu_size(void);
void vsu_reset(void *state);

/* Write the low byte to one register or RAM cell at a byte offset from
 * 0x01000000. Valid addresses are four bytes apart. */
void vsu_write(void *state, uint32_t offset, uint32_t value);

/* Audition mask, one bit per channel, defaults to 0x3f on reset. It affects
 * only the mixer. Muted channels still advance and enforce RAM write locks. */
void vsu_set_mix_mask(void *state, uint32_t mask);

/* Packed channel state: stereo level in bits 0..7 (LRV), enabled in bit 8,
 * CH5 effect mode in bits 9..10 (0 off, 1 sweep, 2 modulation). */
uint32_t vsu_get_channel(const void *state, uint32_t channel);

/* Average the held VSU stereo output over each host sample interval.
 * Output is normalized around the waveform midpoint for audition. */
void vsu_render(void *state, float *left, float *right, uint32_t frames, uint32_t sample_rate);

#ifdef __cplusplus
}
#endif
