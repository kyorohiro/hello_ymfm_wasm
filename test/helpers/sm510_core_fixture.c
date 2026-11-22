// SPDX-License-Identifier: BSD-3-Clause
#include "sm510.h"

#include <assert.h>
#include <stdio.h>

int main(void) {
    assert(sm510_output_pins(3, 3, 0) == 2);
    assert(sm510_output_pins(4, 3, 0) == 1);
    assert(sm510_output_pins(8, 3, 0) == 2);
    assert(sm510_output_pins(0, 1, 0) == 0);
    assert(sm510_output_pins(4, 2, 0) == 0);
    assert(sm510_output_pins(4, 15, 1) == 3);
    assert(sm510_output_pins(0, 12, 1) == 0);

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

    // Emit a non-integer-rate fixture with edges on and between samples.
    const uint32_t writes[] = {0, 1, 3, 0, 3, 3, 8, 0, 11, 2, 24, 3, 44, 0, 44, 1, 60, 0};
    float reference[128];
    sm510_render_r1(reference, 128, 44100, writes, sizeof writes / sizeof writes[0] / 2);
    return fwrite(reference, sizeof reference, 1, stdout) == 1 ? 0 : 1;
}
