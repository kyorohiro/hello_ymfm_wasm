// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro
// See LICENSE and README.md in this directory.

#include "segapsg.h"

#include <array>

namespace
{

constexpr std::array<float, 16> VOLUME_TABLE = {
    1.0f,
    0.7943282f,
    0.63095737f,
    0.5011872f,
    0.39810717f,
    0.31622776f,
    0.25118864f,
    0.19952624f,
    0.15848932f,
    0.12589253f,
    0.1f,
    0.07943282f,
    0.06309573f,
    0.050118722f,
    0.039810717f,
    0.0f,
};

constexpr float OUTPUT_GAIN = 0.2f;

} // namespace

SegaPSG::SegaPSG(uint32_t sample_rate, uint32_t clock) :
    m_sample_rate(sample_rate),
    m_clock(clock),
    m_clock_accumulator(0),
    m_noise_lfsr(0x8000),
    m_noise_control(0),
    m_noise_volume(0x0f),
    m_noise_counter(0x10),
    m_noise_output_high(false),
    m_latched_channel(0),
    m_latched_volume(false)
{
    reset();
}

void SegaPSG::reset()
{
    m_clock_accumulator = 0;
    m_stereo_mask = 0xff;

    for (auto &channel : m_tone)
    {
        // Sega VDP PSG tone registers reset to 0.
        channel.period = 0;
        channel.counter = 1;
        channel.output_high = true;
        channel.volume = 0x0f;
    }

    m_noise_lfsr = 0x8000;
    m_noise_control = 0;
    m_noise_volume = 0x0f;
    m_noise_counter = 0x10;
    m_noise_output_high = false;

    m_latched_channel = 0;
    m_latched_volume = false;
}

void SegaPSG::write(uint8_t data)
{
    if ((data & 0x80) != 0)
    {
        m_latched_channel = (data >> 5) & 0x03;
        m_latched_volume = (data & 0x10) != 0;

        const uint8_t nibble = data & 0x0f;

        if (m_latched_channel < 3)
        {
            if (m_latched_volume)
            {
                m_tone[m_latched_channel].volume = nibble;
            }
            else
            {
                m_tone[m_latched_channel].period =
                    static_cast<uint16_t>(
                        (m_tone[m_latched_channel].period & 0x03f0) |
                        nibble
                    );

                if (m_tone[m_latched_channel].counter >
                    tone_period(m_latched_channel))
                {
                    m_tone[m_latched_channel].counter =
                        tone_period(m_latched_channel);
                }
            }
        }
        else
        {
            if (m_latched_volume)
            {
                m_noise_volume = nibble;
            }
            else
            {
                m_noise_control = nibble & 0x07;
                m_noise_lfsr = 0x8000;
                m_noise_output_high = false;
                reload_noise_counter();
            }
        }

        return;
    }

    if (m_latched_channel < 3)
    {
        if (m_latched_volume)
        {
            m_tone[m_latched_channel].volume = data & 0x0f;
        }
        else
        {
            m_tone[m_latched_channel].period =
                static_cast<uint16_t>(
                    (m_tone[m_latched_channel].period & 0x000f) |
                    ((data & 0x3f) << 4)
                );

            if (m_tone[m_latched_channel].counter >
                tone_period(m_latched_channel))
            {
                m_tone[m_latched_channel].counter =
                    tone_period(m_latched_channel);
            }
        }

        return;
    }

    // Channel 3 is the noise channel.
    // Data bytes must also update the currently latched noise register.
    if (m_latched_volume)
    {
        m_noise_volume = data & 0x0f;
    }
    else
    {
        m_noise_control = data & 0x07;
        m_noise_lfsr = 0x8000;
        m_noise_output_high = false;
        reload_noise_counter();
    }
}

void SegaPSG::generate(float *left, float *right, uint32_t frames)
{
    // The SN76489 tone/noise generators run at input clock / 16.
    const uint32_t clocks_per_tick = m_sample_rate * 16;

    for (uint32_t index = 0; index < frames; index++)
    {
        m_clock_accumulator += m_clock;

        while (m_clock_accumulator >= clocks_per_tick)
        {
            m_clock_accumulator -= clocks_per_tick;
            clock_generator();
        }

        float mixed_left = 0.0f, mixed_right = 0.0f;
        for (uint32_t channel = 0; channel < 4; channel++)
        {
            if (m_mute_mask & (1 << channel)) continue;
            const float level = channel < 3 ? tone_level(channel) : noise_level();
            // Game Gear stereo register: low nibble right, high nibble left.
            // The default 0xff retains Genesis / Master System mono output.
            if (m_stereo_mask & (1 << channel)) mixed_right += level;
            if (m_stereo_mask & (0x10 << channel)) mixed_left += level;
        }
        left[index] = mixed_left * OUTPUT_GAIN;
        right[index] = mixed_right * OUTPUT_GAIN;
    }
}

void SegaPSG::clock_generator()
{
    for (uint32_t index = 0; index < 3; index++)
    {
        auto &channel = m_tone[index];

        // Tone period 0 or 1 produces a constant +1 output.
        if (channel.period <= 1)
        {
            channel.output_high = true;
            channel.counter = 1;
            continue;
        }

        if (channel.counter > 0)
        {
            channel.counter--;
        }

        if (channel.counter == 0)
        {
            channel.counter = tone_period(index);
            channel.output_high = !channel.output_high;
        }
    }

    if (m_noise_counter > 0)
    {
        m_noise_counter--;
    }

    if (m_noise_counter == 0)
    {
        reload_noise_counter();

        /*
         * The noise generator has an internal divider output.
         * The LFSR is clocked only on the 0 -> 1 transition,
         * not on every counter expiration.
         */
        m_noise_output_high = !m_noise_output_high;

        if (m_noise_output_high)
        {
            const bool white_noise =
                (m_noise_control & 0x04) != 0;

            const uint16_t bit0 =
                m_noise_lfsr & 0x0001;

            const uint16_t feedback =
                white_noise
                    ? static_cast<uint16_t>(
                        (
                            bit0 ^
                            ((m_noise_lfsr >> 3) & 0x0001)
                        ) & 0x0001
                    )
                    : bit0;

            m_noise_lfsr =
                static_cast<uint16_t>(
                    (m_noise_lfsr >> 1) |
                    (feedback << 15)
                );
        }
    }
}

void SegaPSG::reload_noise_counter()
{
    static constexpr uint16_t NOISE_PERIODS[4] = {
        0x10,
        0x20,
        0x40,
        0x00,
    };

    const uint8_t mode = m_noise_control & 0x03;

    if (mode == 0x03)
    {
        // Noise frequency follows tone channel 2.
        m_noise_counter = tone_period(2);
    }
    else
    {
        m_noise_counter = NOISE_PERIODS[mode];
    }

    if (m_noise_counter == 0)
    {
        m_noise_counter = 1;
    }
}

uint16_t SegaPSG::tone_period(uint32_t channel) const
{
    const uint16_t period = m_tone[channel].period;

    // Internally keep the counter valid even though period 0/1
    // has special constant-output behaviour.
    return period == 0 ? 1 : period;
}

float SegaPSG::tone_level(uint32_t channel) const
{
    const auto &tone = m_tone[channel];

    const float amplitude =
        VOLUME_TABLE[tone.volume & 0x0f];

    // SN76489 period 0 or 1 behaves as constant +1 output.
    if (tone.period <= 1)
    {
        return amplitude;
    }

    return tone.output_high
        ? amplitude
        : -amplitude;
}

float SegaPSG::noise_level() const
{
    const float amplitude =
        VOLUME_TABLE[m_noise_volume & 0x0f];

    // The PSG noise output is taken from bit 0 of the LFSR.
    return (m_noise_lfsr & 0x0001) != 0
        ? amplitude
        : -amplitude;
}
