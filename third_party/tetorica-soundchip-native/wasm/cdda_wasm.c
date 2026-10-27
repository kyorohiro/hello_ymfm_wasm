// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro
#include "cdda_pcm.h"

/* A fixed 4 KiB PCM16 window covers 128 output frames even at 8 kHz.
 * No malloc, full-track copy, or memory.grow occurs in the AudioWorklet.
 */
#define CDDA_WASM_WINDOW_FRAMES 1024u
#define CDDA_WASM_OUTPUT_FRAMES 128u
static cdda_pcm_state player;
static uint8_t input[CDDA_WASM_WINDOW_FRAMES * 4];
static float left[CDDA_WASM_OUTPUT_FRAMES];
static float right[CDDA_WASM_OUTPUT_FRAMES];

int cdda_wasm_init(uint32_t rate) { return cdda_pcm_init(&player, rate); }
uint8_t *cdda_wasm_input(void) { return input; }
float *cdda_wasm_left(void) { return left; }
float *cdda_wasm_right(void) { return right; }
int cdda_wasm_prepare(uint32_t frames) { return cdda_pcm_prepare_windowed(&player, frames); }
int cdda_wasm_window(uint32_t first, uint32_t frames) {
    if (frames > CDDA_WASM_WINDOW_FRAMES) return 0;
    return cdda_pcm_set_window(&player, input, first, frames);
}
int cdda_wasm_play(void) { return cdda_pcm_play(&player); }
int cdda_wasm_pause(void) { return cdda_pcm_pause(&player); }
int cdda_wasm_resume(void) { return cdda_pcm_resume(&player); }
int cdda_wasm_stop(void) { return cdda_pcm_stop(&player); }
int cdda_wasm_seek(uint32_t frame) { return cdda_pcm_seek(&player, frame); }
int cdda_wasm_gain(double gain) { return cdda_pcm_set_gain(&player, gain); }
int cdda_wasm_mute(int mute) { return cdda_pcm_set_muted(&player, mute); }
int cdda_wasm_render(uint32_t frames) {
    return frames <= CDDA_WASM_OUTPUT_FRAMES && cdda_pcm_render(&player, left, right, frames);
}
uint32_t cdda_wasm_state(void) { return player.state; }
uint32_t cdda_wasm_frame(void) { return (uint32_t)player.frame; }
uint32_t cdda_wasm_phase(void) { return player.phase; }
double cdda_wasm_output_frames(void) { return (double)player.output_frames; }
double cdda_wasm_get_gain(void) { return player.gain; }
int cdda_wasm_muted(void) { return (int)player.muted; }
