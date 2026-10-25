// One independent ymfm YM2612, without Genesis PSG or its output gain/DC filter.
#include "native_genesis_ym2612.h"
#include "ymfm_opn.h"
#include "ymfm_wasm_interface.h"
#include "ymfm_fm.ipp"
#include <algorithm>
#include <array>
#include <cstring>

// The Native OPN provider explicitly supplies these template definitions.
extern template class ymfm::fm_engine_base<ymfm::opna_registers>;
extern template class ymfm::fm_channel<ymfm::opna_registers>;
extern template class ymfm::fm_operator<ymfm::opna_registers>;

namespace {
struct Chip : ymfm::ym2612 {
    explicit Chip(ymfm_wasm_interface &intf) : ym2612(intf) {}
    void clear_csm_key() {
        const auto *channel = m_fm.debug_channel(2);
        for (uint32_t op = 0; op < 4; ++op) channel->debug_operator(op)->keyonoff(0, ymfm::KEYON_CSM);
        m_fm.invalidate_caches();
    }
    void generate_masked(output_data *output, uint32_t mask) {
        if (!mask) { generate(output); return; }
        // Same per-channel ladder and integer rounding as ymfm::ym2612.
        // Muting does not stop clocks or alter patch/envelope state.
        m_fm.clock(fm_engine::ALL_CHANNELS); output->clear(); output_data temp;
        const int last = m_dac_enable ? 5 : 6;
        for (int ch = 0; ch < last; ++ch) {
            m_fm.output(temp.clear(), 5, 256, 1u << ch);
            if (mask & (1u << ch)) temp.clear();
            output->data[0] += dac_discontinuity(temp.data[0]);
            output->data[1] += dac_discontinuity(temp.data[1]);
        }
        if (m_dac_enable) {
            const int32_t dac = mask & 32 ? dac_discontinuity(0) : dac_discontinuity(int16_t(m_dac_data << 7) >> 7);
            output->data[0] += m_fm.regs().ch_output_0(0x102) ? dac : dac_discontinuity(0);
            output->data[1] += m_fm.regs().ch_output_1(0x102) ? dac : dac_discontinuity(0);
        }
        output->data[0] = (output->data[0] * 128) * 64 / (6 * 65);
        output->data[1] = (output->data[1] * 128) * 64 / (6 * 65);
    }
};
struct NativeYm2612 {
    ymfm_wasm_interface intf;
    Chip chip;
    const uint32_t rate;
    uint32_t clock = 7670454, channel_mute_mask = 0, forced_mask = 0, pending = 0;
    uint64_t remainder = 0;
    double last_left = 0, last_right = 0;
    bool stopped = false;
    std::array<uint8_t, 512> registers{};
    std::array<uint8_t, 6> keys{}, pending_keys{};
    std::array<uint8_t, 2> frequency_latch{};
    explicit NativeYm2612(uint32_t sr) : chip(intf), rate(sr) { chip.reset(); }
    static uint8_t code(uint8_t ch) { return ch < 3 ? ch : ch + 1; }
    void raw(uint8_t port, uint8_t reg, uint8_t value) { chip.write(port * 2, reg); chip.write(port * 2 + 1, value); }
    void restore(uint8_t ch) {
        if (!(forced_mask & (1u << ch))) return;
        forced_mask &= ~(1u << ch);
        const uint8_t port = ch / 3, offset = ch % 3;
        for (uint8_t op = 0; op < 4; ++op) {
            const uint8_t reg = 0x40 + offset + op * 4;
            raw(port, reg, registers[port * 256 + reg]);
        }
    }
    void write(uint8_t port, uint8_t reg, uint8_t value) {
        if (port > 1) return;
        if ((reg & 0xf0) == 0xa0) {
            if ((reg & 3) != 3) {
                // The normal/special high-byte latches are shared by both ports.
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
        raw(port, reg, reg >= 0x40 && reg <= 0x4e && offset < 3 && (forced_mask & (1u << ch)) ? uint8_t(value | 127) : value);
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
        // These sources can trigger without an ordinary FM key-on. Releasing
        // their owner must stop the source gate as well as the current output.
        if (ch == 2) write(0, 0x27, registers[0x27] & ~0x81);
        if (ch == 5) write(0, 0x2b, registers[0x2b] & 0x7f);
        // A held resampled frame must not leak a cancelled voice for another
        // output interval, especially at the lowest supported master clock.
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
        chip.clear_csm_key();
        // A normal note (or its pending fresh edge) can belong to another
        // owner. Only a CSM-only voice needs forced immediate cancellation.
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
        // Match the additional OPN Worklet exactly: reset ymfm and its output
        // remainder/hold. ymfm retains its hardware DAC latch on this reset.
        chip.reset(); registers.fill(0); keys.fill(0); pending_keys.fill(0); frequency_latch.fill(0);
        remainder = 0; last_left = last_right = 0; forced_mask = pending = 0; stopped = false;
    }
    static float normalize(int32_t value) { return float(std::max(-32768, std::min(32767, value))) / 32768.0f; }
    void sample(float *left, float *right) {
        remainder += chip.sample_rate(clock);
        const uint32_t count = uint32_t(remainder / rate); remainder -= uint64_t(count) * rate;
        if (count) {
            double l = 0, r = 0;
            for (uint32_t i = 0; i < count; ++i) {
                Chip::output_data output; chip.generate_masked(&output, channel_mute_mask | forced_mask); intf.advance_sample(chip);
                l += normalize(output.data[0]); r += normalize(output.data[1]);
            }
            last_left = l / count; last_right = r / count;
        }
        *left = stopped ? 0 : float(last_left); *right = stopped ? 0 : float(last_right);
        // Let a real chip clock observe the low gate before the fresh key edge.
        if (count && pending) {
            const uint32_t starts = pending; pending = 0;
            for (uint8_t ch = 0; ch < 6; ++ch) if (starts & (1u << ch)) write(0, 0x28, uint8_t((pending_keys[ch] << 4) | code(ch)));
        }
    }
};
NativeYm2612 *core(void *p) { return static_cast<NativeYm2612 *>(p); }
}
extern "C" {
void *native_ym2612_create(uint32_t rate) { if (rate < 8000 || rate > 384000) return nullptr; try { return new NativeYm2612(rate); } catch (...) { return nullptr; } }
void native_ym2612_destroy(void *p) { delete core(p); }
void native_ym2612_reset(void *p) { core(p)->reset(); }
void native_ym2612_stop(void *p) { core(p)->stop(); }
void native_ym2612_write(void *p, uint8_t port, uint8_t reg, uint8_t value) { core(p)->write(port, reg, value); }
void native_ym2612_key_off(void *p, uint8_t ch) { core(p)->off(ch); }
void native_ym2612_key_off_fm(void *p, uint8_t ch) { core(p)->off_fm(ch); }
void native_ym2612_cancel_csm(void *p) { core(p)->cancel_csm(); }
void native_ym2612_audition_fm_key_on(void *p, uint8_t ch, uint8_t mask) { core(p)->audition(ch, mask); }
void native_ym2612_sample(void *p, float *left, float *right) { core(p)->sample(left, right); }
int native_ym2612_set_clock(void *p, uint32_t clock) { if (clock < 100000 || clock > 100000000) return 0; core(p)->clock = clock; return 1; }
void native_ym2612_set_mute_mask(void *p, uint32_t mask) { core(p)->channel_mute_mask = mask & 63; core(p)->last_left = core(p)->last_right = 0; }
uint8_t native_ym2612_read(void *p, uint8_t offset) { return core(p)->chip.read(offset); }
uint8_t native_ym2612_read_status(void *p) { return core(p)->chip.read_status(); }
uint8_t native_ym2612_get_irq(void *p) { return core(p)->intf.irq_asserted ? 1 : 0; }
void native_ym2612_get_state(void *p, NativeYm2612State *s) {
    auto *h = core(p); std::memcpy(s->registers, h->registers.data(), 512); std::memcpy(s->keys, h->keys.data(), 6);
    s->clock = h->clock; s->channel_mute_mask = h->channel_mute_mask; s->status = h->chip.read_status(); s->irq = h->intf.irq_asserted ? 1 : 0;
}
}
