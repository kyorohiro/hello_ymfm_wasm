// SPDX-License-Identifier: BSD-3-Clause
// Wrapper around the exact standalone MAME adaptation compiled into Web WASM.
#include "native_genesis_huc6280.h"
#include <cmath>
#include <cstring>
#include <new>
// State visibility only. The snapshotted DSP implementation is not modified.
#define private public
#include "huc6280.h"
#undef private
#include "huc6280.cpp"

namespace {
constexpr uint32_t BASE_CLOCK = 3579545;
struct NativeHuc6280 {
    Huc6280 core;
    uint8_t globals[10] = {};
    uint8_t registers[8][8] = {};
    uint32_t clock = BASE_CLOCK;
    bool clock_resampler = false;
    double ratio = 1, remainder = 0, held_left = 0, held_right = 0;
    explicit NativeHuc6280(uint32_t rate) : core(BASE_CLOCK, rate) {}
    void reset() {
        core.reset();
        std::memset(globals, 0, sizeof(globals));
        std::memset(registers, 0, sizeof(registers));
        remainder = held_left = held_right = 0;
    }
    void write(uint32_t reg, uint8_t value, int32_t channel = -1) {
        if (reg > 9) return;
        if (reg == 0 || reg == 1 || reg == 8 || reg == 9) {
            globals[reg] = value;
            core.write(reg, value);
            return;
        }
        const uint8_t selected = core.m_select;
        const uint8_t target = channel >= 0 && channel < 8 ? channel : selected;
        if (selected != target) core.write(0, target);
        registers[target][reg] = value;
        core.write(reg, value);
        if (selected != target) core.write(0, selected);
    }
    void off(uint32_t channel) {
        if (channel < 8) write(4, registers[channel][4] & 127, channel);
    }
    void waveform(uint32_t channel, const uint8_t *samples) {
        if (channel >= 6 || !samples) return;
        const uint8_t control = registers[channel][4];
        const uint8_t dda = core.m_channel[channel].dda;
        write(4, (control & 63) | 64, channel);
        write(4, control & 63, channel);
        for (uint32_t i = 0; i < 32; ++i) write(6, samples[i], channel);
        write(4, control, channel);
        if (control & 64) write(6, dda, channel);
    }
    void sample(float &left, float &right) {
        if (!clock_resampler) { core.generate(&left, &right, 1); return; }
        remainder += ratio;
        const uint32_t count = static_cast<uint32_t>(std::floor(remainder));
        remainder -= count;
        if (count) {
            double sum_left = 0, sum_right = 0;
            for (uint32_t i = 0; i < count; ++i) {
                float l, r;
                core.generate(&l, &r, 1);
                sum_left += l;
                sum_right += r;
            }
            held_left = sum_left / count;
            held_right = sum_right / count;
        }
        left = held_left;
        right = held_right;
    }
};
}
extern "C" {
void *native_huc6280_create(uint32_t rate) {
    return rate >= 8000 && rate <= 384000 ? new (std::nothrow) NativeHuc6280(rate) : nullptr;
}
size_t native_huc6280_core_size() { return sizeof(NativeHuc6280); }
void native_huc6280_destroy(void *ptr) { delete static_cast<NativeHuc6280 *>(ptr); }
void native_huc6280_reset(void *ptr) { static_cast<NativeHuc6280 *>(ptr)->reset(); }
void native_huc6280_stop(void *ptr) {
    auto &p = *static_cast<NativeHuc6280 *>(ptr);
    for (uint32_t channel = 0; channel < 8; ++channel) p.off(channel);
}
void native_huc6280_write(void *ptr, uint32_t reg, uint8_t value, int32_t channel) {
    static_cast<NativeHuc6280 *>(ptr)->write(reg, value, channel);
}
void native_huc6280_waveform(void *ptr, uint32_t channel, const uint8_t *samples) {
    static_cast<NativeHuc6280 *>(ptr)->waveform(channel, samples);
}
void native_huc6280_key_off(void *ptr, uint32_t channel) { static_cast<NativeHuc6280 *>(ptr)->off(channel); }
void native_huc6280_set_mute_mask(void *ptr, uint32_t mask) {
    auto &core = static_cast<NativeHuc6280 *>(ptr)->core;
    for (uint32_t channel = 0; channel < 6; ++channel) core.mute(channel, (mask & (1U << channel)) != 0);
}
int32_t native_huc6280_set_clock(void *ptr, uint32_t hz) {
    if (hz < 100000 || hz > 100000000) return 0;
    auto &p = *static_cast<NativeHuc6280 *>(ptr);
    p.clock = hz;
    p.clock_resampler = true;
    p.ratio = static_cast<double>(hz) / BASE_CLOCK;
    return 1;
}
void native_huc6280_sample(void *ptr, float *left, float *right) {
    static_cast<NativeHuc6280 *>(ptr)->sample(*left, *right);
}
void native_huc6280_get_state(void *ptr, NativeHuc6280State *out) {
    const auto &p = *static_cast<NativeHuc6280 *>(ptr);
    std::memset(out, 0, sizeof(*out));
    out->selected = p.core.m_select;
    std::memcpy(out->globals, p.globals, sizeof(p.globals));
    std::memcpy(out->registers, p.registers, sizeof(p.registers));
    for (uint32_t ch = 0; ch < 8; ++ch) {
        std::memcpy(out->waveforms[ch], p.core.m_channel[ch].waveform, 32);
        out->indices[ch] = p.core.m_channel[ch].index;
        out->dda[ch] = p.core.m_channel[ch].dda;
    }
    out->clock = p.clock;
}
}
