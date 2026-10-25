// Selected PC-98 YM2203: exact Browser ymfm OPN/SSG provider, no other chip.
#include "native_genesis_ym2203.h"
#include "ymfm_opn.h"
#include "ymfm_wasm_interface.h"
#include "ymfm_fm.ipp"
#include <algorithm>
#include <array>
#include <cstring>

// The Native OPN provider explicitly supplies these template definitions.
extern template class ymfm::fm_engine_base<ymfm::opn_registers>;
extern template class ymfm::fm_channel<ymfm::opn_registers>;
extern template class ymfm::fm_operator<ymfm::opn_registers>;

namespace {
struct Chip : ymfm::ym2203 {
    explicit Chip(ymfm_wasm_interface &intf) : ym2203(intf) {}
    uint8_t prescaler() const { return m_fm.clock_prescale(); }
    void clear_csm_key() {
        const auto *channel = m_fm.debug_channel(2);
        for (uint32_t op = 0; op < 4; ++op) channel->debug_operator(op)->keyonoff(0, ymfm::KEYON_CSM);
        m_fm.invalidate_caches();
    }
    bool next_fm_clock() const {
        // MAX fidelity uses 18 / 9 / 6 output intervals per actual FM clock.
        return m_fm_samples_per_output && m_ssg_resampler.sampindex() % m_fm_samples_per_output == 0;
    }
};
struct NativeYm2203 {
    ymfm_wasm_interface intf;
    Chip chip;
    const uint32_t rate;
    const bool additional;
    uint32_t clock = 4000000, source_mute_mask = 0, channel_mute_mask = 0, forced_mask = 0, pending = 0;
    uint64_t remainder = 0;
    double last = 0;
    bool stopped = false;
    std::array<uint8_t, 256> registers{};
    std::array<uint8_t, 3> keys{}, ssg_levels{};
    std::array<uint8_t, 3> pending_keys{};
    std::array<uint8_t, 2> frequency_latch{};
    explicit NativeYm2203(uint32_t sr, bool extra = false) : chip(intf), rate(sr), additional(extra) { chip.reset(); update_mute(); }
    void raw(uint8_t reg, uint8_t value) { chip.write(0, reg); chip.write(1, value); }
    void update_mute() { chip.set_mute_mask(channel_mute_mask | forced_mask | ((source_mute_mask & 2) ? 7 : 0)); }
    void restore(uint8_t channel) {
        if (forced_mask & (1 << channel)) {
            forced_mask &= ~(1 << channel);
            for (uint8_t op = 0; op < 4; ++op) raw(0x40 + channel + op * 4, registers[0x40 + channel + op * 4]);
            update_mute();
        }
    }
    void write(uint8_t reg, uint8_t value, bool author = true) {
        if ((reg & 0xf0) == 0xa0 && (reg & 3) != 3) {
            auto &latch = frequency_latch[(reg >> 3) & 1];
            if (reg & 4) latch = value & 63;
            else { registers[reg] = value; registers[reg | 4] = latch; }
        } else registers[reg] = value;
        if (reg == 0x28) {
            const uint8_t ch = value & 7;
            if (ch < 3) {
                pending &= ~(1u << ch); keys[ch] = value >> 4;
                if (value & 0xf0) { restore(ch); stopped = false; }
            }
        }
        // CSM can legitimately start channel 3 through Timer A without any
        // register-0x28 key-on. An explicit restart must restore its authored TL.
        if (reg == 0x27 && (value & 0x81) == 0x81) { restore(2); stopped = false; }
        if (reg >= 8 && reg <= 10) {
            const uint8_t level = value & 31;
            if (author && level) ssg_levels[reg - 8] = level;
            if (level) stopped = false;
        }
        // Forced silence changes the core TL, never the authored register view.
        const uint8_t ch = reg & 3;
        raw(reg, reg >= 0x40 && reg <= 0x4e && ch < 3 && (forced_mask & (1 << ch)) ? uint8_t(value | 127) : value);
    }
    void off(uint8_t voice) {
        if (voice < 3) {
            pending &= ~(1u << voice); keys[voice] = 0; registers[0x28] = voice; raw(0x28, voice);
            forced_mask |= 1 << voice;
            for (uint8_t op = 0; op < 4; ++op) raw(0x40 + voice + op * 4, registers[0x40 + voice + op * 4] | 127);
            update_mute();
        } else if (voice < 6) write(8 + voice - 3, 0, false);
        if (additional && voice < 6) {
            if (voice == 2) write(0x27, registers[0x27] & ~0x81);
            last = 0;
        }
    }
    void off_fm(uint8_t voice) {
        if (voice == 2 && (registers[0x27] & 0x81) == 0x81) {
            pending &= ~4u; keys[2] = 0; registers[0x28] = 2; raw(0x28, 2);
        } else off(voice);
    }
    void cancel_csm() {
        write(0x27, registers[0x27] & ~0x81); chip.clear_csm_key();
        if (!keys[2] && !(pending & 4)) off(2);
    }
    void audition(uint8_t voice) {
        if (voice < 3) audition_fm(voice, 15);
        else if (voice < 6) write(8 + voice - 3, ssg_levels[voice - 3], false);
    }
    void audition_fm(uint8_t channel, uint8_t mask) {
        if (channel >= 3 || mask >= 16) return;
        off(channel);
        if (mask) { pending_keys[channel] = mask; pending |= 1u << channel; }
    }
    void stop() {
        pending = 0;
        for (uint8_t voice = 0; voice < 6; ++voice) off(voice);
        // Keep channel-3 special/CSM configuration, while stopping both timers.
        write(0x27, registers[0x27] & 0xc0);
        stopped = true; last = 0;
    }
    void reset() {
        chip.reset(); intf.irq_asserted = false; intf.timer_remaining[0] = intf.timer_remaining[1] = -1;
        registers.fill(0); keys.fill(0); ssg_levels.fill(0); frequency_latch.fill(0); pending_keys.fill(0);
        // The primary YM2203 Worklet resets the chip while retaining its
        // output-rate remainder and held PCM. Keep that exact reset boundary.
        forced_mask = 0; pending = 0; update_mute(); stopped = false;
        if (additional) { remainder = 0; last = 0; }
    }
    static float normalize(int32_t value) { return float(std::max(-32768, std::min(32767, value))) / 32768.0f; }
    void sample(float *left, float *right) {
        remainder += chip.sample_rate(clock);
        const uint32_t count = uint32_t(remainder / rate); remainder -= uint64_t(count) * rate;
        bool fm_clock = false;
        if (count) {
            double sum = 0;
            for (uint32_t i = 0; i < count; ++i) {
                fm_clock |= chip.next_fm_clock(); Chip::output_data output;
                chip.generate(&output); intf.advance_sample(chip);
                int32_t mix = output.data[0];
                if (!(source_mute_mask & 1)) for (uint32_t bus = 1; bus < Chip::OUTPUTS; ++bus) mix += output.data[bus];
                sum += normalize(mix);
            }
            last = sum / count;
        }
        *left = *right = stopped ? 0 : float(last);
        if (fm_clock && pending) {
            const uint32_t starts = pending; pending = 0;
            for (uint8_t ch = 0; ch < 3; ++ch) if (starts & (1 << ch)) write(0x28, (pending_keys[ch] << 4) | ch);
        }
    }
};
NativeYm2203 *core(void *p) { return static_cast<NativeYm2203 *>(p); }
}
extern "C" {
void *native_ym2203_create(uint32_t rate) {
    if (rate < 8000 || rate > 384000) return nullptr;
    try { return new NativeYm2203(rate); } catch (...) { return nullptr; }
}
void *native_ym2203_create_extra(uint32_t rate) {
    if (rate < 8000 || rate > 384000) return nullptr;
    try { return new NativeYm2203(rate, true); } catch (...) { return nullptr; }
}
void native_ym2203_destroy(void *p) { delete core(p); }
void native_ym2203_reset(void *p) { core(p)->reset(); }
void native_ym2203_stop(void *p) { core(p)->stop(); }
void native_ym2203_write(void *p, uint8_t port, uint8_t reg, uint8_t value) { if (port == 0) core(p)->write(reg, value); }
void native_ym2203_key_off(void *p, uint8_t voice) { core(p)->off(voice); }
void native_ym2203_key_off_fm(void *p, uint8_t voice) { core(p)->off_fm(voice); }
void native_ym2203_cancel_csm(void *p) { core(p)->cancel_csm(); }
void native_ym2203_audition_key_on(void *p, uint8_t voice) { core(p)->audition(voice); }
void native_ym2203_audition_fm_key_on(void *p, uint8_t ch, uint8_t mask) { core(p)->audition_fm(ch, mask); }
void native_ym2203_set_retained_ssg_level(void *p, uint8_t ch, uint8_t level) { if (ch < 3 && level < 32) core(p)->ssg_levels[ch] = level; }
void native_ym2203_sample(void *p, float *left, float *right) { core(p)->sample(left, right); }
int native_ym2203_set_clock(void *p, uint32_t clock) { if (clock < 100000 || clock > 100000000) return 0; core(p)->clock = clock; return 1; }
void native_ym2203_set_source_mute_mask(void *p, uint32_t mask) { core(p)->source_mute_mask = mask & 3; core(p)->update_mute(); core(p)->last = 0; }
void native_ym2203_set_mute_mask(void *p, uint32_t mask) { core(p)->channel_mute_mask = mask & 7; core(p)->update_mute(); core(p)->last = 0; }
uint8_t native_ym2203_read(void *p, uint8_t offset) { return core(p)->chip.read(offset); }
uint8_t native_ym2203_read_status(void *p) { return core(p)->chip.read_status(); }
uint8_t native_ym2203_get_irq(void *p) { return core(p)->intf.irq_asserted ? 1 : 0; }
void native_ym2203_get_state(void *p, NativeYm2203State *s) {
    const auto *h = core(p); std::memcpy(s->registers, h->registers.data(), 256);
    std::memcpy(s->keys, h->keys.data(), 3); std::memcpy(s->ssg_levels, h->ssg_levels.data(), 3);
    s->clock = h->clock; s->source_mute_mask = h->source_mute_mask; s->channel_mute_mask = h->channel_mute_mask;
    s->prescaler = h->chip.prescaler(); s->status = core(p)->chip.read_status(); s->irq = h->intf.irq_asserted ? 1 : 0;
}
}
