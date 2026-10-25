// Independent OPM provider: no X68000 OKI core or PCM sample banks.
#include "native_genesis_ym2151.h"
#include "ymfm_opm.h"
#include "ymfm_wasm_interface.h"
#include "ymfm_fm.ipp"
#include <algorithm>
#include <array>
#include <cstring>
#include <vector>

extern template class ymfm::fm_engine_base<ymfm::opm_registers>;
extern template class ymfm::fm_channel<ymfm::opm_registers>;
extern template class ymfm::fm_operator<ymfm::opm_registers>;

namespace {
struct Chip : ymfm::ym2151 {
    explicit Chip(ymfm_wasm_interface &intf) : ym2151(intf) {}
    std::array<output_data, 8> held{};
    output_data combined{};
    void remix() {
        combined.clear();
        for (const auto &channel : held) for (uint32_t bus = 0; bus < 2; ++bus) combined.data[bus] += channel.data[bus];
        combined.roundtrip_fp();
    }
    void silence(uint8_t channel) { held[channel].clear(); remix(); }
    void generate_masked(output_data &output, uint32_t mask) {
        m_fm.clock(fm_engine::ALL_CHANNELS);
        for (uint32_t ch = 0; ch < 8; ++ch) {
            m_fm.output(held[ch].clear(), 0, 32767, 1u << ch);
            // Still evaluate feedback on a muted channel, as the provider does.
            if (mask & (1u << ch)) held[ch].clear();
        }
        remix(); output = combined;
    }
    void clear_csm() {
        for (uint32_t ch = 0; ch < 8; ++ch) for (uint32_t op = 0; op < 4; ++op)
            m_fm.debug_channel(ch)->debug_operator(op)->keyonoff(0, ymfm::KEYON_CSM);
        m_fm.invalidate_caches();
    }
    void clear_history() { for (auto &channel : held) channel.clear(); combined.clear(); }
};
struct NativeYm2151 {
    ymfm_wasm_interface intf;
    Chip chip;
    const uint32_t rate;
    uint32_t clock = 3579545, forced = 0;
    uint64_t remainder = 0;
    double last_left = 0, last_right = 0;
    bool silent = false;
    uint8_t amd = 0, pmd = 0;
    std::array<uint8_t, 256> registers{};
    std::array<uint8_t, 8> keys{}, pending{};
    std::vector<uint8_t> initial;
    explicit NativeYm2151(uint32_t output_rate) : chip(intf), rate(output_rate) {
        chip.reset(); initial.reserve(4096);
        ymfm::ymfm_saved_state state(initial, true); chip.save_restore(state);
    }
    static float normalize(int32_t value) { return float(std::max(-32768, std::min(32767, value))) / 32768.0f; }
    void raw(uint8_t reg, uint8_t value) { chip.write(0, reg); chip.write(1, value); }
    void restore(uint8_t ch) {
        if (!(forced & (1u << ch))) return;
        forced &= ~(1u << ch);
        for (uint8_t op = 0; op < 4; ++op) raw(0x60 + op * 8 + ch, registers[0x60 + op * 8 + ch]);
    }
    void write(uint8_t reg, uint8_t value) {
        registers[reg] = value;
        if (reg == 8) {
            const uint8_t ch = value & 7; keys[ch] = (value >> 3) & 15; pending[ch] = 0;
            if (keys[ch]) { restore(ch); silent = false; }
        }
        if (reg == 0x19) { if (value & 128) pmd = value & 127; else amd = value & 127; }
        // Match the additional Worklet: CSM mode does not reopen its host
        // silent gate or restore channels explicitly force-muted by a preview.
        raw(reg, reg >= 0x60 && reg < 0x80 && (forced & (1u << (reg & 7))) ? 127 : value);
    }
    void off(uint8_t ch) {
        if (ch >= 8) return;
        pending[ch] = keys[ch] = 0; raw(8, ch); forced |= 1u << ch;
        for (uint8_t op = 0; op < 4; ++op) raw(0x60 + op * 8 + ch, 127);
        chip.silence(ch);
        // Only upsample holds can reuse the prior source sample. Keep the
        // independently sounding channels in that cached mix as well.
        if (chip.sample_rate(clock) < rate) {
            last_left = normalize(chip.combined.data[0]); last_right = normalize(chip.combined.data[1]);
        }
    }
    void off_fm(uint8_t ch) {
        if (ch >= 8) return;
        if ((registers[0x14] & 0x81) == 0x81) { pending[ch] = keys[ch] = 0; raw(8, ch); }
        else off(ch);
    }
    void cancel_csm() {
        write(0x14, registers[0x14] & ~0x81); chip.clear_csm();
        for (uint8_t ch = 0; ch < 8; ++ch) if (!keys[ch] && !pending[ch]) off(ch);
    }
    void all_notes_off() {
        for (uint8_t ch = 0; ch < 8; ++ch) off(ch);
        silent = true; last_left = last_right = 0;
    }
    void stop() {
        all_notes_off();
        write(0x14, registers[0x14] & 0x40); chip.clear_csm();
    }
    void reset() {
        // Browser Ym2151.reset recreates its core, resetting free-running noise,
        // LFO and envelope counters. Restore a control-captured power-on image
        // instead of allocating another engine on the audio callback.
        ymfm::ymfm_saved_state state(initial, false); chip.save_restore(state);
        intf.irq_asserted = false; intf.timer_remaining[0] = intf.timer_remaining[1] = -1;
        registers.fill(0); keys.fill(0); pending.fill(0); forced = amd = pmd = 0;
        remainder = 0; last_left = last_right = 0; silent = true; chip.clear_history();
    }
    void audition(uint8_t ch, uint8_t mask) { if (ch >= 8 || mask > 15) return; off(ch); pending[ch] = mask; }
    void sample(float *left, float *right) {
        remainder += chip.sample_rate(clock);
        const uint32_t count = uint32_t(remainder / rate); remainder -= uint64_t(count) * rate;
        if (count) {
            double l = 0, r = 0;
            for (uint32_t i = 0; i < count; ++i) {
                Chip::output_data output; chip.generate_masked(output, forced); intf.advance_sample(chip);
                l += normalize(output.data[0]); r += normalize(output.data[1]);
            }
            last_left = l / count; last_right = r / count;
        }
        *left = silent ? 0 : float(last_left); *right = silent ? 0 : float(last_right);
        // One ordinary source interval consumes the released gate. This never
        // generates/discards PCM from a control handler.
        if (count) for (uint8_t ch = 0; ch < 8; ++ch) if (pending[ch]) write(8, ch | (pending[ch] << 3));
    }
};
NativeYm2151 *core(void *p) { return static_cast<NativeYm2151 *>(p); }
}
extern "C" {
void *native_ym2151_create(uint32_t rate) { if (rate < 8000 || rate > 384000) return nullptr; try { return new NativeYm2151(rate); } catch (...) { return nullptr; } }
void native_ym2151_destroy(void *p) { delete core(p); }
void native_ym2151_reset(void *p) { core(p)->reset(); }
void native_ym2151_stop(void *p) { core(p)->stop(); }
void native_ym2151_all_notes_off(void *p) { core(p)->all_notes_off(); }
void native_ym2151_write(void *p, uint8_t reg, uint8_t value) { core(p)->write(reg, value); }
void native_ym2151_key_off(void *p, uint8_t ch) { core(p)->off(ch); }
void native_ym2151_key_off_fm(void *p, uint8_t ch) { core(p)->off_fm(ch); }
void native_ym2151_cancel_csm(void *p) { core(p)->cancel_csm(); }
void native_ym2151_audition_key_on(void *p, uint8_t ch, uint8_t mask) { core(p)->audition(ch, mask); }
void native_ym2151_sample(void *p, float *left, float *right) { core(p)->sample(left, right); }
int native_ym2151_set_clock(void *p, uint32_t clock) { if (clock < 100000 || clock > 100000000) return 0; core(p)->clock = clock; return 1; }
uint8_t native_ym2151_read(void *p, uint8_t offset) { return core(p)->chip.read(offset); }
uint8_t native_ym2151_read_status(void *p) { return core(p)->chip.read_status(); }
uint8_t native_ym2151_get_irq(void *p) { return core(p)->intf.irq_asserted ? 1 : 0; }
void native_ym2151_get_state(void *p, NativeYm2151State *s) {
    auto *h = core(p); std::memcpy(s->registers, h->registers.data(), 256); std::memcpy(s->keys, h->keys.data(), 8);
    s->clock = h->clock; s->status = h->chip.read_status(); s->irq = h->intf.irq_asserted ? 1 : 0; s->amd = h->amd; s->pmd = h->pmd;
}
}
