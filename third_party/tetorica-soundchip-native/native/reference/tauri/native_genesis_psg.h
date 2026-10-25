// Shared Native Sega PSG renderer. No device, OPLL or Genesis core is owned.
#pragma once
#include "segapsg.h"
#include <array>
#include <cmath>

struct NativePsgCore {
    static constexpr uint32_t BASE_CLOCK = 3579545;
    SegaPSG psg;
    uint32_t psg_clock = BASE_CLOCK, psg_mute_mask = 0;
    double psg_remainder = 0, psg_left = 0, psg_right = 0;
    std::array<uint16_t, 3> periods{};
    std::array<uint8_t, 4> attenuation{{15, 15, 15, 15}}, levels{};
    uint8_t latch = 0, noise_mode = 0, stereo = 255;
    explicit NativePsgCore(uint32_t rate) : psg(rate, BASE_CLOCK) {}
    void psg_write(uint8_t value, bool author = true) {
        if (value & 128) latch = (value >> 4) & 7;
        const uint8_t channel = latch >> 1;
        if (latch & 1) { attenuation[channel] = value & 15; if (author && (value & 15) != 15) levels[channel] = value & 15; }
        else if (channel == 3) noise_mode = value & 7;
        else if (value & 128) periods[channel] = (periods[channel] & 0x3f0) | (value & 15);
        else periods[channel] = (periods[channel] & 15) | ((value & 63) << 4);
        psg.write(value);
    }
    void psg_key_off(uint8_t channel) { if (channel < 4) psg_write(0x9f | (channel << 5), false); }
    void psg_audition(uint8_t channel) { if (channel < 4) psg_write(0x90 | (channel << 5) | levels[channel], false); }
    void psg_stop() { for (uint8_t channel = 0; channel < 4; ++channel) psg_key_off(channel); psg_left = psg_right = 0; }
    void psg_reset() {
        psg.reset(); psg.set_mute_mask(psg_mute_mask); periods.fill(0); attenuation.fill(15); levels.fill(0);
        latch = noise_mode = 0; stereo = 255; psg_remainder = psg_left = psg_right = 0;
    }
    void psg_stereo(uint8_t mask) { stereo = mask; psg.set_stereo(mask); }
    void psg_mute(uint32_t mask) { psg_mute_mask = mask & 15; psg.set_mute_mask(psg_mute_mask); psg_left = psg_right = 0; }
    void sample_psg(float *left, float *right) {
        // Keep the original creation-clock core and fractional phase across
        // clock edits, exactly as Browser ChipClockResampler average/hold does.
        psg_remainder += double(psg_clock) / BASE_CLOCK;
        const uint32_t count = uint32_t(std::floor(psg_remainder)); psg_remainder -= count;
        if (count) {
            double l = 0, r = 0; float a, b;
            for (uint32_t i = 0; i < count; ++i) { psg.generate(&a, &b, 1); l += a; r += b; }
            psg_left = l / count; psg_right = r / count;
        }
        *left = float(psg_left); *right = float(psg_right);
    }
};
