// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro
#include "cdda_pcm.h"
#ifdef __cplusplus
#include <cmath>
#define CDDA_ISFINITE std::isfinite
#else
#include <math.h>
#define CDDA_ISFINITE isfinite
#endif
#include <string.h>

static int valid(const cdda_pcm_state *s) {
    return s && s->output_rate >= 8000 && s->output_rate <= 384000;
}

int cdda_pcm_init(cdda_pcm_state *s, uint32_t output_rate) {
    if (!s || output_rate < 8000 || output_rate > 384000) return 0;
    memset(s, 0, sizeof(*s));
    s->output_rate = output_rate;
    s->gain = 1;
    return 1;
}

int cdda_pcm_prepare(cdda_pcm_state *s, const uint8_t *pcm, uint32_t bytes) {
    if (!valid(s) || !pcm || !bytes || bytes > CDDA_PCM_MAX_BYTES || bytes % 4) return 0;
    cdda_pcm_prepare_windowed(s, bytes / 4);
    s->pcm = pcm;
    s->window_frames = bytes / 4;
    return 1;
}

int cdda_pcm_prepare_windowed(cdda_pcm_state *s, uint64_t source_frames) {
    if (!valid(s) || !source_frames || source_frames > CDDA_PCM_MAX_BYTES / 4) return 0;
    s->pcm = 0;
    s->frames = source_frames;
    s->window_first_frame = s->window_frames = 0;
    s->frame = s->phase = 0;
    s->state = CDDA_PCM_READY;
    return 1;
}

int cdda_pcm_set_window(cdda_pcm_state *s, const uint8_t *pcm,
                        uint64_t first_frame, uint32_t window_frames) {
    if (!valid(s) || !pcm || !window_frames || first_frame >= s->frames ||
        window_frames > s->frames - first_frame) return 0;
    s->pcm = pcm;
    s->window_first_frame = first_frame;
    s->window_frames = window_frames;
    return 1;
}

int cdda_pcm_play(cdda_pcm_state *s) {
    if (!valid(s) || !s->frames) return 0;
    s->frame = s->phase = 0;
    s->state = CDDA_PCM_PLAYING;
    return 1;
}

int cdda_pcm_pause(cdda_pcm_state *s) {
    if (!valid(s) || s->state != CDDA_PCM_PLAYING) return 0;
    s->state = CDDA_PCM_PAUSED;
    return 1;
}

int cdda_pcm_resume(cdda_pcm_state *s) {
    if (!valid(s) || s->state != CDDA_PCM_PAUSED) return 0;
    s->state = CDDA_PCM_PLAYING;
    return 1;
}

int cdda_pcm_stop(cdda_pcm_state *s) {
    if (!valid(s)) return 0;
    s->frame = s->phase = 0;
    s->state = CDDA_PCM_READY;
    return 1;
}

int cdda_pcm_seek(cdda_pcm_state *s, uint64_t frame) {
    if (!valid(s) || !s->frames || frame > s->frames) return 0;
    s->frame = frame;
    s->phase = 0;
    if (frame == s->frames) s->state = CDDA_PCM_ENDED;
    else if (s->state == CDDA_PCM_ENDED) s->state = CDDA_PCM_READY;
    return 1;
}

int cdda_pcm_set_gain(cdda_pcm_state *s, double gain) {
    if (!valid(s) || !CDDA_ISFINITE(gain) || gain < 0 || gain > 16) return 0;
    s->gain = gain;
    return 1;
}

int cdda_pcm_set_muted(cdda_pcm_state *s, int muted) {
    if (!valid(s) || (muted != 0 && muted != 1)) return 0;
    s->muted = (uint32_t)muted;
    return 1;
}

static double read_pcm(const uint8_t *pcm, uint64_t frame, uint32_t channel) {
    const uint8_t *p = pcm + frame * 4 + channel * 2;
    int32_t value = (int32_t)((uint32_t)p[0] | ((uint32_t)p[1] << 8));
    if (value >= 32768) value -= 65536;
    return (double)value / 32768.0;
}

int cdda_pcm_render(cdda_pcm_state *s, float *left, float *right, uint32_t frames) {
    if (!valid(s) || (!left && frames) || (!right && frames) || (frames && left == right)) return 0;
    if (frames && s->state == CDDA_PCM_PLAYING && s->frame < s->frames && !s->muted && s->gain != 0) {
        uint64_t last = s->frame + ((uint64_t)s->phase + (uint64_t)(frames - 1) * CDDA_PCM_SOURCE_RATE) / s->output_rate;
        if (last >= s->frames) last = s->frames - 1;
        if (last + 1 < s->frames) ++last;
        if (!s->pcm || s->frame < s->window_first_frame ||
            last >= s->window_first_frame + s->window_frames) return 0;
    }
    for (uint32_t i = 0; i < frames; ++i) {
        float l = 0, r = 0;
        if (s->state == CDDA_PCM_PLAYING && s->frame < s->frames) {
            if (!s->muted && s->gain != 0) {
                const uint64_t next = s->frame + 1 < s->frames ? s->frame + 1 : s->frame;
                const double fraction = (double)s->phase / s->output_rate;
                const uint64_t local = s->frame - s->window_first_frame;
                const uint64_t local_next = next - s->window_first_frame;
                const double a = read_pcm(s->pcm, local, 0);
                const double b = read_pcm(s->pcm, local, 1);
                l = (float)((a + (read_pcm(s->pcm, local_next, 0) - a) * fraction) * s->gain);
                r = (float)((b + (read_pcm(s->pcm, local_next, 1) - b) * fraction) * s->gain);
            }
            const uint32_t phase = s->phase + CDDA_PCM_SOURCE_RATE;
            s->frame += phase / s->output_rate;
            s->phase = phase % s->output_rate;
            if (s->frame >= s->frames) {
                s->frame = s->frames;
                s->phase = 0;
                s->state = CDDA_PCM_ENDED;
            }
        }
        left[i] = l;
        right[i] = r;
    }
    s->output_frames += frames;
    return 1;
}
