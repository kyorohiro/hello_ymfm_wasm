// SPDX-License-Identifier: BSD-3-Clause
#include "sm510.h"

namespace {

constexpr uint32_t master_clock_hz = 32768;
constexpr uint32_t short_slot_ticks = 2048;
constexpr uint32_t rom_capacity = 256;
constexpr uint32_t command_mask = 0x3f;
constexpr uint32_t pitch_mask = 0x0f;
constexpr uint32_t octave_flag = 0x10;
constexpr uint32_t length_flag = 0x20;
constexpr double high_level = 0.16;

// Sharp 1990 Microcomputers Data Book, p. 166, Fig. 5. Each row gives
// the widths in master ticks of the four phases low, high, low, high.
constexpr uint8_t high_octave_phases[][4] = {
    { 7,  8,  8,  8}, // 2, C
    { 8,  8,  8,  9},
    { 8,  9,  9,  9},
    { 9,  9,  9, 10},
    { 9, 10, 10, 10},
    {10, 11, 10, 11},
    {11, 11, 11, 11},
    {11, 12, 12, 12},
    {12, 13, 12, 13},
    {13, 13, 13, 14},
    {14, 14, 14, 14},
    {14, 15, 15, 15}, // D, C sharp
};

const uint8_t *phase_widths(uint32_t command) {
    const uint32_t pitch = command & pitch_mask;
    if (command > command_mask || pitch < 2 || pitch > 13)
        return nullptr;
    return high_octave_phases[pitch - 2];
}

uint32_t octave_scale(uint32_t command) {
    return command & octave_flag ? 1 : 2;
}

struct span {
    uint32_t ticks;
    bool high;
};

class melody_cursor {
public:
    melody_cursor(const uint8_t *rom, uint32_t count, bool sustained)
        : rom_(rom), count_(count), sustained_(sustained) {}

    span next() {
        if (slot_left_ == 0) {
            if (count_ == 0)
                return {0, false};
            const uint32_t command = *rom_;
            if (command <= command_mask && (command & pitch_mask) == 1)
                return {0, false};
            widths_ = phase_widths(command);
            scale_ = octave_scale(command);
            slot_left_ = command & length_flag ? 2 * short_slot_ticks : short_slot_ticks;
            if (!sustained_) {
                ++rom_;
                --count_;
            }
        }
        if (!widths_) {
            const uint32_t rest = slot_left_;
            slot_left_ = 0;
            return {rest, false};
        }

        const uint32_t width = widths_[phase_] * scale_;
        // A narrower new pitch still emits the current phase for one tick.
        // The sequencer advances phase only after outputting that tick.
        const uint32_t until_change = phase_elapsed_ < width ? width - phase_elapsed_ : 1;
        const uint32_t ticks = until_change < slot_left_ ? until_change : slot_left_;
        const bool high = (phase_ & 1) != 0;
        slot_left_ -= ticks;
        if (ticks == until_change) {
            phase_ = (phase_ + 1) % 4;
            phase_elapsed_ = 0;
        } else {
            phase_elapsed_ += ticks;
        }
        return {ticks, high};
    }

private:
    const uint8_t *rom_;
    uint32_t count_;
    bool sustained_;
    const uint8_t *widths_ = nullptr;
    uint32_t scale_ = 1;
    uint32_t slot_left_ = 0;
    uint32_t phase_ = 0;
    uint32_t phase_elapsed_ = 0;
};

void render(float *output, uint32_t frames, uint32_t sample_rate, melody_cursor voice) {
    if (output == nullptr || frames == 0 || sample_rate == 0)
        return;

    // Times are scaled by the sample rate so both master-clock ticks and
    // sample boundaries are exact integers.
    uint64_t time = 0;
    uint64_t span_end = 0;
    bool high = false;
    for (uint32_t frame = 0; frame < frames; ++frame) {
        const uint64_t sample_end = time + master_clock_hz;
        uint64_t high_time = 0;
        while (time < sample_end) {
            if (time == span_end) {
                const auto next = voice.next();
                high = next.high;
                span_end = next.ticks == 0 ? UINT64_MAX : time + static_cast<uint64_t>(next.ticks) * sample_rate;
            }
            const uint64_t overlap_end = span_end < sample_end ? span_end : sample_end;
            if (high)
                high_time += overlap_end - time;
            time = overlap_end;
        }
        output[frame] = static_cast<float>(high_level * static_cast<double>(high_time) / master_clock_hz);
    }
}

} // namespace

double sm511_pitch_hz(uint32_t command) {
    const auto *widths = phase_widths(command);
    if (!widths)
        return 0;
    const uint32_t period = widths[0] + widths[1] + widths[2] + widths[3];
    return 2.0 * master_clock_hz / (period * octave_scale(command));
}

void sm511_render_tone(float *output, uint32_t frames, uint32_t sample_rate, uint32_t command) {
    const auto word = static_cast<uint8_t>(command <= command_mask ? command & ~length_flag : 0);
    render(output, frames, sample_rate, melody_cursor(&word, 1, true));
}

void sm511_render_melody(float *output, uint32_t frames, uint32_t sample_rate,
                         const uint8_t *rom, uint32_t count) {
    if (rom == nullptr)
        count = 0;
    else if (count > rom_capacity)
        count = rom_capacity;
    render(output, frames, sample_rate, melody_cursor(rom, count, false));
}
