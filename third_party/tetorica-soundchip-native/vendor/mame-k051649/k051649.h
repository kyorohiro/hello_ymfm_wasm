// license:BSD-3-Clause
// copyright-holders:Bryan McPhail
// Standalone adaptation; see README.md for pinned MAME source and output model.
#pragma once
#include <cstdint>
#include <array>
class K051649 {
public:
    K051649(uint32_t rate, uint32_t clock);
    void reset();
    // VGM 0xD2 command shape: port selects the register group (0=SCC waveform,
    // 1=frequency, 2=volume, 3=key on/off, 4=SCC+/052539 waveform, 5=test),
    // reg is the offset within that group.
    void write(uint8_t port, uint8_t reg, uint8_t value);
    void generate(float *left, float *right, uint32_t frames);
    uint32_t sample_rate() const { return rate; }
    void set_mute_mask(uint32_t mask) { mute_mask = mask & 0x1f; }
    // One native-clock tick, before host resampling or muting.
    std::array<float, 5> tick();
private:
    struct channel_t {
        uint16_t counter = 0;
        uint16_t clock_phase = 0;
        uint16_t frequency = 0;
        uint8_t volume = 0xf;
        int16_t sample = 0;
        bool key = false;
        int8_t waveram[32]{};
    };
    channel_t channels[5];
    uint8_t test = 0;
    uint32_t rate, clock;
    uint32_t mute_mask = 0;
    // Integer phase units: each output sample spans `clock` units, and each
    // native tick spans `rate` units (the device's own stream runs at clock()).
    uint64_t tick_remaining = 0;
    std::array<float, 5> last{};
};
