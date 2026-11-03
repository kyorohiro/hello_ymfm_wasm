#pragma once

#include <algorithm>
#include <cstdint>
#include "ymfm.h"

// Timers use master clocks, independently of each chip's output sample rate.
struct ymfm_wasm_interface : public ymfm::ymfm_interface
{
    bool irq_asserted = false;
    int64_t timer_remaining[2] = {-1, -1};

    void ymfm_update_irq(bool asserted) override { irq_asserted = asserted; }

    void ymfm_set_timer(uint32_t timer, int32_t clocks) override
    {
        timer_remaining[timer] = clocks < 0 ? -1 : clocks;
    }

    void advance(uint32_t clocks)
    {
        while (clocks != 0)
        {
            uint32_t step = clocks;
            for (auto remaining : timer_remaining)
                if (remaining >= 0)
                    step = std::min(step, static_cast<uint32_t>(remaining));
            for (auto &remaining : timer_remaining)
                if (remaining >= 0)
                    remaining -= step;
            clocks -= step;
            for (uint32_t timer = 0; timer < 2; ++timer)
                if (timer_remaining[timer] == 0)
                {
                    timer_remaining[timer] = -1;
                    // The engine may rearm the timer from this callback.
                    m_engine->engine_timer_expired(timer);
                }
        }
    }

    template<typename Chip>
    void advance_sample(const Chip &chip)
    {
        if (timer_remaining[0] < 0 && timer_remaining[1] < 0)
            return;
        // Divisible by all output clock divisors of the wrapped OPN chips;
        // avoids rounding the actual (often fractional) output sample rate.
        constexpr uint32_t reference_clock = 1440000;
        advance(reference_clock / chip.sample_rate(reference_clock));
    }
};
