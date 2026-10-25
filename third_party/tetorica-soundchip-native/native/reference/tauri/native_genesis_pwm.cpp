// SPDX-License-Identifier: BSD-3-Clause
// The exact browser/WASM PWM core, directly owned by the native audio callback.
#include "native_genesis_pwm.h"
#include "pwm32x_core.h"
#include <new>
using tetorica::pwm32x::Core;
namespace {
struct NativePwm {
    Core core;
    uint64_t left_tags[3]{}, right_tags[3]{};
    uint64_t left_latch_tag = 0, right_latch_tag = 0;
    explicit NativePwm(uint32_t rate) : core(23011361, rate, 1, true) {}
    void clear_tags() {
        for (uint32_t i = 0; i < 3; ++i) left_tags[i] = right_tags[i] = 0;
        left_latch_tag = right_latch_tag = 0;
    }
    static void push_tag(uint64_t *tags, uint32_t size, uint64_t tag) {
        if (size == 3) { tags[0] = tags[1]; tags[1] = tags[2]; size = 2; }
        tags[size] = tag;
    }
    void write(uint32_t reg, uint32_t value, uint64_t tag) {
        const auto before = core.state();
        if (reg == 2 || reg == 4) push_tag(left_tags, before.left_fifo.size, tag);
        if (reg == 3 || reg == 4) push_tag(right_tags, before.right_fifo.size, tag);
        core.write(reg, value);
        // Active control/cycle writes clear the physical FIFOs. The already
        // latched output remains audible, exactly like the canonical core.
        if (reg <= 1 && core.active())
            for (uint32_t i = 0; i < 3; ++i) left_tags[i] = right_tags[i] = 0;
    }
    void sample(float &left, float &right) {
        const auto before = core.state();
        core.sample(left, right);
        const auto &after = core.state();
        const uint32_t l = before.left_fifo.size - after.left_fifo.size;
        const uint32_t r = before.right_fifo.size - after.right_fifo.size;
        const uint32_t lm = before.control & 3, rm = (before.control >> 2) & 3;
        // Each FIFO pops once per timer tick. A larger consumed count therefore
        // denotes a later latch write; for equal counts the right FIFO runs last.
        if (l && lm == 1 && !(r >= l && rm == 2)) left_latch_tag = left_tags[l - 1];
        if (l && lm == 2 && !(r >= l && rm == 1)) right_latch_tag = left_tags[l - 1];
        if (r && rm == 1 && !(l > r && lm == 2)) right_latch_tag = right_tags[r - 1];
        if (r && rm == 2 && !(l > r && lm == 1)) left_latch_tag = right_tags[r - 1];
        for (uint32_t i = 0; i < after.left_fifo.size; ++i) left_tags[i] = left_tags[i + l];
        for (uint32_t i = 0; i < after.right_fifo.size; ++i) right_tags[i] = right_tags[i + r];
        for (uint32_t i = after.left_fifo.size; i < 3; ++i) left_tags[i] = 0;
        for (uint32_t i = after.right_fifo.size; i < 3; ++i) right_tags[i] = 0;
    }
    void cancel(uint64_t tag) {
        if (!tag) return;
        auto state = core.state();
        auto compact = [tag](tetorica::pwm32x::Fifo &fifo, uint64_t *tags) {
            uint32_t kept = 0;
            for (uint32_t i = 0; i < fifo.size; ++i)
                if (tags[i] != tag) { fifo.values[kept] = fifo.values[i]; tags[kept++] = tags[i]; }
            fifo.size = kept;
            for (uint32_t i = kept; i < 3; ++i) { fifo.values[i] = 0; tags[i] = 0; }
        };
        compact(state.left_fifo, left_tags); compact(state.right_fifo, right_tags);
        if (left_latch_tag == tag) { state.left = 0; state.left_valid = false; left_latch_tag = 0; }
        if (right_latch_tag == tag) { state.right = 0; state.right_valid = false; right_latch_tag = 0; }
        core.load_state(state);
    }
    bool has_tag(uint64_t tag) const {
        if (!tag) return false;
        const auto &state = core.state();
        if ((state.left_valid && left_latch_tag == tag) || (state.right_valid && right_latch_tag == tag)) return true;
        for (uint32_t i = 0; i < state.left_fifo.size; ++i) if (left_tags[i] == tag) return true;
        for (uint32_t i = 0; i < state.right_fifo.size; ++i) if (right_tags[i] == tag) return true;
        return false;
    }
};
}
extern "C" {
void *native_pwm_create(uint32_t rate) {
    if (!rate || rate > 1000000) return nullptr;
    return new (std::nothrow) NativePwm(rate);
}
void native_pwm_destroy(void *ptr) { delete static_cast<NativePwm *>(ptr); }
void native_pwm_reset(void *ptr) { auto *chip = static_cast<NativePwm *>(ptr); chip->core.reset(); chip->clear_tags(); }
void native_pwm_stop(void *ptr) {
    auto *chip = static_cast<NativePwm *>(ptr);
    auto *core = &chip->core;
    auto state = core->state();
    state.left_fifo.size = state.right_fifo.size = 0;
    state.left_valid = state.right_valid = false;
    state.left = state.right = 0;
    core->load_state(state);
    chip->clear_tags();
}
void native_pwm_write(void *ptr, uint32_t reg, uint32_t value) {
    static_cast<NativePwm *>(ptr)->write(reg, value, 0);
}
void native_pwm_write_tagged(void *ptr, uint32_t reg, uint32_t value, uint64_t tag) {
    static_cast<NativePwm *>(ptr)->write(reg, value, tag);
}
void native_pwm_cancel_tag(void *ptr, uint64_t tag) { static_cast<NativePwm *>(ptr)->cancel(tag); }
int native_pwm_has_tag(void *ptr, uint64_t tag) { return static_cast<NativePwm *>(ptr)->has_tag(tag); }
int native_pwm_set_clock(void *ptr, uint32_t hz) {
    if (hz < 100000 || hz > 100000000) return 0;
    static_cast<NativePwm *>(ptr)->core.set_clock(hz);
    return 1;
}
uint32_t native_pwm_core_size() { return sizeof(NativePwm); }
void native_pwm_sample(void *ptr, float *left, float *right) {
    static_cast<NativePwm *>(ptr)->sample(*left, *right);
}
void native_pwm_get_state(void *ptr, NativePwmState *out) {
    const auto *core = &static_cast<NativePwm *>(ptr)->core;
    const auto state = core->state();
    for (uint32_t reg = 0; reg < 5; ++reg) out->registers[reg] = core->read(reg);
    out->clock = static_cast<uint32_t>(core->clock());
    out->cycle = state.cycle;
    out->left = state.left;
    out->right = state.right;
    out->left_valid = state.left_valid;
    out->right_valid = state.right_valid;
    out->left_size = state.left_fifo.size;
    out->right_size = state.right_fifo.size;
    for (uint32_t i = 0; i < 3; ++i) {
        out->left_fifo[i] = state.left_fifo.values[i];
        out->right_fifo[i] = state.right_fifo.values[i];
    }
    out->timer_tick = state.timer_tick;
    out->interrupt_count = state.interrupt_count;
    out->until_tick = state.until_tick;
}
}
