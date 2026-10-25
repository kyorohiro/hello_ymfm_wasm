// Independent additional OPLL: no Sega PSG, AY or machine-level gains.
#include "native_genesis_ym2413.h"
#include "ymfm_opl.h"
#include "ymfm_wasm_interface.h"
#include "ymfm_fm.ipp"
#include <algorithm>
#include <array>
#include <cstring>
#include <vector>
extern template class ymfm::fm_engine_base<ymfm::opll_registers>;
extern template class ymfm::fm_channel<ymfm::opll_registers>;
extern template class ymfm::fm_operator<ymfm::opll_registers>;
namespace {
struct CachedOpll : ymfm::ym2413 {
    explicit CachedOpll(ymfm_wasm_interface &intf) : ym2413(intf) {}
    std::array<output_data, 9> held{};
    // Raw, pre-clamp single-operator rhythm values: BD/SD/TOM/CYM/HH.
    // Snare/hat and tom/cymbal share a physical channel and its DAC clamp.
    std::array<int32_t, 5> drums{};
    output_data combined{};
    void remix() {
        combined.clear();
        for (const auto &channel : held) for (uint32_t bus = 0; bus < OUTPUTS; ++bus) combined.data[bus] += channel.data[bus];
        for (uint32_t bus = 0; bus < OUTPUTS; ++bus) combined.data[bus] = (combined.data[bus] * 128) / 9;
    }
    int32_t mix() const { return combined.data[0] + combined.data[1]; }
    void silence(uint8_t channel) { held[channel].clear(); remix(); }
    void silence_drum(uint8_t index) {
        drums[index] = 0;
        const uint8_t physical = index == 0 ? 6 : (index == 1 || index == 4) ? 7 : 8;
        if (physical == 6) held[6].clear();
        else {
            held[physical].clear();
            const int32_t raw = physical == 7 ? drums[1] + drums[4] : drums[2] + drums[3];
            held[physical].data[1] = std::max(-257, std::min(256, raw)) * 2;
        }
        remix();
    }
    void clear_history() { for (auto &channel : held) channel.clear(); drums.fill(0); combined.clear(); }
    void generate_cached(output_data &output, uint32_t muted, uint8_t cancelled) {
        m_fm.clock(fm_engine::ALL_CHANNELS);
        for (uint32_t ch = 0; ch < 9; ++ch) {
            m_fm.output(held[ch].clear(), 5, 256, 1u << ch);
            if (muted & (1u << ch)) held[ch].clear();
        }
        if (m_fm.regs().rhythm_enable()) {
            const auto *hh = m_fm.debug_channel(7)->debug_operator(0), *sd = m_fm.debug_channel(7)->debug_operator(1);
            const auto *tom = m_fm.debug_channel(8)->debug_operator(0), *cym = m_fm.debug_channel(8)->debug_operator(1);
            // The pinned generic OPL rhythm path selects global operators13/17
            // even with OPLL's consecutive operator map. Mirror that exact
            // deployed behavior rather than substituting another phase source.
            const uint32_t a = hh->phase(), selector = m_fm.debug_operator(13)->phase(), b = m_fm.debug_operator(17)->phase();
            const uint32_t select = ((selector >> 2 ^ selector >> 7) & 1) | ((selector >> 3) & 1) | ((b >> 5 ^ b >> 3) & 1);
            const uint32_t noise = m_fm.regs().noise_state() & 1, am = m_fm.regs().lfo_am_offset(7);
            drums[0] = held[6].data[1];
            drums[1] = sd->compute_volume((0x100 << ((a >> 8) & 1)) ^ (noise << 8), am) >> 5;
            drums[4] = hh->compute_volume((select << 9) | (0xd0 >> (2 * (noise ^ select))), am) >> 5;
            drums[2] = tom->compute_volume(tom->phase(), am) >> 5;
            drums[3] = cym->compute_volume(0x100 | (select << 9), am) >> 5;
            if (muted & (1u << 7)) drums[1] = drums[4] = 0;
            if (muted & (1u << 8)) drums[2] = drums[3] = 0;
            for (uint8_t index = 0; index < 5; ++index) if (cancelled & (1u << index)) silence_drum(index);
        } else drums.fill(0);
        remix(); output = combined;
    }
};
namespace extra_opll_detail {
const uint8_t PHYSICAL[5] = {6, 7, 8, 8, 7};
const uint8_t VOLUME_REGISTER[5] = {0x36, 0x37, 0x38, 0x38, 0x37};
const uint8_t VOLUME_SHIFT[5] = {0, 0, 4, 0, 4};
}
struct NativeYm2413 {
    ymfm_wasm_interface intf;
    CachedOpll opll;
    uint32_t rate, opll_clock = 3579545;
    uint64_t opll_remainder = 0;
    double last_opll = 0;
    std::array<uint8_t, 64> registers{};
    std::vector<uint8_t> power_on;
    uint32_t pending = 0, forced_channels = 0x1ff;
    uint8_t muted_drums = 31, cancelled_drums = 0;
    bool silent = true;
    explicit NativeYm2413(uint32_t sr) : opll(intf), rate(sr) {
        power_on.reserve(4096);
        opll.reset();
        // Browser reset recreates the core. A preallocated snapshot resets all
        // free-running counters identically without callback allocation/free.
        ymfm::ymfm_saved_state saved(power_on, true); opll.save_restore(saved); update_mute();
    }
    void raw_opll(uint8_t reg, uint8_t value) { opll.write(0, reg); opll.write(1, value); }
    void update_mute() { opll.set_mute_mask(forced_channels); }
    void volume(uint8_t reg) {
        uint8_t value = registers[reg];
        if (registers[0x0e] & 32) for (uint8_t i = 0; i < 5; ++i) if ((muted_drums & (1 << i)) && extra_opll_detail::VOLUME_REGISTER[i] == reg)
            value = uint8_t((value & ~(15 << extra_opll_detail::VOLUME_SHIFT[i])) | (15 << extra_opll_detail::VOLUME_SHIFT[i]));
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
                muted_drums &= ~(1 << i); cancelled_drums &= ~(1 << i); restore(extra_opll_detail::PHYSICAL[i]);
            }
        }
        if (reg >= 0x30 && reg <= 0x38) volume(reg); else raw_opll(reg, value);
    }
    void key_off(uint8_t voice) {
        if (voice < 9) {
            const uint8_t channel = voice; pending &= ~(1u << channel);
            registers[0x20 + channel] &= ~16; raw_opll(0x20 + channel, registers[0x20 + channel]);
            // FM6..8 are hardware aliases of rhythm operators. Releasing a
            // previous melodic owner must not mute a replacement drum owner.
            if (!((registers[0x0e] & 32) && channel >= 6)) {
                forced_channels |= 1u << channel; update_mute(); silence_held(channel);
            }
        } else if (voice < 14) {
            const uint8_t index = voice - 9, bit = 16 >> index, physical = extra_opll_detail::PHYSICAL[index];
            pending &= ~(1u << (9 + index)); registers[0x0e] &= ~bit; raw_opll(0x0e, registers[0x0e]);
            muted_drums |= 1 << index; cancelled_drums |= 1 << index;
            // A latent drum flag can remain authored while mode changes are
            // guarded by an independently held melodic FM6..8 voice.
            if (!(registers[0x0e] & 32)) return;
            volume(extra_opll_detail::VOLUME_REGISTER[index]);
            opll.silence_drum(index);
            if (opll.sample_rate(opll_clock) < rate) last_opll = normalize(opll.mix());
            bool other = false;
            for (uint8_t i = 0; i < 5; ++i) if (extra_opll_detail::PHYSICAL[i] == physical && (registers[0x0e] & (16 >> i))) other = true;
            if (!other) { forced_channels |= 1u << physical; update_mute(); silence_held(physical); }
        }
    }
    void silence_held(uint8_t channel) {
        opll.silence(channel);
        if (opll.sample_rate(opll_clock) < rate) last_opll = normalize(opll.mix());
    }
    void audition(uint8_t voice) {
        if (voice >= 14) return;
        preview_off(voice); pending |= 1u << voice;
    }
    void preview_off(uint8_t voice) {
        // Match the Worklet's public/manual release: the previous source frame
        // is held until an ordinary source interval consumes the released gate.
        // Runtime cancellation instead calls key_off to remove only that voice.
        const auto held = opll.held; const auto combined = opll.combined; const auto drums = opll.drums;
        const double previous = last_opll; const uint8_t cancelled = cancelled_drums;
        key_off(voice); opll.held = held; opll.combined = combined; opll.drums = drums; last_opll = previous;
        cancelled_drums = cancelled;
    }
    void stop_opll() {
        pending = 0; for (uint8_t voice = 0; voice < 9; ++voice) key_off(voice);
        registers[0x0e] &= 224; raw_opll(0x0e, registers[0x0e]); muted_drums = 31;
        for (uint8_t reg = 0x36; reg <= 0x38; ++reg) volume(reg);
        forced_channels = 0x1ff; update_mute(); opll.clear_history();
        silent = true; last_opll = 0;
    }
    void reset_opll() {
        ymfm::ymfm_saved_state saved(power_on, false); opll.save_restore(saved);
        intf.irq_asserted = false; intf.timer_remaining[0] = intf.timer_remaining[1] = -1;
        registers.fill(0); forced_channels = 0x1ff; muted_drums = 31; cancelled_drums = 0; update_mute();
        pending = 0; opll_remainder = 0; last_opll = 0; silent = true; opll.clear_history();
    }
    static float normalize(int32_t value) { return float(std::max(-32768, std::min(32767, value))) / 32768.0f; }
    void sample_opll(float *left, float *right) {
        opll_remainder += opll.sample_rate(opll_clock);
        const uint32_t count = uint32_t(opll_remainder / rate); opll_remainder -= uint64_t(count) * rate;
        if (count) {
            double sum = 0;
            for (uint32_t i = 0; i < count; ++i) {
                ymfm::ym2413::output_data output; opll.generate_cached(output, forced_channels, cancelled_drums); intf.advance_sample(opll);
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

NativeYm2413 *core(void *p) { return static_cast<NativeYm2413 *>(p); }
}
extern "C" {
void *native_ym2413_create(uint32_t rate) { if (rate < 8000 || rate > 384000) return nullptr; try { return new NativeYm2413(rate); } catch (...) { return nullptr; } }
void native_ym2413_destroy(void *p) { delete core(p); }
void native_ym2413_reset(void *p) { core(p)->reset_opll(); }
void native_ym2413_stop(void *p) { core(p)->stop_opll(); }
void native_ym2413_write(void *p, uint8_t reg, uint8_t value) { core(p)->opll_write(reg, value); }
void native_ym2413_key_off(void *p, uint8_t voice) { core(p)->key_off(voice); }
void native_ym2413_preview_key_off(void *p, uint8_t voice) { core(p)->preview_off(voice); }
void native_ym2413_audition_key_on(void *p, uint8_t voice) { core(p)->audition(voice); }
void native_ym2413_sample(void *p, float *left, float *right) { core(p)->sample_opll(left, right); }
int native_ym2413_set_clock(void *p, uint32_t clock) { if (clock < 100000 || clock > 100000000) return 0; core(p)->opll_clock = clock; return 1; }
uint8_t native_ym2413_read(void *p, uint8_t offset) { return core(p)->opll.read(offset); }
uint8_t native_ym2413_read_status(void *p) { return core(p)->opll.read_status(); }
uint8_t native_ym2413_get_irq(void *p) { return core(p)->intf.irq_asserted ? 1 : 0; }
void native_ym2413_get_state(void *p, NativeYm2413State *state) {
    auto *h = core(p); std::memcpy(state->registers, h->registers.data(), 64); state->clock = h->opll_clock;
    state->status = h->opll.read_status(); state->irq = h->intf.irq_asserted ? 1 : 0;
}
}
