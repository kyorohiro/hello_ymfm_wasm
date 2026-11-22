// SPDX-License-Identifier: BSD-3-Clause
#include "sm510.h"

#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

static void test_sm511(void) {
    const uint32_t periods[] = {31, 33, 35, 37, 39, 42, 44, 47, 50, 53, 56, 59};
    for (uint32_t pitch = 2; pitch <= 13; ++pitch) {
        const uint32_t period = periods[pitch - 2];
        assert(sm511_pitch_hz(pitch) == 32768.0 / period);
        assert(sm511_pitch_hz(0x10 | pitch) == 65536.0 / period);
        assert(sm511_pitch_hz(0x30 | pitch) == sm511_pitch_hz(0x10 | pitch));
    }
    const uint8_t silent[] = {0, 1, 0x1e, 0x3f, 0x52};
    for (size_t index = 0; index < sizeof silent; ++index)
        assert(sm511_pitch_hz(silent[index]) == 0);

    float tone[64];
    sm511_render_tone(tone, 64, 32768, 0x12);
    for (uint32_t frame = 0; frame < 64; ++frame) {
        const uint32_t phase = frame % 31;
        const int high = (phase >= 7 && phase < 15) || phase >= 23;
        assert(tone[frame] == (high ? 0.16f : 0));
    }
    sm511_render_tone(tone, 64, 32768, 0x22);
    assert(tone[13] == 0 && tone[14] == 0.16f && tone[29] == 0.16f && tone[30] == 0);
    sm511_render_tone(tone, 64, 48000, 0x12);
    assert(tone[9] == 0 && tone[10] == (float)(0.16 * (11 * 32768 - 7 * 48000) / 32768));
    assert(tone[11] == 0.16f);

    const uint8_t melody[] = {0x12, 0x20, 0x12, 0x01, 0x12};
    float song[16384];
    sm511_render_melody(song, 16384, 32768, melody, sizeof melody);
    assert(song[7] == 0.16f);
    for (uint32_t frame = 2048; frame < 6144; ++frame)
        assert(song[frame] == 0);
    assert(song[6148] == 0 && song[6149] == 0.16f); // Resume after two low ticks.
    for (uint32_t frame = 8192; frame < 16384; ++frame)
        assert(song[frame] == 0);

    const uint8_t narrower[] = {0x0d, 0x12};
    sm511_render_melody(song, 2058, 32768, narrower, sizeof narrower);
    assert(song[2047] == 0.16f && song[2048] == 0.16f);
    assert(song[2049] == 0 && song[2056] == 0 && song[2057] == 0.16f);

    uint8_t rom[257] = {0};
    rom[256] = 0x12;
    sm511_render_melody(song, 257, 16, rom, sizeof rom);
    assert(song[256] == 0);
}

int main(int argc, char **argv) {
    test_sm511();
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
    if (argc == 2 && strcmp(argv[1], "--sm511") == 0) {
        const uint8_t original[] = {0x12, 0x20, 0x0c, 0x01, 0x15};
        float melody[11200];
        sm511_render_tone(reference[0], 128, 44100, 0x12);
        sm511_render_melody(melody, 11200, 44100, original, sizeof original);
        return fwrite(reference[0], sizeof reference[0], 1, stdout) == 1 &&
               fwrite(melody, sizeof melody, 1, stdout) == 1 ? 0 : 1;
    }
    if (argc != 2 || strcmp(argv[1], "--direct") != 0)
        return 2;
    sm510_render_direct_r1(reference[0], 128, 44100, writes, write_count);
    sm510_render_direct_note(reference[1], 128, 44100, sm510_direct_half_cycles(440));
    return fwrite(reference, sizeof reference, 1, stdout) == 1 ? 0 : 1;
}
