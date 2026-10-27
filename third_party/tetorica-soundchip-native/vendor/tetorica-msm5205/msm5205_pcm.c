// SPDX-License-Identifier: BSD-3-Clause
// ADPCM/FIFO adaptation: Copyright (c) Aaron Giles, eito, cam900, Valley Bell, Mao.
// PCM host and PC Engine RAM driver: Copyright (c) 2026, kyorohiro.
// See LICENSE and NOTICE.md in this directory for the upstream provenance.
#include "msm5205_pcm.h"
#include <math.h>
#include <string.h>

/* Literal floor(16 * 1.1^i) avoids platform libm/initialization differences. */
static const int32_t steps[49] = {
    16,17,19,21,23,25,28,31,34,37,41,45,50,55,60,66,73,80,88,97,107,
    118,130,143,157,173,190,209,230,253,279,307,337,371,408,449,494,
    544,598,658,724,796,876,963,1060,1166,1282,1411,1552
};
static const int32_t shifts[8] = {-1,-1,-1,-1,2,4,6,8};
static const uint32_t dividers[4] = {96,64,48,1};
static int valid(const msm5205_pcm_state *s) {
    return s && s->output_rate >= 8000 && s->output_rate <= 384000 &&
        s->clock && s->clock <= 0x3fffffffu;
}
static void decoder_reset(msm5205_pcm_state *s, int32_t signal) {
    s->signal = signal; s->step = 0; s->phase = 0;
    s->reset_line = 0; s->vclk = 0; s->prescaler = 0; s->bits = 4;
    s->fifo_head = 0; s->fifo_count = 0;
}
static void decode(msm5205_pcm_state *s, uint32_t nibble) {
    int32_t size = steps[s->step];
    int32_t delta = (size / 8) + ((nibble & 1) ? size / 4 : 0) +
        ((nibble & 2) ? size / 2 : 0) + ((nibble & 4) ? size : 0);
    int32_t accumulator, signal;
    if (nibble & 8) delta = -delta;
    accumulator = delta * 256 + s->signal * 245;
    /* JS >>8 is floor for negative signed integers; C signed right shift is
     * implementation-defined, while signed division truncates toward zero. */
    signal = accumulator >= 0 ? accumulator / 256 : -((-accumulator + 255) / 256);
    s->signal = signal < -2048 ? -2048 : signal > 2047 ? 2047 : signal;
    s->step += shifts[nibble & 7];
    if (s->step < 0) s->step = 0;
    if (s->step > 48) s->step = 48;
}
static void raw_tick(msm5205_pcm_state *s) {
    uint32_t nibble;
    if (s->reset_line || !s->fifo_count) return;
    nibble = s->fifo[s->fifo_head];
    s->fifo_head = (s->fifo_head + 1) % 7; --s->fifo_count;
    if (s->bits == 3) nibble = (nibble << 1) & 15;
    decode(s, nibble);
}
static void ram_decode(msm5205_pcm_state *s) {
    uint32_t value = s->source[s->cursor / 2];
    decode(s, (s->cursor & 1) ? value & 15 : value >> 4);
}
int msm5205_pcm_init(msm5205_pcm_state *s, uint32_t output_rate, uint32_t clock) {
    if (!s || output_rate < 8000 || output_rate > 384000 || !clock || clock > 0x3fffffffu) return 0;
    memset(s, 0, sizeof(*s));
    s->output_rate = output_rate; s->clock = clock; s->gain = 1;
    s->rate = 15; decoder_reset(s, -2);
    return 1;
}
int msm5205_pcm_prepare(msm5205_pcm_state *s, const uint8_t *source, uint32_t bytes) {
    if (!valid(s) || !source || !bytes || bytes > MSM5205_PCM_MAX_BYTES) return 0;
    s->source = source; s->source_bytes = bytes; s->mode = MSM5205_PCM_PCE;
    s->state = MSM5205_PCM_READY; s->offset = 0; s->cursor = 0;
    s->length = bytes * 2; s->loop = 0; s->rate = 15;
    decoder_reset(s, 0);
    return 1;
}
int msm5205_pcm_play(msm5205_pcm_state *s, uint32_t offset, uint32_t length, int loop, uint32_t rate) {
    if (!valid(s) || !s->source || !s->source_bytes || !length ||
        offset >= s->source_bytes * 2 || length > s->source_bytes * 2 - offset ||
        (loop != 0 && loop != 1) || rate > 15) return 0;
    decoder_reset(s, 0);
    s->mode = MSM5205_PCM_PCE; s->state = MSM5205_PCM_PLAYING;
    s->offset = offset; s->length = length; s->cursor = offset;
    s->loop = (uint32_t)loop; s->rate = rate;
    ram_decode(s);
    return 1;
}
int msm5205_pcm_stop(msm5205_pcm_state *s) {
    if (!valid(s)) return 0;
    decoder_reset(s, 0); s->state = MSM5205_PCM_READY;
    s->mode = MSM5205_PCM_PCE; s->cursor = s->offset;
    return 1;
}
int msm5205_pcm_reset(msm5205_pcm_state *s) {
    if (!valid(s)) return 0;
    decoder_reset(s, s->source ? 0 : -2);
    s->mode = s->source ? MSM5205_PCM_PCE : MSM5205_PCM_RAW;
    s->state = MSM5205_PCM_READY; s->cursor = 0; s->offset = 0;
    s->length = s->source_bytes * 2; s->loop = 0; s->rate = 15;
    return 1;
}
int msm5205_pcm_write_register(msm5205_pcm_state *s, uint32_t reg, uint32_t value) {
    if (!valid(s) || reg > 7 || value > 15) return 0;
    if (s->mode != MSM5205_PCM_RAW) {
        decoder_reset(s, -2); s->mode = MSM5205_PCM_RAW; s->state = MSM5205_PCM_READY;
    }
    switch (reg) {
    case 0:
        if (s->reset_line != value) { s->signal = 0; s->step = 0; }
        s->reset_line = value;
        if (value) { s->fifo_head = 0; s->fifo_count = 0; }
        break;
    case 1:
        if (s->fifo_count < 7) { s->fifo[(s->fifo_head + s->fifo_count) % 7] = (uint8_t)value; ++s->fifo_count; }
        break;
    case 2:
        if (s->prescaler == 3 && !(s->vclk & 1) && (value & 1)) raw_tick(s);
        s->vclk = value; break;
    case 4: s->prescaler = value & 3; break;
    case 5: s->bits = value ? 4 : 3; break;
    default: break;
    }
    return 1;
}
int msm5205_pcm_set_gain(msm5205_pcm_state *s, double gain) {
    if (!valid(s) || !isfinite(gain) || gain < 0 || gain > 16) return 0;
    s->gain = gain; return 1;
}
int msm5205_pcm_set_muted(msm5205_pcm_state *s, int muted) {
    if (!valid(s) || (muted != 0 && muted != 1)) return 0;
    s->muted = (uint32_t)muted; return 1;
}
int msm5205_pcm_render(msm5205_pcm_state *s, float *left, float *right, uint32_t frames) {
    uint32_t i;
    if (!valid(s) || (frames && (!left || !right || left == right))) return 0;
    for (i = 0; i < frames; ++i) {
        double value = 0;
        if (s->mode == MSM5205_PCM_RAW) {
            uint64_t threshold = (uint64_t)s->output_rate * dividers[s->prescaler];
            if (s->prescaler != 3) {
                s->phase += s->clock;
                while (s->phase >= threshold) { s->phase -= threshold; raw_tick(s); }
            }
            if (!s->reset_line && !s->muted) value = (double)s->signal / 2048 * s->gain;
        } else if (s->state == MSM5205_PCM_PLAYING) {
            uint64_t threshold = (uint64_t)s->output_rate * 48 * (16 - s->rate);
            if (!s->muted) value = (double)s->signal / 2048 * s->gain;
            s->phase += s->clock;
            while (s->phase >= threshold) {
                s->phase -= threshold;
                ++s->cursor;
                if (s->cursor == s->offset + s->length) {
                    if (s->loop) s->cursor = s->offset;
                    else { s->state = MSM5205_PCM_ENDED; s->phase = 0; s->signal = 0; break; }
                }
                ram_decode(s);
            }
        }
        left[i] = right[i] = (float)value;
    }
    s->output_frames += frames;
    return 1;
}
