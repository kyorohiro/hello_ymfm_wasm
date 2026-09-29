#include "chip_state.h"
#ifndef SEGAPSG_H
#define SEGAPSG_H

#pragma once

#include <cstdint>

class SegaPSG
{
public:
    static constexpr uint32_t DEFAULT_CLOCK = 3579545;
    static constexpr uint32_t DEFAULT_SAMPLE_RATE = 44100;

    SegaPSG(uint32_t sample_rate = DEFAULT_SAMPLE_RATE, uint32_t clock = DEFAULT_CLOCK);

    void reset();
    void write(uint8_t data);
    void generate(float *left, float *right, uint32_t frames);

    uint32_t sample_rate() const { return m_sample_rate; }
    uint32_t clock() const { return m_clock; }

    void state(std::vector<uint8_t> &bytes, bool saving) {
        ChipStateIO io{bytes, saving};
        io.field(m_sample_rate); io.field(m_clock); io.field(m_clock_accumulator);
        for (auto &ch : m_tone) { io.field(ch.period); io.field(ch.counter); io.field(ch.output_high); io.field(ch.volume); }
        io.field(m_noise_lfsr); io.field(m_noise_control); io.field(m_noise_volume);
        io.field(m_noise_counter); io.field(m_noise_output_high); io.field(m_latched_channel); io.field(m_latched_volume);
    }
private:
    struct ToneChannel
    {
        uint16_t period;
        uint16_t counter;
        bool output_high;
        uint8_t volume;
    };

    void clock_generator();
    void reload_noise_counter();
    uint16_t tone_period(uint32_t channel) const;
    float tone_level(uint32_t channel) const;
    float noise_level() const;

    uint32_t m_sample_rate;
    uint32_t m_clock;
    uint32_t m_clock_accumulator;

    ToneChannel m_tone[3];
    uint16_t m_noise_lfsr;
    uint8_t m_noise_control;
    uint8_t m_noise_volume;
    uint16_t m_noise_counter;
    bool m_noise_output_high;

    uint8_t m_latched_channel;
    bool m_latched_volume;
};

#endif
