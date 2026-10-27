// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro
#include <tetorica/msm5205.h>
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

static const uint8_t encoded[] = {0x78,0x12,0x34,0x56,0x90,0xab,0xcd,0xef};
static void rates_and_ranges(uint32_t output_rate) {
    for (uint32_t rate = 0; rate < 16; ++rate) {
        msm5205_pcm_state s, before, reference;
        float left[128], right[128], l, r;
        assert(msm5205_pcm_init(&s, output_rate, MSM5205_PCM_DEFAULT_CLOCK));
        // Raw reset has the legacy -2 predictor. A PCE host explicitly stops
        // before connecting an unprepared driver to a shared output.
        assert(msm5205_pcm_stop(&s));
        assert(msm5205_pcm_render(&s, &l, &r, 1) && l == 0 && r == 0);
        assert(msm5205_pcm_prepare(&s, encoded, sizeof encoded));
        assert(s.source == encoded && s.source_bytes == sizeof encoded);
        before = s;
        assert(!msm5205_pcm_prepare(&s, encoded, MSM5205_PCM_MAX_BYTES + 1));
        assert(!msm5205_pcm_play(&s, 16, 1, 0, rate));
        assert(!msm5205_pcm_play(&s, 1, 0, 0, rate));
        assert(!msm5205_pcm_play(&s, 1, 16, 0, rate));
        assert(!msm5205_pcm_play(&s, 1, 3, 2, rate));
        assert(!msm5205_pcm_play(&s, 1, 3, 0, 16));
        assert(!msm5205_pcm_set_gain(&s, NAN));
        assert(memcmp(&s, &before, sizeof s) == 0);
        assert(msm5205_pcm_play(&s, 1, 3, 0, rate)); // low nibble 8 first
        assert(s.signal == -2 && s.cursor == 1);
        reference = s;
        assert(msm5205_pcm_render(&s, left, right, 128));
        for (unsigned i = 0; i < 128; ++i) {
            assert(msm5205_pcm_render(&reference, &l, &r, 1));
            assert(left[i] == l && right[i] == r && l == r && isfinite(l));
        }
        // Three nibbles expire after exactly ceil(3 * hostRate / chipRate).
        const uint64_t threshold = (uint64_t)output_rate * 48 * (16 - rate);
        const uint32_t duration = (uint32_t)((3 * threshold + s.clock - 1) / s.clock);
        assert(duration <= 128 && s.state == MSM5205_PCM_ENDED);
        assert(s.cursor == 4 && s.phase == 0 && left[127] == 0);
        assert(msm5205_pcm_play(&s, 1, 3, 0, rate));
        for (uint32_t frame = 0; frame < duration; ++frame) {
            assert(s.state == MSM5205_PCM_PLAYING);
            assert(msm5205_pcm_render(&s, &l, &r, 1));
        }
        assert(s.state == MSM5205_PCM_ENDED && s.cursor == 4);
        assert(msm5205_pcm_set_gain(&s, 0.5));
        assert(msm5205_pcm_set_muted(&s, 1));
        assert(msm5205_pcm_play(&s, 1, 3, 1, rate));
        assert(msm5205_pcm_render(&s, left, right, 128));
        assert(s.state == MSM5205_PCM_PLAYING);
        for (unsigned i = 0; i < 128; ++i) assert(left[i] == 0 && right[i] == 0);
        assert(msm5205_pcm_reset(&s));
        assert(s.source == encoded && s.gain == 0.5 && s.muted == 1);
        assert(s.offset == 0 && s.cursor == 0 && s.length == sizeof encoded * 2);
        assert(msm5205_pcm_stop(&s));
    }
}
static void loop_and_raw(void) {
    msm5205_pcm_state s;
    const uint8_t loop[] = {0x08};
    float left[3], right[3];
    assert(msm5205_pcm_init(&s, 32000, 1536000));
    assert(msm5205_pcm_prepare(&s, loop, 1));
    assert(msm5205_pcm_play(&s, 0, 2, 1, 15));
    assert(msm5205_pcm_render(&s, left, right, 3));
    assert(left[0] == 2.0f / 2048 && left[1] == -1.0f / 2048);
    assert(left[2] == 1.0f / 2048); // predictor continues through loop boundary
    assert(s.state == MSM5205_PCM_PLAYING);
    assert(msm5205_pcm_init(&s, 16000, 1536000));
    assert(msm5205_pcm_write_register(&s, 1, 7));
    assert(msm5205_pcm_render(&s, left, right, 1));
    assert(left[0] == 28.0f / 2048 && left[0] == right[0]);
    assert(msm5205_pcm_write_register(&s, 0, 1));
    assert(msm5205_pcm_render(&s, left, right, 1) && left[0] == 0);
    assert(msm5205_pcm_prepare(&s, encoded, sizeof encoded));
    assert(msm5205_pcm_play(&s, 0, 4, 0, 12));
    assert(msm5205_pcm_write_register(&s, 1, 3));
    assert(s.mode == MSM5205_PCM_RAW && s.fifo_count == 1 && s.source == encoded);
    assert(!msm5205_pcm_write_register(&s, 8, 0));
    assert(!msm5205_pcm_write_register(&s, 1, 16));
    assert(msm5205_pcm_stop(&s));
    assert(msm5205_pcm_render(&s, left, right, 3));
    for (unsigned i = 0; i < 3; ++i) assert(left[i] == 0 && right[i] == 0);
}
int main(void) {
    rates_and_ranges(44100); rates_and_ranges(48000); loop_and_raw();
    puts("MSM5205 C11 borrowed RAM, all rates, odd nibbles, loop, raw and Stop: passed");
    return 0;
}
