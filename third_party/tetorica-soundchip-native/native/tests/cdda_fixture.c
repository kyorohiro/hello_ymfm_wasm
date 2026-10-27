// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro
// A real C11 consumer of the public header and independently linked C module.
#include <tetorica/cdda.h>
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

static const uint8_t pcm[] = {0,64,0,192, 0,32,0,224, 0,0,0,0, 0,224,0,32};
static void lifecycle(uint32_t rate) {
    cdda_pcm_state s, before, reference;
    float left[128], right[128], l, r;
    assert(cdda_pcm_init(&s, rate));
    assert(cdda_pcm_set_gain(&s, 0.5));
    assert(cdda_pcm_prepare(&s, pcm, sizeof pcm));
    assert(s.pcm == pcm && s.frames == 4 && s.gain == 0.5); // borrowed, no copy
    before = s;
    assert(!cdda_pcm_prepare(&s, pcm, 3));
    assert(!cdda_pcm_prepare(&s, NULL, sizeof pcm));
    assert(!cdda_pcm_set_gain(&s, NAN));
    assert(!cdda_pcm_set_muted(&s, 2));
    assert(!cdda_pcm_seek(&s, 5));
    assert(memcmp(&s, &before, sizeof s) == 0);
    assert(cdda_pcm_play(&s));
    assert(cdda_pcm_render(&s, &l, &r, 1));
    assert(l == 0.25f && r == -0.25f);
    assert(s.frame == CDDA_PCM_SOURCE_RATE / rate);
    assert(s.phase == CDDA_PCM_SOURCE_RATE % rate);
    assert(cdda_pcm_pause(&s));
    before = s;
    assert(cdda_pcm_render(&s, left, right, 7));
    assert(s.frame == before.frame && s.phase == before.phase);
    assert(s.output_frames == before.output_frames + 7);
    for (unsigned i = 0; i < 7; ++i) assert(left[i] == 0 && right[i] == 0);
    assert(cdda_pcm_resume(&s));
    assert(cdda_pcm_set_muted(&s, 1));
    assert(cdda_pcm_render(&s, &l, &r, 1));
    assert(l == 0 && r == 0);
    assert(s.frame != before.frame || s.phase != before.phase); // mute is not pause
    assert(cdda_pcm_set_muted(&s, 0));
    assert(cdda_pcm_stop(&s));
    assert(s.frame == 0 && s.phase == 0 && s.pcm == pcm && s.gain == 0.5);
    assert(cdda_pcm_render(&s, &l, &r, 1) && l == 0 && r == 0);
    assert(cdda_pcm_play(&s));
    reference = s;
    assert(cdda_pcm_render(&s, left, right, 128));
    for (unsigned i = 0; i < 128; ++i) {
        assert(cdda_pcm_render(&reference, &l, &r, 1));
        assert(left[i] == l && right[i] == r && isfinite(l) && isfinite(r));
    }
    assert(s.frame == 4 && s.phase == 0 && s.state == CDDA_PCM_ENDED);
    assert(s.output_frames == reference.output_frames);
    assert(left[127] == 0 && right[127] == 0);
    assert(cdda_pcm_seek(&s, 4) && s.state == CDDA_PCM_ENDED);
    assert(cdda_pcm_seek(&s, 1) && s.state == CDDA_PCM_READY);
    // Borrowing ends on successful replacement. Host storage is still untouched.
    assert(cdda_pcm_prepare(&s, pcm + 4, sizeof pcm - 4));
    assert(s.pcm == pcm + 4 && s.frames == 3 && s.gain == 0.5);
}
static void windows_are_atomic(void) {
    cdda_pcm_state s, before;
    float left[2] = {123,456}, right[2] = {789,321};
    assert(cdda_pcm_init(&s, 48000));
    assert(cdda_pcm_prepare_windowed(&s, 4));
    assert(cdda_pcm_set_window(&s, pcm, 0, 1));
    assert(cdda_pcm_play(&s));
    before = s;
    assert(!cdda_pcm_render(&s, left, right, 2));
    assert(memcmp(&s, &before, sizeof s) == 0);
    assert(left[0] == 123 && left[1] == 456 && right[0] == 789 && right[1] == 321);
    assert(cdda_pcm_set_window(&s, pcm, 0, 3));
    assert(cdda_pcm_render(&s, left, right, 2));
    assert(left[0] == 0.5f && right[0] == -0.5f);
}
int main(void) {
    assert(!cdda_pcm_init(NULL, 48000));
    cdda_pcm_state s;
    assert(!cdda_pcm_init(&s, 7999) && !cdda_pcm_init(&s, 384001));
    lifecycle(44100); lifecycle(48000); lifecycle(96000);
    windows_are_atomic();
    puts("CD-DA C11 borrowed PCM, transport, phase, windows, mute and EOF: passed");
    return 0;
}
