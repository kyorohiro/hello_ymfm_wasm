// license:BSD-3-Clause
// copyright-holders:Bryan McPhail
#include "k051649.h"
#include <algorithm>

K051649::K051649(uint32_t sample_rate, uint32_t input_clock)
 : rate(sample_rate), clock(input_clock) {
    reset();
}

void K051649::reset() {
    for (auto &ch : channels) {
        ch.frequency = 0;
        ch.volume = 0xf;
        ch.counter = 0;
        ch.clock_phase = 0;
        ch.key = false;
        ch.sample = 0;
        std::fill(std::begin(ch.waveram), std::end(ch.waveram), int8_t(0));
    }
    test = 0;
    tick_remaining = 0;
    last = {};
}

// Register groups mirror the MAME device's k051649_waveform_w / _frequency_w /
// _volume_w / _keyonoff_w / k052539_waveform_w / _test_w entry points. VGM's
// 0xD2 command picks the group via `port` and passes that group's own
// `offset` as `reg`, so each case below takes the same `reg` MAME would.
void K051649::write(uint8_t port, uint8_t reg, uint8_t value) {
    switch (port & 7) {
        case 0: { // SCC waveform (channel 5 shares waveram with channel 4)
            if ((test & 0x40) || ((test & 0x80) && reg >= 0x60)) return;
            const int slot = reg & 0x1f;
            if (reg >= 0x60) {
                channels[3].waveram[slot] = int8_t(value);
                channels[4].waveram[slot] = int8_t(value);
            } else {
                channels[(reg >> 5) & 3].waveram[slot] = int8_t(value);
            }
            break;
        }
        case 1: { // frequency (reg = channel*2 + hi/lo)
            const int ch = (reg >> 1) & 7;
            if (ch >= 5) return;
            if (reg & 1)
                channels[ch].frequency = (channels[ch].frequency & 0x0ff) | ((value << 8) & 0xf00);
            else
                channels[ch].frequency = (channels[ch].frequency & 0xf00) | value;
            if (test & 0x20) channels[ch].counter = 0;
            break;
        }
        case 2: { // volume (reg = channel index)
            const int ch = reg & 7;
            if (ch >= 5) return;
            channels[ch].volume = value & 0xf;
            break;
        }
        case 3: // key on/off, one bit per channel
            for (int ch = 0; ch < 5; ch++) channels[ch].key = (value >> ch) & 1;
            break;
        case 4: { // SCC+/052539 waveform: 5 independent 32-byte tables, no sharing
            const int ch = (reg >> 5) & 7;
            if (ch >= 5) return;
            channels[ch].waveram[reg & 0x1f] = int8_t(value);
            break;
        }
        case 5: // test register
            test = value;
            break;
        default:
            break;
    }
}

std::array<float, 5> K051649::tick() {
    for (auto &ch : channels) {
        // Channel is halted for frequency < 9, matching MAME's k051649_device.
        if (ch.frequency > 8) {
            if (++ch.clock_phase > ch.frequency) {
                ch.counter = (ch.counter + 1) & 0x1f;
                ch.clock_phase = 0;
            }
            if (ch.clock_phase == 0) {
                ch.sample = int16_t((ch.key ? ch.waveram[ch.counter] : 0) * int(ch.volume));
            }
        }
    }
    for (int ch = 0; ch < 5; ch++) last[ch] = float(channels[ch].sample >> 4) / 1024.0f;
    return last;
}

void K051649::generate(float *left, float *right, uint32_t frames) {
    for (uint32_t i = 0; i < frames; i++) {
        uint64_t remaining = clock;
        double sum = 0;
        while (remaining) {
            if (!tick_remaining) { last = tick(); tick_remaining = uint64_t(rate); }
            auto duration = std::min(remaining, tick_remaining);
            for (int ch = 0; ch < 5; ch++) if (!(mute_mask & (1u << ch))) sum += last[ch] * double(duration);
            remaining -= duration; tick_remaining -= duration;
        }
        left[i] = right[i] = float(sum / double(clock));
    }
}
