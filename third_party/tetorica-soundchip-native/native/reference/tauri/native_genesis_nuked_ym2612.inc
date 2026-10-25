// Copyright 2026 Tetorica contributors. LGPL-2.1-or-later.
// See ../native-nuked/LICENSE. Provided without warranty.
// Independent additional Nuked YM2612. This adapter owns exactly one raw OPN2
// handle; no Genesis PSG, calibration frame, source gain or DC filter exists.
// Included after the namespaced, otherwise unchanged Browser C ABI wrapper.
#include "native_genesis_ym2612.h"
#include <array>
#include <cstring>
#include <new>
namespace {
struct NativeNukedYm2612 {
    ym2612_handle *chip;
    const uint32_t rate;
    uint32_t clock = 7670454, channel_mute_mask = 0, forced_mask = 0, pending = 0;
    uint64_t remainder = 0;
    double last_left = 0, last_right = 0;
    bool stopped = false;
    std::array<uint8_t, 512> registers{};
    std::array<uint8_t, 6> keys{}, pending_keys{};
    std::array<uint8_t, 2> frequency_latch{};
    explicit NativeNukedYm2612(uint32_t sr) : chip(static_cast<ym2612_handle *>(tetorica_nuked_create())), rate(sr) {
        if (!chip) throw std::bad_alloc();
    }
    ~NativeNukedYm2612() { tetorica_nuked_destroy(chip); }
    static uint8_t code(uint8_t ch) { return ch < 3 ? ch : ch + 1; }
    void raw(uint8_t port, uint8_t reg, uint8_t value) {
        tetorica_nuked_write(chip, port * 2, reg);
        tetorica_nuked_write(chip, port * 2 + 1, value);
    }
    void pan(uint8_t ch) {
        const uint8_t port = ch / 3, reg = 0xb4 + ch % 3;
        raw(port, reg, registers[port * 256 + reg] & ((forced_mask | channel_mute_mask) & (1u << ch) ? 63 : 255));
    }
    void restore(uint8_t ch) {
        if (!(forced_mask & (1u << ch))) return;
        forced_mask &= ~(1u << ch);
        const uint8_t port = ch / 3, offset = ch % 3;
        for (uint8_t op = 0; op < 4; ++op) {
            const uint8_t reg = 0x40 + offset + op * 4;
            raw(port, reg, registers[port * 256 + reg]);
        }
        pan(ch);
    }
    void write(uint8_t port, uint8_t reg, uint8_t value) {
        if (port > 1) return;
        if ((reg & 0xf0) == 0xa0) {
            if ((reg & 3) != 3) {
                auto &latch = frequency_latch[(reg >> 3) & 1];
                if (reg & 4) latch = value & 63;
                else { registers[port * 256 + reg] = value; registers[port * 256 + (reg | 4)] = latch; }
            }
        } else registers[port * 256 + reg] = value;
        if (!port && reg == 0x28 && (value & 3) < 3) {
            const uint8_t ch = (value & 3) + (value & 4 ? 3 : 0);
            pending &= ~(1u << ch); keys[ch] = value >> 4;
            if (value & 0xf0) { restore(ch); stopped = false; }
        }
        if (!port && reg == 0x27 && (value & 0x81) == 0x81) { restore(2); stopped = false; }
        if (!port && ((reg == 0x2b && (value & 0x80)) || (reg == 0x2a && (registers[0x2b] & 0x80)))) {
            restore(5); stopped = false;
        }
        const uint8_t offset = reg & 3, ch = port * 3 + offset;
        if (reg >= 0x40 && reg <= 0x4e && offset < 3 && (forced_mask & (1u << ch))) value |= 127;
        if (reg >= 0xb4 && reg <= 0xb6 && ((forced_mask | channel_mute_mask) & (1u << ch))) value &= 63;
        raw(port, reg, value);
    }
    void off(uint8_t ch) {
        if (ch >= 6) return;
        pending &= ~(1u << ch); keys[ch] = 0; registers[0x28] = code(ch); raw(0, 0x28, code(ch));
        forced_mask |= 1u << ch;
        const uint8_t port = ch / 3, offset = ch % 3;
        for (uint8_t op = 0; op < 4; ++op) {
            const uint8_t reg = 0x40 + offset + op * 4;
            raw(port, reg, registers[port * 256 + reg] | 127);
        }
        pan(ch);
        if (ch == 2) write(0, 0x27, registers[0x27] & ~0x81);
        if (ch == 5) write(0, 0x2b, registers[0x2b] & 0x7f);
        last_left = last_right = 0;
    }
    void audition(uint8_t ch, uint8_t mask) {
        if (ch >= 6 || mask >= 16) return;
        off(ch); if (mask) { pending_keys[ch] = mask; pending |= 1u << ch; }
    }
    void off_fm(uint8_t ch) {
        if (ch == 2 && (registers[0x27] & 0x81) == 0x81) {
            pending &= ~4u; keys[2] = 0; registers[0x28] = 2; raw(0, 0x28, 2);
        } else off(ch);
    }
    void cancel_csm() {
        write(0, 0x27, registers[0x27] & ~0x81);
        // Nuked keeps the CSM gate in the envelope pipeline for several slots.
        // Remove that source only, preserving a separately owned normal CH3 key.
        chip->chip.mode_kon_csm = 0;
        for (uint8_t slot = 2; slot < 24; slot += 6) {
            chip->chip.eg_kon_csm[slot] = 0;
            chip->chip.eg_kon_latch[slot] = chip->chip.mode_kon[slot];
        }
        if (!keys[2] && !(pending & 4)) off(2);
    }
    void stop() {
        pending = 0;
        for (uint8_t ch = 0; ch < 6; ++ch) off(ch);
        write(0, 0x27, registers[0x27] & 0xc0);
        write(0, 0x2b, registers[0x2b] & 0x7f);
        stopped = true; last_left = last_right = 0;
    }
    void reset() {
        tetorica_nuked_reset(chip); registers.fill(0); keys.fill(0); pending_keys.fill(0); frequency_latch.fill(0);
        remainder = 0; last_left = last_right = 0; forced_mask = pending = 0; stopped = false;
    }
    void mute(uint32_t mask) {
        channel_mute_mask = mask & 63;
        for (uint8_t ch = 0; ch < 6; ++ch) pan(ch);
        last_left = last_right = 0;
    }
    void sample(float *left, float *right) {
        remainder += tetorica_nuked_sample_rate(chip, clock);
        const uint32_t count = uint32_t(remainder / rate); remainder -= uint64_t(count) * rate;
        if (count) {
            double l = 0, r = 0;
            for (uint32_t i = 0; i < count; ++i) {
                float a, b; tetorica_nuked_generate(chip, &a, &b, 1); l += a; r += b;
            }
            last_left = l / count; last_right = r / count;
        }
        *left = stopped ? 0 : float(last_left); *right = stopped ? 0 : float(last_right);
        if (count && pending) {
            const uint32_t starts = pending; pending = 0;
            for (uint8_t ch = 0; ch < 6; ++ch) if (starts & (1u << ch)) write(0, 0x28, uint8_t((pending_keys[ch] << 4) | code(ch)));
        }
    }
};
NativeNukedYm2612 *nuked_core(void *p) { return static_cast<NativeNukedYm2612 *>(p); }
}
extern "C" {
void *native_nuked_ym2612_create(uint32_t rate) { if (rate < 8000 || rate > 384000) return nullptr; try { return new NativeNukedYm2612(rate); } catch (...) { return nullptr; } }
void native_nuked_ym2612_destroy(void *p) { delete nuked_core(p); }
void native_nuked_ym2612_reset(void *p) { nuked_core(p)->reset(); }
void native_nuked_ym2612_stop(void *p) { nuked_core(p)->stop(); }
void native_nuked_ym2612_write(void *p, uint8_t port, uint8_t reg, uint8_t value) { nuked_core(p)->write(port, reg, value); }
void native_nuked_ym2612_key_off(void *p, uint8_t ch) { nuked_core(p)->off(ch); }
void native_nuked_ym2612_key_off_fm(void *p, uint8_t ch) { nuked_core(p)->off_fm(ch); }
void native_nuked_ym2612_cancel_csm(void *p) { nuked_core(p)->cancel_csm(); }
void native_nuked_ym2612_audition_fm_key_on(void *p, uint8_t ch, uint8_t mask) { nuked_core(p)->audition(ch, mask); }
void native_nuked_ym2612_sample(void *p, float *left, float *right) { nuked_core(p)->sample(left, right); }
int native_nuked_ym2612_set_clock(void *p, uint32_t clock) { if (clock < 100000 || clock > 100000000) return 0; nuked_core(p)->clock = clock; return 1; }
void native_nuked_ym2612_set_mute_mask(void *p, uint32_t mask) { nuked_core(p)->mute(mask); }
uint8_t native_nuked_ym2612_read(void *p, uint8_t offset) { return tetorica_nuked_read(nuked_core(p)->chip, offset); }
uint8_t native_nuked_ym2612_read_status(void *p) { return tetorica_nuked_read_status(nuked_core(p)->chip); }
uint8_t native_nuked_ym2612_get_irq(void *p) { return tetorica_nuked_get_irq(nuked_core(p)->chip); }
void native_nuked_ym2612_get_state(void *p, NativeYm2612State *s) {
    auto *h = nuked_core(p); std::memcpy(s->registers, h->registers.data(), 512); std::memcpy(s->keys, h->keys.data(), 6);
    s->clock = h->clock; s->channel_mute_mask = h->channel_mute_mask; s->status = tetorica_nuked_read_status(h->chip); s->irq = tetorica_nuked_get_irq(h->chip);
}
}
