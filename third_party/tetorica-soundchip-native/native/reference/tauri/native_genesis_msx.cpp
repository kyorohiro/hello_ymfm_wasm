// Exact Browser/WASM AY-3-8910 and the shared Native YM2413 renderer.
#include "native_genesis_msx.h"
#include "native_genesis_opll.h"
#include "ay8910.h"
#include <array>
#include <cmath>
#include <cstring>

namespace {
constexpr uint32_t AY_CLOCK = 1789773;
struct NativeMsx : NativeOpllCore {
    AY8910 ay;
    uint32_t ay_clock = AY_CLOCK, ay_mute_mask = 0, silent_channels = 7;
    double ay_remainder = 0, ay_left = 0, ay_right = 0;
    std::array<uint8_t, 16> ay_registers{};
    std::array<uint8_t, 3> levels{{9, 9, 9}};
    explicit NativeMsx(uint32_t sr) : NativeOpllCore(sr), ay(sr, AY_CLOCK) { update_ay_mute(); }
    void update_ay_mute() { ay.set_mute_mask(ay_mute_mask | silent_channels); }
    void ay_write(uint8_t reg, uint8_t value, bool author = true) {
        if (reg >= 16) return;
        ay.write(reg, value); ay_registers[reg] = value;
        if (reg >= 8 && reg <= 10) {
            const uint8_t ch = reg - 8, level = value & 31;
            if (level) { silent_channels &= ~(1u << ch); if (author) levels[ch] = level; }
            else silent_channels |= 1u << ch;
            update_ay_mute();
        }
    }
    void key_off(uint8_t voice) {
        if (voice < 3) { ay_write(8 + voice, 0, false); return; }
        NativeOpllCore::key_off(voice - 3);
    }
    void audition(uint8_t voice) {
        if (voice < 3) { ay_write(8 + voice, levels[voice], false); return; }
        NativeOpllCore::audition(voice - 3);
    }
    void stop(uint8_t chip) {
        if (chip == 0 || chip == 2) {
            for (uint8_t ch = 0; ch < 3; ++ch) key_off(ch);
            // A low edited clock may hold an earlier source sample. Stop must
            // silence that held PCM without resetting tone/noise/envelope phase.
            ay_left = ay_right = 0;
        }
        if (chip == 1 || chip == 2) stop_opll();
    }
    void reset(uint8_t chip) {
        if (chip == 0 || chip == 2) {
            ay.reset(); ay_registers.fill(0); levels.fill(9); silent_channels = 7; update_ay_mute();
            ay_remainder = ay_left = ay_right = 0;
        }
        if (chip == 1 || chip == 2) reset_opll();
    }
    void sample(float *al, float *ar, float *fl, float *fr) {
        // AY remains at its original creation clock. Browser clock edits use
        // ChipClockResampler around that same core, preserving all chip phases.
        ay_remainder += double(ay_clock) / AY_CLOCK;
        const uint32_t count = uint32_t(std::floor(ay_remainder)); ay_remainder -= count;
        if (count) {
            double left = 0, right = 0; float a, b;
            for (uint32_t i = 0; i < count; ++i) { ay.generate(&a, &b, 1); left += a; right += b; }
            ay_left = left / count; ay_right = right / count;
        }
        *al = float(ay_left); *ar = float(ay_right); sample_opll(fl, fr);
    }
};
NativeMsx *core(void *p) { return static_cast<NativeMsx *>(p); }
}
extern "C" {
void *native_msx_create(uint32_t rate) {
    if (rate < 8000 || rate > 384000) return nullptr;
    try { return new NativeMsx(rate); } catch (...) { return nullptr; }
}
void native_msx_destroy(void *p) { delete core(p); }
void native_msx_reset(void *p, uint8_t chip) { core(p)->reset(chip); }
void native_msx_stop(void *p, uint8_t chip) { core(p)->stop(chip); }
void native_msx_key_off(void *p, uint8_t voice) { core(p)->key_off(voice); }
void native_msx_audition_key_on(void *p, uint8_t voice) { core(p)->audition(voice); }
void native_msx_set_retained_level(void *p, uint8_t ch, uint8_t level) { if (ch < 3 && level < 32) core(p)->levels[ch] = level; }
void native_msx_write(void *p, uint8_t chip, uint8_t reg, uint8_t value) {
    if (chip == 0) core(p)->ay_write(reg, value); else if (chip == 1) core(p)->opll_write(reg, value);
}
void native_msx_sample(void *p, float *al, float *ar, float *fl, float *fr) { core(p)->sample(al, ar, fl, fr); }
int native_msx_set_clock(void *p, uint8_t chip, uint32_t clock) {
    if (clock < 100000 || clock > 100000000 || chip > 1) return 0;
    if (chip == 0) core(p)->ay_clock = clock; else core(p)->opll_clock = clock; return 1;
}
void native_msx_set_mute_mask(void *p, uint8_t chip, uint32_t mask) {
    auto *h = core(p);
    if (chip == 0) { h->ay_mute_mask = mask & 7; h->update_ay_mute(); h->ay_left = h->ay_right = 0; }
    else if (chip == 1) { h->opll_mute_mask = mask & 0x1ff; h->update_mute(); h->last_opll = 0; }
}
uint8_t native_msx_read(void *p, uint8_t chip, uint8_t reg) { return chip == 0 ? core(p)->ay.read(reg) : core(p)->opll.read(reg); }
uint8_t native_msx_read_status(void *p) { return core(p)->opll.read_status(); }
uint8_t native_msx_get_irq(void *p) { return core(p)->intf.irq_asserted ? 1 : 0; }
void native_msx_get_state(void *p, NativeMsxState *s) {
    const auto *h = core(p); std::memcpy(s->registers, h->registers.data(), 64); std::memcpy(s->ay_registers, h->ay_registers.data(), 16);
    std::memcpy(s->levels, h->levels.data(), 3);
    s->ay_clock = h->ay_clock; s->opll_clock = h->opll_clock; s->ay_mute_mask = h->ay_mute_mask; s->opll_mute_mask = h->opll_mute_mask;
    s->status = core(p)->opll.read_status(); s->irq = h->intf.irq_asserted ? 1 : 0;
}
}
