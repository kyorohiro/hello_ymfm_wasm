// Shared Native YM2413 renderer. Mirrors the shipped OPLL Worklet exactly.
// ymfm synthesis is pinned under native-master-system; this adapter owns no device.
#pragma once
#include "ymfm_opl.h"
#include "ymfm_wasm_interface.h"
#include <algorithm>
#include <array>
#include <vector>
namespace native_opll_detail {
const uint8_t PHYSICAL[5] = {6, 7, 8, 8, 7};
const uint8_t VOLUME_REGISTER[5] = {0x36, 0x37, 0x38, 0x38, 0x37};
const uint8_t VOLUME_SHIFT[5] = {0, 0, 4, 0, 4};
}
struct NativeOpllCore {
    ymfm_wasm_interface intf;
    ymfm::ym2413 opll;
    uint32_t rate, opll_clock = 3579545, opll_mute_mask = 0;
    uint64_t opll_remainder = 0;
    double last_opll = 0;
    std::array<uint8_t, 64> registers{};
    std::vector<uint8_t> power_on;
    uint32_t pending = 0, forced_channels = 0x1ff;
    uint8_t muted_drums = 31;
    bool silent = true;
    explicit NativeOpllCore(uint32_t sr) : opll(intf), rate(sr) {
        opll.reset();
        // Browser reset recreates the core. A preallocated snapshot resets all
        // free-running counters identically without callback allocation/free.
        ymfm::ymfm_saved_state saved(power_on, true); opll.save_restore(saved); update_mute();
    }
    void raw_opll(uint8_t reg, uint8_t value) { opll.write(0, reg); opll.write(1, value); }
    void update_mute() { opll.set_mute_mask(opll_mute_mask | forced_channels); }
    void volume(uint8_t reg) {
        uint8_t value = registers[reg];
        if (registers[0x0e] & 32) for (uint8_t i = 0; i < 5; ++i) if ((muted_drums & (1 << i)) && native_opll_detail::VOLUME_REGISTER[i] == reg)
            value = uint8_t((value & ~(15 << native_opll_detail::VOLUME_SHIFT[i])) | (15 << native_opll_detail::VOLUME_SHIFT[i]));
        raw_opll(reg, value);
    }
    void restore(uint8_t channel) { forced_channels &= ~(1u << channel); update_mute(); volume(0x30 + channel); silent = false; }
    void opll_write(uint8_t reg, uint8_t value) {
        if (reg >= 64) return;
        const uint8_t old = registers[reg]; registers[reg] = value;
        if (reg >= 0x20 && reg <= 0x28) {
            pending &= ~(1u << (reg - 0x20));
            if ((value & 16) && !((registers[0x0e] & 32) && reg >= 0x26)) restore(reg - 0x20);
        }
        if (reg == 0x0e) {
            if ((old ^ value) & 32) for (uint8_t i = 0x36; i <= 0x38; ++i) volume(i);
            for (uint8_t i = 0; i < 5; ++i) if ((old ^ value) & (16 >> i)) pending &= ~(1u << (9 + i));
            if (value & 32) for (uint8_t i = 0; i < 5; ++i) if (value & (16 >> i)) {
                muted_drums &= ~(1 << i); restore(native_opll_detail::PHYSICAL[i]);
            }
        }
        if (reg >= 0x30 && reg <= 0x38) volume(reg); else raw_opll(reg, value);
    }
    void key_off(uint8_t voice) {
        if (voice < 9) {
            const uint8_t channel = voice; pending &= ~(1u << channel);
            registers[0x20 + channel] &= ~16; raw_opll(0x20 + channel, registers[0x20 + channel]);
            forced_channels |= 1u << channel; update_mute();
        } else if (voice < 14) {
            const uint8_t index = voice - 9, bit = 16 >> index, physical = native_opll_detail::PHYSICAL[index];
            pending &= ~(1u << (9 + index)); registers[0x0e] &= ~bit; raw_opll(0x0e, registers[0x0e]);
            muted_drums |= 1 << index; volume(native_opll_detail::VOLUME_REGISTER[index]);
            bool other = false;
            for (uint8_t i = 0; i < 5; ++i) if (native_opll_detail::PHYSICAL[i] == physical && (registers[0x0e] & (16 >> i))) other = true;
            if (!other) { forced_channels |= 1u << physical; update_mute(); }
        }
    }
    void audition(uint8_t voice) {
        if (voice >= 14) return;
        key_off(voice); pending |= 1u << voice;
    }
    void stop_opll() {
        pending = 0; for (uint8_t voice = 0; voice < 9; ++voice) key_off(voice);
        registers[0x0e] &= 224; raw_opll(0x0e, registers[0x0e]); muted_drums = 31;
        for (uint8_t reg = 0x36; reg <= 0x38; ++reg) volume(reg);
        silent = true; last_opll = 0;
    }
    void reset_opll() {
        ymfm::ymfm_saved_state saved(power_on, false); opll.save_restore(saved);
        intf.irq_asserted = false; intf.timer_remaining[0] = intf.timer_remaining[1] = -1;
        registers.fill(0); forced_channels = 0x1ff; muted_drums = 31; update_mute();
        pending = 0; opll_remainder = 0; last_opll = 0; silent = true;
    }
    static float normalize(int32_t value) { return float(std::max(-32768, std::min(32767, value))) / 32768.0f; }
    void sample_opll(float *left, float *right) {
        opll_remainder += opll.sample_rate(opll_clock);
        const uint32_t count = uint32_t(opll_remainder / rate); opll_remainder -= uint64_t(count) * rate;
        if (count) {
            double sum = 0;
            for (uint32_t i = 0; i < count; ++i) {
                ymfm::ym2413::output_data output; opll.generate(&output); intf.advance_sample(opll);
                int32_t mix = 0; for (uint32_t j = 0; j < ymfm::ym2413::OUTPUTS; ++j) mix += output.data[j];
                sum += normalize(mix);
            }
            last_opll = sum / count;
        }
        *left = *right = silent ? 0 : float(last_opll);
        // One real OPLL interval must see key-off before a preview retrigger.
        if (count && pending) {
            const uint32_t starts = pending; pending = 0;
            for (uint8_t i = 0; i < 14; ++i) if (starts & (1u << i)) {
                if (i < 9) opll_write(0x20 + i, registers[0x20 + i] | 16);
                else if (registers[0x0e] & 32) opll_write(0x0e, registers[0x0e] | (16 >> (i - 9)));
            }
        }
    }
};
