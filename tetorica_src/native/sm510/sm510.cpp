// SPDX-License-Identifier: BSD-3-Clause
#include "sm510.h"

#include <float.h>

namespace {

constexpr uint32_t master_clock_hz = 32768;
constexpr uint32_t ticks_per_machine_cycle = 2;
constexpr uint32_t machine_cycle_hz = master_clock_hz / ticks_per_machine_cycle;
constexpr uint32_t half_period_ticks = 4;
constexpr uint32_t min_direct_half_cycles = 4;
constexpr uint32_t max_direct_half_cycles = 63;
constexpr uint32_t r1_pin = 1;
constexpr uint32_t r2_pin = 2;

// Area from tick 0 to this time, with time measured in 1/sample_rate
// master ticks. Complete periods cancel, leaving only the current period.
int64_t carrier_area(uint64_t time, uint64_t half_period) {
    const uint64_t period = 2 * half_period;
    const uint64_t phase = time % period;
    if (phase <= half_period)
        return -static_cast<int64_t>(phase);
    return -static_cast<int64_t>(period - phase);
}

uint64_t next_write_time(const uint32_t *events, uint32_t write_count, uint32_t sample_rate) {
    if (write_count == 0)
        return UINT64_MAX;
    return static_cast<uint64_t>(events[0]) * sample_rate;
}

double direct_frequency(uint32_t half_cycles) {
    return static_cast<double>(machine_cycle_hz) / (2 * half_cycles);
}

} // namespace

uint32_t sm510_output_pins(uint32_t master_tick, uint32_t r, uint32_t direct) {
    if (direct != 0)
        return r & (r1_pin | r2_pin);
    const bool high = (master_tick & half_period_ticks) != 0;
    return r & (high ? r1_pin : r2_pin);
}

void sm510_render_r1(float *output, uint32_t frames, uint32_t sample_rate,
                     const uint32_t *events, uint32_t write_count) {
    if (output == nullptr || frames == 0 || sample_rate == 0 || (write_count != 0 && events == nullptr))
        return;

    const uint64_t half_period = static_cast<uint64_t>(half_period_ticks) * sample_rate;
    uint64_t write_time = next_write_time(events, write_count, sample_rate);
    uint64_t sample_start = 0;
    bool enabled = false;
    for (uint32_t frame = 0; frame < frames; ++frame) {
        const uint64_t sample_end = sample_start + master_clock_hz;
        uint64_t segment_start = sample_start;
        int64_t area = 0;
        while (write_time < sample_end) {
            if (enabled)
                area += carrier_area(write_time, half_period) - carrier_area(segment_start, half_period);
            segment_start = write_time;
            enabled = (events[1] & r1_pin) != 0;
            events += 2;
            --write_count;
            write_time = next_write_time(events, write_count, sample_rate);
        }
        if (enabled)
            area += carrier_area(sample_end, half_period) - carrier_area(segment_start, half_period);
        output[frame] = static_cast<float>(0.16 * static_cast<double>(area) / master_clock_hz);
        sample_start = sample_end;
    }
}

uint32_t sm510_direct_half_cycles(double target_hz) {
    if (!(target_hz > 0 && target_hz <= DBL_MAX))
        return 0;

    double higher_hz = direct_frequency(min_direct_half_cycles);
    for (uint32_t half = min_direct_half_cycles; half < max_direct_half_cycles; ++half) {
        const double lower_hz = direct_frequency(half + 1);
        if (target_hz >= (higher_hz + lower_hz) / 2)
            return half;
        higher_hz = lower_hz;
    }
    return max_direct_half_cycles;
}

void sm510_render_direct_note(float *output, uint32_t frames, uint32_t sample_rate,
                              uint32_t half_cycles) {
    if (output == nullptr || frames == 0 || sample_rate == 0 ||
        half_cycles < min_direct_half_cycles || half_cycles > max_direct_half_cycles)
        return;

    const uint64_t half_period = static_cast<uint64_t>(half_cycles) * ticks_per_machine_cycle * sample_rate;
    uint64_t sample_end = 0;
    int64_t previous_area = 0;
    for (uint32_t frame = 0; frame < frames; ++frame) {
        sample_end += master_clock_hz;
        const int64_t current_area = carrier_area(sample_end, half_period);
        // Reverse the divider's phase and convert its signed area to high time.
        const int64_t high_time = (master_clock_hz + previous_area - current_area) / 2;
        output[frame] = static_cast<float>(0.16 * static_cast<double>(high_time) / master_clock_hz);
        previous_area = current_area;
    }
}

void sm510_render_direct_r1(float *output, uint32_t frames, uint32_t sample_rate,
                            const uint32_t *events, uint32_t write_count) {
    if (output == nullptr || frames == 0 || sample_rate == 0 || (write_count != 0 && events == nullptr))
        return;

    uint64_t write_time = next_write_time(events, write_count, sample_rate);
    uint64_t sample_start = 0;
    bool high = false;
    for (uint32_t frame = 0; frame < frames; ++frame) {
        const uint64_t sample_end = sample_start + master_clock_hz;
        uint64_t segment_start = sample_start;
        uint64_t area = 0;
        while (write_time < sample_end) {
            if (high)
                area += write_time - segment_start;
            segment_start = write_time;
            high = (events[1] & r1_pin) != 0;
            events += 2;
            --write_count;
            write_time = next_write_time(events, write_count, sample_rate);
        }
        if (high)
            area += sample_end - segment_start;
        output[frame] = static_cast<float>(0.16 * static_cast<double>(area) / master_clock_hz);
        sample_start = sample_end;
    }
}
