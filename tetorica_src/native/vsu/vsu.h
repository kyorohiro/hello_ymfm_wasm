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

typedef struct {
    uint32_t frequency;
    uint32_t active;
    uint32_t wave_bank; /* UINT32_MAX on the noise channel. */
    uint32_t left;
    uint32_t right;
    uint32_t ev0;
    uint32_t ev1;
    uint32_t swp;
    uint8_t wave[32];
    uint8_t modulation[32]; /* Signed two's complement, only used by CH5. */
} vsu_voice_snapshot;

/* Read the configured registers and selected waveform without changing the
 * chip state. Returns zero for an invalid channel or selected wave bank. */
uint32_t vsu_snapshot_size(void);
uint32_t vsu_snapshot_voice(const void *state, uint32_t channel, vsu_voice_snapshot *output);

typedef struct {
    vsu_voice_snapshot voice;
    uint32_t working_frequency;
    uint32_t current_envelope;
} vsu_live_voice_snapshot;

/* Observe both configured and current oscillator/envelope values. Invalid
 * wave selections retain the bank code and return an empty waveform. */
uint32_t vsu_live_snapshot_size(void);
uint32_t vsu_snapshot_live_voice(const void *state, uint32_t channel, vsu_live_voice_snapshot *output);

/* Average the held VSU stereo output over each host sample interval.
 * Output is normalized around the waveform midpoint for audition. */
void vsu_render(void *state, float *left, float *right, uint32_t frames, uint32_t sample_rate);

#ifdef __cplusplus
}
#endif
