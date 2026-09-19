// license:BSD-3-Clause
// copyright-holders:Hiromitsu Shioya, Olivier Galibert
#include "segapcm.h"
#include <algorithm>
#include <cstring>

namespace {
constexpr uint32_t CLOCK_DIVIDER = 16 * 8; // MaxVoices * 8, matching MAME's sega_315_5218_device
}

SegaPcm::SegaPcm(uint32_t sample_rate, uint32_t input_clock, uint8_t bank_shift, uint8_t bank_mask)
 : bankShift(bank_shift), rate(sample_rate), clock(input_clock) {
    // A zero interface-register mask means "unset"; VGM players (and this
    // chip's own device default) fall back to the common 0x70 bank mask.
    const uint8_t intfMask = bank_mask ? bank_mask : 0x70;
    const uint32_t shiftLimit = bankShift >= 32 ? 0u : (0x1fffffu >> bankShift);
    bankMask = intfMask & shiftLimit;
    reset();
}

void SegaPcm::reset() {
    for (auto &voice : voices) voice = voice_t{};
    tick_remaining = 0;
    lastLeft = {};
    lastRight = {};
}

void SegaPcm::write(uint16_t offset, uint8_t value) {
    if (offset >= 0x100) return; // outside the 16 voices x 8-byte register window
    const int voiceIndex = (offset >> 3) & 0xf;
    const bool highBank = (offset & 0x80) != 0;
    voice_t &voice = voices[voiceIndex];
    switch (offset & 7) {
        case 2: voice.lvol = value; break;
        case 3: voice.rvol = value; break;
        case 4:
            if (highBank) voice.addr = (voice.addr & 0xffff00ffu) | (uint32_t(value) << 8);
            else voice.loop = (voice.loop & 0xff00u) | value;
            break;
        case 5:
            if (highBank) voice.addr = (voice.addr & 0xff00ffffu) | (uint32_t(value) << 16);
            else voice.loop = (voice.loop & 0x00ffu) | (uint16_t(value) << 8);
            break;
        case 6:
            if (highBank) voice.ctrl = value;
            else voice.end = value;
            break;
        case 7:
            if (!highBank) voice.freq = value;
            break;
        default:
            break; // registers 0/1 (and 0x87) are unused scratch, per MAME's own comment table
    }
}

int SegaPcm::loadSampleMemory(const uint8_t *data, uint32_t size, uint32_t offset, uint32_t memorySize) {
    if (memorySize > 0x200000 || offset > memorySize || size > memorySize - offset) return 0;
    rom.resize(memorySize, 0);
    if (size) std::memcpy(rom.data() + offset, data, size);
    return 1;
}

void SegaPcm::clearSampleMemory() {
    rom.clear();
}

void SegaPcm::tick() {
    for (int i = 0; i < NUM_VOICES; i++) {
        voice_t &voice = voices[i];
        float lout = 0, rout = 0;
        if (!(voice.ctrl & 1)) {
            // handle looping if we've hit the end
            if ((voice.addr >> 16) == uint32_t((voice.end + 1) & 0xff)) {
                if (voice.ctrl & 2) {
                    voice.ctrl |= 1;
                    lastLeft[i] = 0;
                    lastRight[i] = 0;
                    continue;
                }
                voice.addr = uint32_t(voice.loop) << 8;
            }
            const uint32_t bank = uint32_t(voice.ctrl & bankMask) << bankShift;
            const uint32_t romAddress = bank + (voice.addr >> 8);
            const int8_t sample = int8_t((romAddress < rom.size() ? rom[romAddress] : 0) - 0x80);
            lout = float(sample) * float(voice.lvol & 0x7f);
            rout = float(sample) * float(voice.rvol & 0x7f);
            voice.addr = (voice.addr + voice.freq) & 0xffffff;
        } else {
            voice.addr &= 0xffff00u;
        }
        lastLeft[i] = lout;
        lastRight[i] = rout;
    }
}

void SegaPcm::generate(float *left, float *right, uint32_t frames) {
    for (uint32_t i = 0; i < frames; i++) {
        uint64_t remaining = clock;
        double sumLeft = 0, sumRight = 0;
        while (remaining) {
            if (!tick_remaining) { tick(); tick_remaining = uint64_t(rate) * CLOCK_DIVIDER; }
            const uint64_t duration = std::min(remaining, tick_remaining);
            for (int voice = 0; voice < NUM_VOICES; voice++) {
                if (mute_mask & (1u << voice)) continue;
                sumLeft += lastLeft[voice] * double(duration);
                sumRight += lastRight[voice] * double(duration);
            }
            remaining -= duration;
            tick_remaining -= duration;
        }
        left[i] = float(sumLeft / (double(clock) * 32768.0));
        right[i] = float(sumRight / (double(clock) * 32768.0));
    }
}
