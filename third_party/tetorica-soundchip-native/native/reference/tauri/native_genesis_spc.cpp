// SPDX-License-Identifier: LGPL-2.1-or-later
// Full SPC700 + accurate S-DSP, matching the shipped SpcProcessor. No IPL ROM,
// metadata-based duration/fade, tempo conversion, or output device is added.
#include "native_genesis_spc.h"
#include "SNES_SPC.h"
#include <algorithm>
#include <array>
#include <cstring>
#include <new>
namespace {
constexpr uint32_t native_rate = 32000, source_frames = 128, discard_frames = 1024;
constexpr uint32_t observer_limit = 8192, max_file_size = 16 * 1024 * 1024;
struct Core {
    SNES_SPC cpu;
    std::array<short, discard_frames * 2> pcm{};
    std::array<float, source_frames> left{}, right{};
    std::array<NativeSpcEvent, observer_limit> events{};
    uint64_t native_frames = 0, base_frames = 0, output_frames = 0;
    uint32_t rate, phase = 0, offset = source_frames, mute_mask = 0;
    uint32_t event_count = 0, event_capacity = 2048, overflow = 0;
    bool loaded = false, playing = false, primed = false, observing = false;
    float previous[2]{}, next[2]{};
    const char *error = nullptr;
    explicit Core(uint32_t r) : rate(r) { error = cpu.init(); }
    void reset_resampler(uint64_t base = 0) {
        base_frames = base; output_frames = 0; phase = 0; offset = source_frames; primed = false;
    }
    static void observe(void *user, unsigned long long clock, int, int reg, int value) {
        auto &c = *static_cast<Core *>(user);
        if (c.event_count < c.event_capacity) c.events[c.event_count++] = {clock, uint32_t(reg), uint32_t(value)};
        else if (c.overflow != UINT32_MAX) ++c.overflow;
    }
    void observation(bool enabled, uint32_t capacity) {
        observing = enabled; event_capacity = capacity; event_count = overflow = 0;
        cpu.set_tetorica_dsp_observer(enabled ? observe : nullptr, enabled ? this : nullptr, native_frames * 32);
    }
    bool render(uint32_t count) {
        std::fill(pcm.begin(), pcm.begin() + count * 2, 0);
        if (const char *failure = cpu.play(int(count * 2), pcm.data())) { error = failure; playing = false; return false; }
        native_frames += count; return true;
    }
    bool pull(float *out) {
        if (offset == source_frames) {
            if (!render(source_frames)) {out[0] = out[1] = 0; return false;}
            for (uint32_t i = 0; i < source_frames; ++i) {
                left[i] = pcm[i * 2] * (1.0f / 32768.0f); right[i] = pcm[i * 2 + 1] * (1.0f / 32768.0f);
            }
            offset = 0;
        }
        out[0] = left[offset]; out[1] = right[offset++]; return true;
    }
    void sample(float *l, float *r) {
        *l = *r = 0;
        if (!loaded || !playing || error) return;
        if (!primed) {if (!pull(previous) || !pull(next)) return; primed = true;}
        const double fraction = double(phase) / rate;
        *l = float(double(previous[0]) + (double(next[0]) - previous[0]) * fraction);
        *r = float(double(previous[1]) + (double(next[1]) - previous[1]) * fraction);
        phase += native_rate;
        while (phase >= rate) {
            phase -= rate; previous[0] = next[0]; previous[1] = next[1];
            if (!pull(next)) {*l = *r = 0; return;}
        }
        ++output_frames;
    }
};
static_assert(sizeof(short) == 2, "SPC requires 16-bit samples");
static_assert(sizeof(NativeSpcEvent) == 16, "SPC observer ABI changed");
}
extern "C" {
void *native_spc_create(uint32_t rate) {
    if (rate < 8000 || rate > 384000) return nullptr;
    auto *p = new (std::nothrow) Core(rate); if (p && p->error) {delete p; return nullptr;} return p;
}
void native_spc_destroy(void *p) {delete static_cast<Core *>(p);}
uint32_t native_spc_core_size(void) {return sizeof(Core);}
const char *native_spc_error(const void *p) {return p ? static_cast<const Core *>(p)->error : "Invalid Native SPC handle";}
int native_spc_load_control(void *p, const uint8_t *data, uint32_t size) {
    if (!p) return 0; auto &c = *static_cast<Core *>(p);
    if (!data || size < SNES_SPC::spc_min_file_size || size > max_file_size) {c.error = "Invalid SPC file size"; return 0;}
    if (std::memcmp(data, "SNES-SPC700 Sound File Data ", 27) || data[0x21] != 0x1a || data[0x22] != 0x1a || (data[0x23] != 0x1a && data[0x23] != 0x1b)) {c.error = "Invalid SPC header"; return 0;}
    c.cpu.init();
    if (const char *failure = c.cpu.load_spc(data, size)) {c.error = failure; return 0;}
    c.cpu.set_output_mute_mask(c.mute_mask); c.loaded = true; c.playing = false; c.native_frames = 0;
    c.observation(false, c.event_capacity); c.reset_resampler(); c.error = nullptr; return 1;
}
int native_spc_seek_control(void *p, uint32_t frames) {
    if (!p) return 0; auto &c = *static_cast<Core *>(p);
    if (!c.loaded || c.playing || c.observing || frames > 16000) {c.error = "Invalid Native SPC control seek block"; return 0;}
    uint32_t remaining = frames;
    while (remaining) {const uint32_t count = std::min(remaining, discard_frames); if (!c.render(count)) return 0; remaining -= count;}
    c.reset_resampler(c.base_frames + frames); return 1;
}
int native_spc_set_playing(void *p, uint32_t playing) {
    if (!p) return 0; auto &c = *static_cast<Core *>(p);
    if (playing && !c.loaded) {c.error = "Load an SPC file before playback"; return 0;}
    if (c.error) return 0; c.playing = playing != 0; return 1;
}
int native_spc_set_mute_mask(void *p, uint32_t mask) {
    if (!p || mask > 255) return 0; auto &c = *static_cast<Core *>(p); c.mute_mask = mask; c.cpu.set_output_mute_mask(mask); return 1;
}
void native_spc_sample(void *p, float *l, float *r) {static_cast<Core *>(p)->sample(l, r);}
void native_spc_get_state(const void *p, NativeSpcState *out) {
    const auto &c = *static_cast<const Core *>(p);
    out->native_frames = c.native_frames; out->base_native_frames = c.base_frames; out->output_frames = c.output_frames;
    out->playback_native_frames = double(c.base_frames) + double(c.output_frames) * native_rate / c.rate;
    out->sample_rate = c.rate; out->loaded = c.loaded; out->playing = c.playing; out->mute_mask = c.mute_mask; out->failed = c.error != nullptr;
}
int native_spc_snapshot(void *p, uint8_t *out, uint32_t size) {
    if (!p || !out || size < SNES_SPC::spc_file_size) return 0;
    auto &c = *static_cast<Core *>(p); if (!c.loaded) return 0; c.cpu.save_spc(out); return 1;
}
void native_spc_read_dsp_registers(const void *p, uint8_t *out) {static_cast<const Core *>(p)->cpu.copy_tetorica_dsp_registers(out);}
int native_spc_observe(void *p, uint32_t enabled, uint32_t capacity) {
    if (!p || capacity < 16 || capacity > observer_limit) return 0;
    auto &c = *static_cast<Core *>(p); c.observation(enabled != 0, capacity); return 1;
}
const NativeSpcEvent *native_spc_event_data(const void *p) {return static_cast<const Core *>(p)->events.data();}
uint32_t native_spc_event_count(const void *p) {return static_cast<const Core *>(p)->event_count;}
void native_spc_events_clear(void *p) {static_cast<Core *>(p)->event_count = 0;}
uint32_t native_spc_overflow_take(void *p) {auto &c = *static_cast<Core *>(p); const uint32_t result = c.overflow; c.overflow = 0; return result;}
}
