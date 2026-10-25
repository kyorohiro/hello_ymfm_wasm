// SPDX-License-Identifier: BSD-3-Clause
// Uses the existing browser MAME Game Boy adaptation without DSP changes.
#include "native_genesis_gameboy.h"
#include "gameboy_apu.h"
#include <cmath>
#include <cstring>
#include <new>

namespace {
constexpr uint32_t BASE_CLOCK = 4194304;
struct NativeGameboy {
    GameboyApu chip;
    uint32_t clock = BASE_CLOCK;
    bool clockResamplerActive = false;
    double ratio = 1.0, remainder = 0.0;
    float left = 0.0f, right = 0.0f;
    explicit NativeGameboy(uint32_t rate) : chip(rate, BASE_CLOCK) {}
};
}

// The pinned header adds this friend only. Reading live counters and silencing
// gates neither changes a synthesis algorithm nor replays/reset voice registers.
struct NativeGameboyAccess {
    static void stop(GameboyApu &chip, int channel) {
        if (channel < 0) {
            for (auto &ch : chip.channels) ch.on = false;
            chip.lastLeft = {};
            chip.lastRight = {};
        } else if (channel < 4) {
            chip.channels[channel].on = false;
            chip.lastLeft[channel] = chip.lastRight[channel] = 0.0f;
        }
    }
    static void state(const NativeGameboy &native, NativeGameboyState &out) {
        std::memset(&out, 0, sizeof(out));
        const auto &chip = native.chip;
        for (int channel = 0; channel < 4; ++channel) {
            for (int index = 0; index < 5; ++index) {
                const int address = channel * 5 + index;
                out.registers[address] = chip.channels[channel].reg[index];
            }
            out.registers[channel * 5 + 4] &= 0x7f; // Trigger is an event, never replay it.
            if (chip.channels[channel].on) out.active_mask |= 1u << channel;
            if (chip.chanLeft[channel]) out.registers[21] |= 16 << channel;
            if (chip.chanRight[channel]) out.registers[21] |= 1 << channel;
        }
        // Preserve the core's current NR50 interpretation, including its output
        // convention. This snapshot reconstructs the byte written by the API.
        out.registers[20] = chip.volLeft | (chip.volRight << 4);
        out.registers[22] = (chip.powerOn ? 0x80 : 0) | out.active_mask;
        for (int index = 0; index < 16; ++index) out.registers[32 + index] = chip.waveRam[index];
        out.clock = native.clock;
        out.source_mute_mask = chip.mute_mask;
    }
};

extern "C" {
void *native_gameboy_create(uint32_t rate) {
    if (!rate || rate > 384000) return nullptr;
    return new (std::nothrow) NativeGameboy(rate);
}
void native_gameboy_destroy(void *ptr) { delete static_cast<NativeGameboy *>(ptr); }
void native_gameboy_reset(void *ptr) {
    auto &native = *static_cast<NativeGameboy *>(ptr);
    native.chip.reset();
    native.remainder = 0;
    native.left = native.right = 0;
}
void native_gameboy_stop(void *ptr) {
    auto &native = *static_cast<NativeGameboy *>(ptr);
    NativeGameboyAccess::stop(native.chip, -1);
    native.left = native.right = 0;
}
void native_gameboy_stop_channel(void *ptr, uint8_t channel) {
    auto &native = *static_cast<NativeGameboy *>(ptr);
    NativeGameboyAccess::stop(native.chip, channel);
}
void native_gameboy_write(void *ptr, uint8_t address, uint8_t value) {
    if (address < 48) static_cast<NativeGameboy *>(ptr)->chip.write(address, value);
}
int native_gameboy_set_clock(void *ptr, uint32_t hz) {
    if (hz < 100000 || hz > 100000000) return 0;
    auto &native = *static_cast<NativeGameboy *>(ptr);
    // The Browser Worklet creates its outer resampler at the first accepted
    // clock edit. In particular, its first sub-base-clock held frame is zero.
    // Later edits preserve the existing fractional phase and held sample.
    if (!native.clockResamplerActive) {
        native.clockResamplerActive = true;
        native.remainder = 0;
        native.left = native.right = 0;
    }
    native.clock = hz;
    native.ratio = double(hz) / double(BASE_CLOCK);
    return 1;
}
void native_gameboy_set_mute_mask(void *ptr, uint32_t mask) {
    static_cast<NativeGameboy *>(ptr)->chip.set_mute_mask(mask);
}
void native_gameboy_sample(void *ptr, float *left, float *right) {
    auto &native = *static_cast<NativeGameboy *>(ptr);
    native.remainder += native.ratio;
    const uint32_t count = uint32_t(std::floor(native.remainder));
    native.remainder -= count;
    if (count) {
        double sumLeft = 0, sumRight = 0;
        for (uint32_t i = 0; i < count; ++i) {
            float l, r;
            native.chip.generate(&l, &r, 1);
            sumLeft += l;
            sumRight += r;
        }
        native.left = float(sumLeft / count);
        native.right = float(sumRight / count);
    }
    *left = native.left;
    *right = native.right;
}
void native_gameboy_get_state(void *ptr, NativeGameboyState *state) {
    NativeGameboyAccess::state(*static_cast<NativeGameboy *>(ptr), *state);
}
}
