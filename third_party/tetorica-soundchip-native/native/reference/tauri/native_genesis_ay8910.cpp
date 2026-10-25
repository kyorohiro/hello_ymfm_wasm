// Independent additional AY-3-8910, exact pinned MAME-adaptation tick model.
#include "native_genesis_ay8910.h"
#include "ay8910.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
namespace {
constexpr uint32_t BASE_CLOCK = 1789773;
struct NativeAy8910 {
    AY8910 ay;
    const uint32_t rate;
    uint32_t clock = BASE_CLOCK, muted = 7;
    uint64_t tick_remaining = 0;
    double remainder = 0, last_output = 0;
    std::array<float, 3> tick_values{};
    std::array<double, 3> held{};
    std::array<uint8_t, 16> registers{};
    std::array<uint8_t, 3> levels{{9, 9, 9}};
    explicit NativeAy8910(uint32_t output_rate) : ay(output_rate, BASE_CLOCK), rate(output_rate) {}
    double remix() const { double value = 0; for (uint8_t ch = 0; ch < 3; ++ch) if (!(muted & (1u << ch))) value += held[ch]; return value; }
    void write(uint8_t reg, uint8_t value) {
        if (reg >= 16) return;
        ay.write(reg, value); registers[reg] = value;
        if (reg >= 8 && reg <= 10) {
            const uint8_t ch = reg - 8, level = value & 31;
            if (level) { muted &= ~(1u << ch); levels[ch] = level; }
            else muted |= 1u << ch;
        }
    }
    void off(uint8_t ch) {
        if (ch >= 3) return;
        write(8 + ch, 0);
        // Only a forced release updates a held frame immediately. Ordinary
        // register writes preserve the deployed Worklet's resampler history.
        held[ch] = 0; last_output = remix();
    }
    void audition(uint8_t ch) { if (ch < 3) write(8 + ch, levels[ch]); }
    void stop() { for (uint8_t ch = 0; ch < 3; ++ch) off(ch); }
    void all_off() { for (uint8_t ch = 0; ch < 3; ++ch) write(8 + ch, 0); }
    void reset() {
        ay.reset(); registers.fill(0); levels.fill(9); muted = 7;
        tick_remaining = 0; tick_values.fill(0); held.fill(0); remainder = last_output = 0;
    }
    float source(std::array<double, 3> &channels) {
        uint64_t remaining = BASE_CLOCK;
        double sum = 0; channels.fill(0);
        while (remaining) {
            if (!tick_remaining) { tick_values = ay.tick(); tick_remaining = uint64_t(rate) * 8; }
            const uint64_t duration = std::min(remaining, tick_remaining);
            for (uint8_t ch = 0; ch < 3; ++ch) if (!(muted & (1u << ch))) {
                const double value = tick_values[ch] * double(duration); sum += value; channels[ch] += value;
            }
            remaining -= duration; tick_remaining -= duration;
        }
        for (auto &value : channels) value /= double(BASE_CLOCK) * 3;
        return float(sum / (double(BASE_CLOCK) * 3));
    }
    void sample(float *left, float *right) {
        remainder += double(clock) / BASE_CLOCK;
        const uint32_t count = uint32_t(std::floor(remainder)); remainder -= count;
        if (count) {
            double sum = 0; std::array<double, 3> channels{}, accum{};
            for (uint32_t i = 0; i < count; ++i) {
                sum += source(channels);
                for (uint8_t ch = 0; ch < 3; ++ch) accum[ch] += channels[ch];
            }
            for (uint8_t ch = 0; ch < 3; ++ch) held[ch] = accum[ch] / count;
            last_output = sum / count;
        }
        *left = *right = float(last_output);
    }
};
NativeAy8910 *core(void *p) { return static_cast<NativeAy8910 *>(p); }
}
extern "C" {
void *native_ay8910_create(uint32_t rate) { if (rate < 8000 || rate > 384000) return nullptr; try { return new NativeAy8910(rate); } catch (...) { return nullptr; } }
void native_ay8910_destroy(void *p) { delete core(p); }
void native_ay8910_reset(void *p) { core(p)->reset(); }
void native_ay8910_stop(void *p) { core(p)->stop(); }
void native_ay8910_all_notes_off(void *p) { core(p)->all_off(); }
void native_ay8910_write(void *p, uint8_t reg, uint8_t value) { core(p)->write(reg, value); }
void native_ay8910_key_off(void *p, uint8_t ch) { core(p)->off(ch); }
void native_ay8910_preview_key_off(void *p, uint8_t ch) { if (ch < 3) core(p)->write(8 + ch, 0); }
void native_ay8910_audition_key_on(void *p, uint8_t ch) { core(p)->audition(ch); }
void native_ay8910_set_retained_level(void *p, uint8_t ch, uint8_t level) { if (ch < 3 && level < 32) core(p)->levels[ch] = level; }
void native_ay8910_sample(void *p, float *left, float *right) { core(p)->sample(left, right); }
int native_ay8910_set_clock(void *p, uint32_t clock) { if (clock < 100000 || clock > 100000000) return 0; core(p)->clock = clock; return 1; }
uint8_t native_ay8910_read(void *p, uint8_t reg) { return core(p)->ay.read(reg); }
void native_ay8910_get_state(void *p, NativeAy8910State *state) { auto *h = core(p); std::memcpy(state->registers, h->registers.data(), 16); std::memcpy(state->levels, h->levels.data(), 3); state->clock = h->clock; }
}
