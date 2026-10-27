// SPDX-License-Identifier: BSD-3-Clause
// ADPCM/FIFO adaptation: Copyright (c) Aaron Giles, eito, cam900, Valley Bell, Mao.
// PCM host and PC Engine RAM driver: Copyright (c) 2026, kyorohiro.
#ifndef TETORICA_MSM5205_PCM_H
#define TETORICA_MSM5205_PCM_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

#define MSM5205_PCM_MAX_BYTES 65536u
#define MSM5205_PCM_DEFAULT_CLOCK 1536000u
enum msm5205_pcm_mode { MSM5205_PCM_RAW = 0, MSM5205_PCM_PCE = 1 };
enum msm5205_pcm_playback_state {
    MSM5205_PCM_READY = 0, MSM5205_PCM_PLAYING = 1, MSM5205_PCM_ENDED = 2
};

/* Allocate the state in the host. Source storage is immutable, borrowed packed
 * ADPCM RAM, high nibble first. Keep it alive through replacement/destruction.
 * All commands and render run on one audio clock, never concurrently. No
 * function allocates, locks, calls the host or takes ownership of the source.
 * phase is an integer numerator; output_frames counts even silent host frames.
 * PC Engine mode is a RAM playback helper, NOT a CPU/DMA/SCSI/CD emulator.
 */
typedef struct msm5205_pcm_state {
    const uint8_t *source;
    uint32_t source_bytes;
    uint32_t output_rate;
    uint32_t clock;
    uint32_t mode;
    uint32_t state;
    uint32_t offset;
    uint32_t length;
    uint32_t cursor;
    uint32_t loop;
    uint32_t rate;
    uint64_t phase;
    uint64_t output_frames;
    double gain;
    uint32_t muted;
    int32_t signal;
    int32_t step;
    uint32_t reset_line;
    uint32_t vclk;
    uint32_t prescaler;
    uint32_t bits;
    uint8_t fifo[7];
    uint32_t fifo_head;
    uint32_t fifo_count;
} msm5205_pcm_state;

/* Return 1 on success, 0 for invalid input. Validation failure leaves previous
 * state/source and render outputs unchanged. init is required first.
 * output_rate: 8000..384000; clock: 1..0x3fffffff. Raw reset signal is -2,
 * 4-bit with /96 prescaler, exactly matching the existing JS VGM decoder.
 */
int msm5205_pcm_init(msm5205_pcm_state *s, uint32_t output_rate, uint32_t clock);
int msm5205_pcm_prepare(msm5205_pcm_state *s, const uint8_t *source, uint32_t bytes);
/* offset/length are NIBBLES, so odd starts and odd lengths are representable.
 * rate is the PCE register 0..15; sample rate = clock / (48 * (16 - rate)).
 * play resets predictor to zero and decodes the first nibble immediately.
 * Output holds it until the first sample-clock tick, then advances. At EOF
 * state=ended, cursor=offset+length, phase=0, output is exactly silent.
 * Loop wraps source without resetting predictor, as a continuing ADPCM stream.
 */
int msm5205_pcm_play(msm5205_pcm_state *s, uint32_t offset, uint32_t length,
                     int loop, uint32_t rate);
int msm5205_pcm_stop(msm5205_pcm_state *s);
/* reset retains source/gain/mute/output_frames; raw settings reset to defaults. */
int msm5205_pcm_reset(msm5205_pcm_state *s);
/* Raw mode: registers 0..7, values 0..15, as the JS VGM implementation. The
 * first raw write after PCE mode starts a fresh raw decoder and discards PCE
 * playback. The source remains borrowed for later explicit play().
 */
int msm5205_pcm_write_register(msm5205_pcm_state *s, uint32_t reg, uint32_t value);
int msm5205_pcm_set_gain(msm5205_pcm_state *s, double gain); /* finite, 0..16 */
int msm5205_pcm_set_muted(msm5205_pcm_state *s, int muted); /* exactly 0 or 1 */
/* Replace planar outputs. Mono is copied identically to left/right. Muting
 * affects output only; clock, predictor, RAM cursor and FIFO keep advancing.
 */
int msm5205_pcm_render(msm5205_pcm_state *s, float *left, float *right, uint32_t frames);

#ifdef __cplusplus
}
#endif
#endif
