// Standalone adapter for the exact pinned Browser MAME-derived OKIM6258 core.
#include "native_genesis_extra_okim6258.h"
#include "okim6258.h"
#include <algorithm>
#include <cmath>

namespace {
constexpr uint32_t MAX_SAMPLE = 0x1000000;
constexpr uint32_t DIVIDERS[4] = {1024, 768, 512, 512};
struct NativeExtraOkim6258 {
    Oki6258 oki;
    const uint8_t *bytes = nullptr;
    uint32_t rate, clock = 8000000, clock_buffer = 8000000, divider = 512;
    uint32_t sample_bytes = 0, position = 0, fed_bytes = 0;
    double phase = 0;
    uint8_t pan = 0;
    bool playing = false, streaming = false, repeat = false;
    explicit NativeExtraOkim6258(uint32_t output_rate) : oki(8000000, 12, output_rate), rate(output_rate) { configure(); }
    bool valid(uint32_t hz, uint32_t div) const {
        // Reset restores divider 512, so every admitted clock must remain
        // streamable at that divider too, including 8 kHz output devices.
        return hz >= 100000 && hz <= 100000000 && double(hz) / div / rate <= 14 &&
            double(hz) / 512 / rate <= 14;
    }
    void configure() {
        for (uint8_t i = 0; i < 4; ++i) oki.write(8 + i, (clock >> (i * 8)) & 255);
        oki.write(12, divider == 1024 ? 0 : divider == 768 ? 1 : 2);
        oki.write(2, pan); clock_buffer = clock;
    }
    void stop() { oki.write(0, 1); playing = streaming = false; }
    void reset() { stop(); oki.reset(); divider = 512; pan = 0; phase = 0; configure(); }
    int write(uint8_t reg, uint8_t value) {
        if (reg > 12) return 0;
        if (reg == 12) { if (!valid(clock, DIVIDERS[value & 3])) return 0; divider = DIVIDERS[value & 3]; }
        if (reg == 2) pan = value & 3;
        if (reg >= 8 && reg <= 11) {
            const uint32_t shift = (reg - 8) * 8;
            const uint32_t candidate = (clock_buffer & ~(uint32_t(255) << shift)) | (uint32_t(value) << shift);
            if (reg == 11) { if (!valid(candidate & 0x3fffffff, divider)) return 0; clock = candidate & 0x3fffffff; }
            clock_buffer = candidate;
        }
        if (reg == 0) { streaming = false; playing = (value & 2) && !(value & 1); }
        oki.write(reg, value); return 1;
    }
    void restart() {
        oki.reset(); configure(); oki.write(0, 2);
        phase = 0; position = fed_bytes = 0; playing = streaming = true;
    }
    void sample(float *left, float *right) {
        if (!streaming) { oki.generate(left, right, 1); return; }
        if (position >= sample_bytes * 2) {
            if (repeat) restart();
            else { stop(); *left = *right = 0; return; }
        }
        phase += double(clock) / divider / rate;
        const uint32_t ticks = uint32_t(std::floor(phase)); phase -= ticks;
        const uint32_t required = std::min(sample_bytes, (position + ticks + 1) / 2);
        while (fed_bytes < required) oki.write(1, bytes[fed_bytes++]);
        oki.generate(left, right, 1); position += ticks;
        if (position >= sample_bytes * 2 && !repeat) stop();
    }
};
NativeExtraOkim6258 *core(void *p) { return static_cast<NativeExtraOkim6258 *>(p); }
}
extern "C" {
void *native_extra_okim6258_create(uint32_t rate) {
    if (rate < 8000 || rate > 384000) return nullptr;
    try { return new NativeExtraOkim6258(rate); } catch (...) { return nullptr; }
}
void native_extra_okim6258_destroy(void *p) { delete core(p); }
void native_extra_okim6258_reset(void *p) { core(p)->reset(); }
void native_extra_okim6258_stop(void *p) { core(p)->stop(); }
int native_extra_okim6258_write(void *p, uint8_t reg, uint8_t value) { return core(p)->write(reg, value); }
int native_extra_okim6258_set_clock(void *p, uint32_t clock) {
    auto *h = core(p); if (!h->valid(clock, h->divider)) return 0;
    h->clock = clock; h->configure(); return 1;
}
int native_extra_okim6258_load_sample(void *p, const uint8_t *bytes, uint32_t size) {
    if (!bytes || !size || size > MAX_SAMPLE) return 0;
    auto *h = core(p); h->stop(); h->bytes = bytes; h->sample_bytes = size; return 1;
}
int native_extra_okim6258_play(void *p, uint8_t repeat) {
    auto *h = core(p); if (!h->sample_bytes || repeat > 1) return 0;
    h->repeat = repeat != 0; h->restart(); return 1;
}
void native_extra_okim6258_set_repeat(void *p, uint8_t repeat) { core(p)->repeat = repeat != 0; }
void native_extra_okim6258_sample(void *p, float *left, float *right) { core(p)->sample(left, right); }
void native_extra_okim6258_get_state(void *p, NativeExtraOkim6258State *s) {
    const auto *h = core(p); s->clock = h->clock; s->clock_buffer = h->clock_buffer; s->divider = h->divider;
    s->sample_bytes = h->sample_bytes; s->position = h->position; s->fed_bytes = h->fed_bytes;
    s->pan = h->pan; s->playing = h->playing; s->streaming = h->streaming; s->repeat = h->repeat;
}
}
