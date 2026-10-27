// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
#include "msm5205_pcm.h"
#define MSM5205_WASM_OUTPUT_FRAMES 128u
static msm5205_pcm_state player;
static uint8_t input[MSM5205_PCM_MAX_BYTES];
static float left[MSM5205_WASM_OUTPUT_FRAMES];
static float right[MSM5205_WASM_OUTPUT_FRAMES];

int msm5205_wasm_init(uint32_t rate, uint32_t clock) { return msm5205_pcm_init(&player, rate, clock); }
uint8_t *msm5205_wasm_input(void) { return input; }
float *msm5205_wasm_left(void) { return left; }
float *msm5205_wasm_right(void) { return right; }
int msm5205_wasm_prepare(uint32_t bytes) { return msm5205_pcm_prepare(&player, input, bytes); }
int msm5205_wasm_play(uint32_t offset, uint32_t length, int loop, uint32_t rate) {
    return msm5205_pcm_play(&player, offset, length, loop, rate);
}
int msm5205_wasm_stop(void) { return msm5205_pcm_stop(&player); }
int msm5205_wasm_reset(void) { return msm5205_pcm_reset(&player); }
int msm5205_wasm_write(uint32_t reg, uint32_t value) { return msm5205_pcm_write_register(&player, reg, value); }
int msm5205_wasm_gain(double gain) { return msm5205_pcm_set_gain(&player, gain); }
int msm5205_wasm_mute(int muted) { return msm5205_pcm_set_muted(&player, muted); }
int msm5205_wasm_render(uint32_t frames) {
    return frames <= MSM5205_WASM_OUTPUT_FRAMES && msm5205_pcm_render(&player, left, right, frames);
}
/* Stable numeric status fields, ABI version 1. Never expose pointers to JS. */
double msm5205_wasm_read(uint32_t field) {
    switch (field) {
    case 0: return player.mode; case 1: return player.state;
    case 2: return player.source_bytes; case 3: return player.offset;
    case 4: return player.length; case 5: return player.cursor;
    case 6: return player.loop; case 7: return player.rate;
    case 8: return (double)player.phase; case 9: return (double)player.output_frames;
    case 10: return player.gain; case 11: return player.muted;
    case 12: return player.signal; case 13: return player.step;
    case 14: return player.reset_line; case 15: return player.vclk;
    case 16: return player.prescaler; case 17: return player.bits;
    case 18: return player.fifo_count;
    default: return 0;
    }
}
