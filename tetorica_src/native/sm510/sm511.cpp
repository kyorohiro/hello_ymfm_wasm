// SPDX-License-Identifier: BSD-3-Clause
#include "sm510.h"

namespace {

struct controller_storage {
    void *address;
};

} // namespace

// Both the native caller and the freestanding WASM caller provide storage.
void *operator new(decltype(sizeof(0)), controller_storage storage) noexcept {
    return storage.address;
}

namespace {

constexpr uint32_t master_clock_hz = 32768;
constexpr uint32_t short_slot_ticks = 2048;
constexpr uint32_t step_ticks = short_slot_ticks / 16;
constexpr uint32_t rom_capacity = 256;
constexpr uint32_t command_mask = 0x3f;
constexpr uint32_t pitch_mask = 0x0f;
constexpr uint32_t octave_flag = 0x10;
constexpr uint32_t length_flag = 0x20;
constexpr uint8_t stop_word = 0x01;
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
            if (command <= command_mask && (command & pitch_mask) == stop_word)
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

struct melody_controller {
    uint8_t rom[rom_capacity];
    uint32_t master_tick = 0;
    uint32_t event_index = 0;
    uint32_t sample_rate = 0;
    uint32_t tick_left = 0;
    uint32_t phase = 0;
    uint32_t phase_elapsed = 0;
    uint32_t step_count = 0;
    uint8_t address = 0;
    bool enabled = false;
    bool stop_flag = false;
    bool pin = false;
    bool long_step = false;

    melody_controller() { load(nullptr, 0); }

    void load(const uint8_t *words, uint32_t count) {
        if (!words)
            count = 0;
        else if (count > rom_capacity)
            count = rom_capacity;
        for (uint32_t i = 0; i < count; ++i)
            rom[i] = words[i] & command_mask;
        for (uint32_t i = count; i < rom_capacity; ++i)
            rom[i] = stop_word;
    }

    uint32_t apply(uint32_t op, uint32_t arg) {
        switch (op) {
        case SM511_PRE:
            address = static_cast<uint8_t>(arg);
            step_count = 0;
            break;
        case SM511_SME:
            enabled = true;
            break;
        case SM511_RME:
            enabled = false;
            break;
        case SM511_TMEL: {
            const bool was_stopped = stop_flag;
            stop_flag = false;
            return was_stopped;
        }
        }
        return 0;
    }

    void begin_tick(const uint32_t *events, uint32_t count) {
        while (events && event_index < count) {
            const auto *event = events + 3 * static_cast<decltype(sizeof(0))>(event_index);
            if (event[0] > master_tick)
                break;
            ++event_index;
            if (event[0] == master_tick)
                apply(event[1], event[2]);
        }

        const uint8_t command = rom[address];
        const auto *widths = phase_widths(command);
        pin = false;
        if (widths) {
            pin = enabled && (phase & 1);
            if (++phase_elapsed >= widths[phase] * octave_scale(command)) {
                phase_elapsed = 0;
                phase = (phase + 1) % 4;
            }
        } else if ((command & pitch_mask) == stop_word) {
            stop_flag = true;
        }
        long_step = (command & length_flag) != 0;
        tick_left = sample_rate;
    }

    void end_tick() {
        // The first divider edge arrives after 128 master ticks. Use the
        // command that drove R during the interval ending at the edge.
        if (++master_tick % step_ticks == 0) {
            step_count = (step_count + 1) & (long_step ? 31 : 15);
            if (step_count == 0)
                ++address;
        }
    }

    void render(float *output, uint32_t frames, uint32_t rate, const uint32_t *events, uint32_t count) {
        if (tick_left && rate != sample_rate) {
            // Keep progress through the current oscillator tick if the
            // caller changes sample rates between blocks.
            const uint64_t remaining = static_cast<uint64_t>(tick_left) * rate / sample_rate;
            tick_left = remaining ? static_cast<uint32_t>(remaining) : 1;
        }
        sample_rate = rate;
        for (uint32_t frame = 0; frame < frames; ++frame) {
            uint32_t sample_left = master_clock_hz;
            uint32_t high_time = 0;
            while (sample_left) {
                if (!tick_left)
                    begin_tick(events, count);
                const uint32_t span = sample_left < tick_left ? sample_left : tick_left;
                if (pin)
                    high_time += span;
                sample_left -= span;
                tick_left -= span;
                if (!tick_left)
                    end_tick();
            }
            output[frame] = static_cast<float>(high_level * high_time / master_clock_hz);
        }
    }
};

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

uint32_t sm511_controller_size(void) {
    return sizeof(melody_controller);
}

void sm511_controller_reset(void *storage) {
    if (storage)
        new (controller_storage{storage}) melody_controller;
}

void sm511_controller_load(void *storage, const uint8_t *rom, uint32_t count) {
    if (storage)
        static_cast<melody_controller *>(storage)->load(rom, count);
}

uint32_t sm511_controller_apply(void *storage, uint32_t op, uint32_t arg) {
    return storage ? static_cast<melody_controller *>(storage)->apply(op, arg) : 0;
}

void sm511_controller_state(void *storage, uint32_t *output) {
    if (!storage || !output)
        return;
    const auto &controller = *static_cast<melody_controller *>(storage);
    output[0] = controller.address;
    output[1] = controller.enabled;
    output[2] = controller.stop_flag;
    output[3] = controller.pin;
    output[4] = controller.master_tick;
}

void sm511_controller_render(void *storage, float *output, uint32_t frames, uint32_t sample_rate,
                              const uint32_t *events, uint32_t count) {
    if (storage && output && frames && sample_rate)
        static_cast<melody_controller *>(storage)->render(output, frames, sample_rate, events, count);
}
