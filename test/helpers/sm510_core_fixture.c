// SPDX-License-Identifier: BSD-3-Clause
#include "sm510.h"

#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
    assert(sm510_output_pins(3, 3, 0) == 2);
    assert(sm510_output_pins(4, 3, 0) == 1);
    assert(sm510_output_pins(8, 3, 0) == 2);
    assert(sm510_output_pins(0, 1, 0) == 0);
    assert(sm510_output_pins(4, 2, 0) == 0);
    assert(sm510_output_pins(4, 15, 1) == 3);
    assert(sm510_output_pins(0, 12, 1) == 0);
    assert(sm510_output_pins(3, 3, 1) == sm510_output_pins(4, 3, 1));

    const uint32_t events[] = {1, 1, 1, 0, 3, 1, 5, 2, 6, 1, 8, 0};
    float pcm[10];
    sm510_render_r1(pcm, 10, 32768, events, sizeof events / sizeof events[0] / 2);
    const float expect[] = {0, 0, 0, -0.16f, 0.16f, 0, 0.16f, 0.16f, 0, 0};
    for (uint32_t frame = 0; frame < 10; ++frame)
        assert(pcm[frame] == expect[frame]);

    const uint32_t one_tick[] = {0, 1, 1, 0};
    sm510_render_r1(pcm, 3, 48000, one_tick, 2);
    assert(pcm[0] == -0.16f);
    assert(pcm[1] == (float)(-0.16 * (48000 - 32768) / 32768));
    assert(pcm[2] == 0);
    sm510_render_r1(pcm, 3, 48000, NULL, 0);
    assert(pcm[0] == 0 && pcm[1] == 0 && pcm[2] == 0);

    assert(sm510_direct_half_cycles(130.81278265) == 63);
    assert(sm510_direct_half_cycles(440) == 19);
    assert(sm510_direct_half_cycles(1046.5022612) == 8);
    assert(sm510_direct_half_cycles(1830) == 5); // Closest Hz, not closest period.
    assert(sm510_direct_half_cycles((2048.0 + 1638.4) / 2) == 4);
    assert(sm510_direct_half_cycles(1) == 63 && sm510_direct_half_cycles(10000) == 4);
    assert(sm510_direct_half_cycles(0) == 0 && sm510_direct_half_cycles(-1) == 0);
    assert(sm510_direct_half_cycles(INFINITY) == 0 && sm510_direct_half_cycles(NAN) == 0);

    float direct_note[18];
    sm510_render_direct_note(direct_note, 18, 16384, 8);
    for (uint32_t frame = 0; frame < 18; ++frame)
        assert(direct_note[frame] == (frame % 16 < 8 ? 0.16f : 0));
    sm510_render_direct_note(direct_note, 18, 48000, 4);
    assert(direct_note[10] == 0.16f && direct_note[11] == 0.115f && direct_note[12] == 0);
    sm510_render_direct_note(direct_note, 1, 2048, 4);
    assert(direct_note[0] == 0.08f);

    sm510_render_direct_r1(pcm, 10, 32768, events, sizeof events / sizeof events[0] / 2);
    for (uint32_t frame = 0; frame < 10; ++frame)
        assert(pcm[frame] == (expect[frame] == 0 ? 0 : 0.16f));
    sm510_render_direct_r1(pcm, 3, 48000, one_tick, 2);
    assert(pcm[0] == 0.16f && pcm[1] == (float)(0.16 * (48000 - 32768) / 32768) && pcm[2] == 0);
    sm510_render_direct_r1(pcm, 3, 48000, NULL, 0);
    assert(pcm[0] == 0 && pcm[1] == 0 && pcm[2] == 0);

    // Emit a non-integer-rate fixture with edges on and between samples.
    const uint32_t writes[] = {0, 1, 3, 0, 3, 3, 8, 0, 11, 2, 24, 3, 44, 0, 44, 1, 60, 0};
    float reference[2][128];
    const uint32_t write_count = sizeof writes / sizeof writes[0] / 2;
    if (argc == 1) {
        sm510_render_r1(reference[0], 128, 44100, writes, write_count);
        return fwrite(reference[0], sizeof reference[0], 1, stdout) == 1 ? 0 : 1;
    }
    if (argc != 2 || strcmp(argv[1], "--direct") != 0)
        return 2;
    sm510_render_direct_r1(reference[0], 128, 44100, writes, write_count);
    sm510_render_direct_note(reference[1], 128, 44100, sm510_direct_half_cycles(440));
    return fwrite(reference, sizeof reference, 1, stdout) == 1 ? 0 : 1;
}
