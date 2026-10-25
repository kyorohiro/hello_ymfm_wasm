// Native adapters for the exact Browser ymfm OPM / MAME-derived OKI cores.
#include "native_genesis_x68000.h"
#include "ymfm_opm.h"
#include "ymfm_wasm_interface.h"
#include "okim6258.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <vector>

namespace {
constexpr uint32_t MAX_SAMPLE = 0x1000000;
const uint32_t dividers[4] = {1024, 768, 512, 512};
struct NativeX68000 {
    ymfm_wasm_interface intf;
    ymfm::ym2151 fm;
    Oki6258 oki;
    uint32_t rate, fm_clock = 4000000, oki_clock = 8000000, clock_buffer = 8000000;
    uint32_t divider = 512, fm_mute_mask = 0;
    uint64_t remainder = 0;
    double last_left = 0, last_right = 0, phase = 0;
    uint8_t pan = 0, forced_off = 0, amd = 0, pmd = 0;
    bool silent = false, playing = false, streaming = false, repeat = false;
    std::array<uint8_t, 256> registers{};
    std::array<uint8_t, 8> pending_key_on{};
    std::vector<uint8_t> samples[2];
    uint32_t active = 0, sample_bytes = 0, position = 0, fed_bytes = 0;
    uint32_t pending_size = 0, pending_bytes = 0;
    NativeX68000(uint32_t output_rate) : fm(intf), oki(8000000, 12, output_rate), rate(output_rate),
        samples{std::vector<uint8_t>(MAX_SAMPLE, 0), std::vector<uint8_t>(MAX_SAMPLE, 0)} {
        fm.reset(); configure();
    }
    void configure() {
        for (uint32_t i = 0; i < 4; ++i) oki.write(8 + i, (oki_clock >> (8 * i)) & 255);
        oki.write(12, divider == 1024 ? 0 : divider == 768 ? 1 : 2);
        oki.write(2, pan); clock_buffer = oki_clock;
    }
    bool valid_oki(uint32_t clock, uint32_t div) const {
        return clock >= 100000 && clock <= 100000000 && double(clock) / div / rate <= 14;
    }
    void fm_write(uint8_t reg, uint8_t value) {
        registers[reg] = value;
        if (reg == 8) pending_key_on[value & 7] = 0;
        if (reg == 0x19) { if (value & 128) pmd = value & 127; else amd = value & 127; }
        if (reg == 8 && (value & 0x78)) {
            const uint8_t channel = value & 7;
            if (forced_off & (1 << channel)) {
                forced_off &= ~(1 << channel);
                for (uint8_t op = 0; op < 4; ++op) raw_fm(0x60 + op * 8 + channel, registers[0x60 + op * 8 + channel]);
            }
            silent = false;
        }
        raw_fm(reg, reg >= 0x60 && reg < 0x80 && (forced_off & (1 << (reg & 7))) ? 127 : value);
    }
    void raw_fm(uint8_t reg, uint8_t value) { fm.write(0, reg); fm.write(1, value); }
    void key_off(uint8_t voice) {
        if (voice < 8) {
            pending_key_on[voice] = 0;
            raw_fm(8, voice); forced_off |= 1 << voice;
            for (uint8_t op = 0; op < 4; ++op) raw_fm(0x60 + op * 8 + voice, 127);
        } else if (voice == 8) stop_oki();
    }
    void stop_oki() { oki.write(0, 1); playing = streaming = false; }
    void stop(uint8_t chip) {
        if (chip == 0 || chip == 2) { for (uint8_t ch = 0; ch < 8; ++ch) key_off(ch); silent = true; }
        if (chip == 1 || chip == 2) stop_oki();
    }
    void reset(uint8_t chip) {
        if (chip == 0 || chip == 2) {
            fm.reset(); fm.set_mute_mask(fm_mute_mask); registers.fill(0); forced_off = amd = pmd = 0;
            pending_key_on.fill(0);
            remainder = 0; last_left = last_right = 0; silent = true;
        }
        if (chip == 1 || chip == 2) { stop_oki(); oki.reset(); divider = 512; pan = 0; phase = 0; configure(); }
    }
    void write_oki(uint8_t reg, uint8_t value) {
        if (reg > 12) return;
        if (reg == 12) { if (!valid_oki(oki_clock, dividers[value & 3])) return; divider = dividers[value & 3]; }
        if (reg == 2) pan = value & 3;
        if (reg >= 8 && reg <= 11) {
            const uint32_t shift = (reg - 8) * 8;
            const uint32_t candidate = (clock_buffer & ~(uint32_t(255) << shift)) | (uint32_t(value) << shift);
            if (reg == 11) { if (!valid_oki(candidate & 0x3fffffff, divider)) return; oki_clock = candidate & 0x3fffffff; }
            clock_buffer = candidate;
        }
        if (reg == 0) { streaming = false; playing = (value & 2) && !(value & 1); }
        oki.write(reg, value);
    }
    void restart() {
        oki.reset(); configure(); oki.write(0, 2); phase = 0; position = fed_bytes = 0; playing = streaming = true;
    }
    static float normalize(int32_t value) { return float(std::max(-32768, std::min(32767, value))) / 32768.0f; }
    void sample(float *fl, float *fr, float *ol, float *orr) {
        remainder += fm.sample_rate(fm_clock);
        const uint32_t count = uint32_t(remainder / rate); remainder -= uint64_t(count) * rate;
        if (count) {
            double l = 0, r = 0;
            for (uint32_t i = 0; i < count; ++i) {
                ymfm::ym2151::output_data output; fm.generate(&output); intf.advance_sample(fm);
                l += normalize(output.data[0]); r += normalize(output.data[1]);
            }
            last_left = l / count; last_right = r / count;
        }
        *fl = silent ? 0 : float(last_left); *fr = silent ? 0 : float(last_right);
        if (count) for (uint8_t ch = 0; ch < 8; ++ch) if (pending_key_on[ch]) {
            const uint8_t mask = pending_key_on[ch]; fm_write(8, ch | (mask << 3));
        }
        if (streaming) {
            if (position >= sample_bytes * 2) { if (repeat) restart(); else { stop_oki(); *ol = *orr = 0; return; } }
            phase += double(oki_clock) / divider / rate;
            const uint32_t ticks = uint32_t(std::floor(phase)); phase -= ticks;
            const uint32_t required = std::min(sample_bytes, (position + ticks + 1) / 2);
            while (fed_bytes < required) oki.write(1, samples[active][fed_bytes++]);
            oki.generate(ol, orr, 1); position += ticks;
            if (position >= sample_bytes * 2 && !repeat) stop_oki();
        } else oki.generate(ol, orr, 1);
    }
};
NativeX68000 *core(void *ptr) { return static_cast<NativeX68000 *>(ptr); }
}
extern "C" {
void *native_x68000_create(uint32_t rate) {
    if (rate < 8000 || rate > 384000) return nullptr;
    try { return new NativeX68000(rate); } catch (...) { return nullptr; }
}
void native_x68000_destroy(void *p) { delete core(p); }
void native_x68000_reset(void *p, uint8_t chip) { core(p)->reset(chip); }
void native_x68000_stop(void *p, uint8_t chip) { core(p)->stop(chip); }
void native_x68000_key_off(void *p, uint8_t voice) { core(p)->key_off(voice); }
void native_x68000_audition_key_on(void *p, uint8_t channel, uint8_t mask) {
    if (channel >= 8 || mask > 15) return;
    auto *h = core(p); h->key_off(channel); h->pending_key_on[channel] = mask;
}
void native_x68000_write(void *p, uint8_t chip, uint8_t reg, uint8_t value) { if (chip == 0) core(p)->fm_write(reg, value); else if (chip == 1) core(p)->write_oki(reg, value); }
void native_x68000_sample(void *p, float *fl, float *fr, float *ol, float *orr) { core(p)->sample(fl, fr, ol, orr); }
int native_x68000_set_clock(void *p, uint8_t chip, uint32_t clock) {
    if (clock < 100000 || clock > 100000000 || chip > 1) return 0;
    auto *h = core(p); if (chip == 0) h->fm_clock = clock;
    else { if (!h->valid_oki(clock, h->divider)) return 0; h->oki_clock = clock; h->configure(); } return 1;
}
void native_x68000_set_fm_mute_mask(void *p, uint32_t mask) { auto *h = core(p); h->fm_mute_mask = mask & 255; h->fm.set_mute_mask(mask); h->last_left = h->last_right = 0; }
int native_x68000_sample_begin(void *p, uint32_t size) { auto *h = core(p); if (!size || size > MAX_SAMPLE) return 0; h->pending_size = size; h->pending_bytes = 0; return 1; }
int native_x68000_sample_chunk(void *p, const uint8_t *data, uint32_t offset, uint32_t size) {
    auto *h = core(p); if (!h->pending_size || !data || size > 65536 || offset != h->pending_bytes || size > h->pending_size - offset) return 0;
    std::memcpy(h->samples[h->active ^ 1].data() + offset, data, size); h->pending_bytes += size; return 1;
}
int native_x68000_sample_commit(void *p) { auto *h = core(p); if (!h->pending_size || h->pending_bytes != h->pending_size) return 0; h->stop_oki(); h->active ^= 1; h->sample_bytes = h->pending_size; h->pending_size = h->pending_bytes = 0; return 1; }
void native_x68000_sample_abort(void *p) { core(p)->pending_size = core(p)->pending_bytes = 0; }
int native_x68000_oki_play(void *p, uint8_t repeat) { auto *h = core(p); if (!h->sample_bytes || repeat > 1) return 0; h->repeat = repeat != 0; h->restart(); return 1; }
void native_x68000_oki_set_repeat(void *p, uint8_t repeat) { core(p)->repeat = repeat != 0; }
uint8_t native_x68000_read(void *p, uint8_t offset) { return core(p)->fm.read(offset); }
uint8_t native_x68000_read_status(void *p) { return core(p)->fm.read_status(); }
uint8_t native_x68000_get_irq(void *p) { return core(p)->intf.irq_asserted ? 1 : 0; }
void native_x68000_get_state(void *p, NativeX68000State *s) {
    auto *h = core(p); std::memcpy(s->registers, h->registers.data(), 256);
    s->fm_clock = h->fm_clock; s->oki_clock = h->oki_clock; s->sample_bytes = h->sample_bytes;
    s->position = h->position; s->fed_bytes = h->fed_bytes; s->divider = h->divider; s->fm_mute_mask = h->fm_mute_mask;
    s->status = h->fm.read_status(); s->irq = h->intf.irq_asserted ? 1 : 0; s->pan = h->pan;
    s->playing = h->playing; s->streaming = h->streaming; s->repeat = h->repeat; s->amd = h->amd; s->pmd = h->pmd;
}
}
