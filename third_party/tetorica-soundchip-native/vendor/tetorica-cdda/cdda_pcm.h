// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro
#ifndef TETORICA_CDDA_PCM_H
#define TETORICA_CDDA_PCM_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define CDDA_PCM_SOURCE_RATE 44100u
#define CDDA_PCM_MAX_BYTES (256u * 1024u * 1024u)

enum cdda_pcm_playback_state {
    CDDA_PCM_READY = 0,
    CDDA_PCM_PLAYING = 1,
    CDDA_PCM_PAUSED = 2,
    CDDA_PCM_ENDED = 3
};

/* Source storage is immutable, borrowed, interleaved little-endian stereo
 * PCM16. The host owns its lifetime through replacement or destruction.
 * Render never allocates, calls the host, or decodes the complete source.
 * Source position = frame + phase / output_rate; output_frames counts ALL
 * rendered host frames, including silence while ready/paused/ended.
 * Do not access/mutate this state concurrently with render. Queue commands
 * onto the same audio clock in the host (rather than a UI timer).
 */
typedef struct cdda_pcm_state {
    const uint8_t *pcm;
    uint64_t frames;
    uint64_t window_first_frame;
    uint64_t window_frames;
    uint64_t frame;
    uint64_t output_frames;
    double gain;
    uint32_t phase;
    uint32_t output_rate;
    uint32_t state;
    uint32_t muted;
} cdda_pcm_state;

/* All functions return 1 on success, 0 on invalid input. Failed operations
 * preserve the previous state/source. init is required before other calls.
 * prepare preserves gain, mute, and the host output-frame counter.
 */
int cdda_pcm_init(cdda_pcm_state *s, uint32_t output_rate);
int cdda_pcm_prepare(cdda_pcm_state *s, const uint8_t *pcm, uint32_t bytes);
/* Browser hosts may retain the complete PCM16 in JS and refresh a fixed
 * scratch window before each render. Neither call allocates. set_window
 * preserves playback state/cursor/phase. No partially supplied render:
 * render fails before writing output if its source window is insufficient.
 */
int cdda_pcm_prepare_windowed(cdda_pcm_state *s, uint64_t source_frames);
int cdda_pcm_set_window(cdda_pcm_state *s, const uint8_t *pcm,
                        uint64_t first_frame, uint32_t window_frames);
int cdda_pcm_play(cdda_pcm_state *s); /* Always start at source frame zero. */
int cdda_pcm_pause(cdda_pcm_state *s);
int cdda_pcm_resume(cdda_pcm_state *s);
int cdda_pcm_stop(cdda_pcm_state *s); /* Retain source; reset cursor, ready. */
int cdda_pcm_seek(cdda_pcm_state *s, uint64_t source_frame);
int cdda_pcm_set_gain(cdda_pcm_state *s, double gain); /* Finite, 0..16. */
int cdda_pcm_set_muted(cdda_pcm_state *s, int muted); /* Exactly 0 or 1. */
/* Replace planar outputs, including silence. Last source frame is held for
 * interpolation until its duration expires; there is no loop or fade.
 * At EOF cursor is exactly frames, phase is zero, state is ended.
 */
int cdda_pcm_render(cdda_pcm_state *s, float *left, float *right, uint32_t frames);

#ifdef __cplusplus
}
#endif
#endif
