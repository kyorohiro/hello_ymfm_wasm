// The same pinned ymfm OPNA core as Browser/WASM, with its output-rate adapter.
#include "native_genesis_ym2608.h"
#include "ymfm_opn.h"
#include "ymfm_wasm_interface.h"
#include "ymfm_fm.ipp"
#include <algorithm>
#include <array>
#include <cstring>
#include <vector>

// The Native OPN provider explicitly supplies these template definitions.
extern template class ymfm::fm_engine_base<ymfm::opna_registers>;
extern template class ymfm::fm_channel<ymfm::opna_registers>;
extern template class ymfm::fm_operator<ymfm::opna_registers>;

namespace {
constexpr uint32_t ROM_SIZE = 0x2000, MEMORY_SIZE = 0x200000;
struct Interface : ymfm_wasm_interface {
    // Allocate once during create, never while applying a callback command.
    std::vector<uint8_t> rom = std::vector<uint8_t>(ROM_SIZE, 0);
    std::vector<uint8_t> memory = std::vector<uint8_t>(MEMORY_SIZE, 0);
    uint8_t ymfm_external_read(ymfm::access_class type, uint32_t address) override {
        if (type == ymfm::ACCESS_ADPCM_A) return address < rom.size() ? rom[address] : 0;
        if (type == ymfm::ACCESS_ADPCM_B) return address < memory.size() ? memory[address] : 0;
        return 0;
    }
    void ymfm_external_write(ymfm::access_class type, uint32_t address, uint8_t value) override {
        if (type == ymfm::ACCESS_ADPCM_B && address < memory.size()) memory[address] = value;
    }
};
struct Chip : ymfm::ym2608 {
    explicit Chip(Interface &intf) : ym2608(intf) {}
    uint8_t peek_status() {
        // The primary status read is observational; unlike read_status_hi it
        // does not propagate the ADPCM flags back into the interrupt engine.
        return read_status();
    }
    uint8_t peek_status_hi() {
        uint8_t value = peek_status() & (fm_engine::STATUS_TIMERA | fm_engine::STATUS_TIMERB);
        const uint8_t adpcm = m_adpcm_b.status();
        if (adpcm & ymfm::adpcm_b_channel::STATUS_EOS) value |= 0x04;
        if (adpcm & ymfm::adpcm_b_channel::STATUS_BRDY) value |= 0x08;
        if (adpcm & ymfm::adpcm_b_channel::STATUS_PLAYING) value |= 0x20;
        return value & ~(m_flag_control & 0x1f);
    }
    void clear_output_history() { m_last_fm.clear(); }
    uint8_t prescaler() const { return m_fm.clock_prescale(); }
    bool next_fm_clock() const { return m_fm_samples_per_output && m_ssg_resampler.sampindex() % m_fm_samples_per_output == 0; }
    // Additional-instance cancellation keeps the independently sounding buses.
    // Retain the last contribution from each FM channel separately, then remix
    // without clocking/re-evaluating any foreign operator or ADPCM decoder.
    std::array<fm_engine::output_data, 6> held_fm{};
    fm_engine::output_data held_adpcm{};
    int32_t held_ssg = 0;
    void remix_history() {
        m_last_fm.clear();
        for (const auto &channel : held_fm) for (uint32_t bus = 0; bus < 2; ++bus) m_last_fm.data[bus] += channel.data[bus];
        for (uint32_t bus = 0; bus < 2; ++bus) m_last_fm.data[bus] += held_adpcm.data[bus];
        m_last_fm.clamp16();
    }
    void silence_fm(uint8_t ch) { held_fm[ch].clear(); remix_history(); }
    void held_output(output_data &output) const {
        output.data[0] = m_last_fm.data[0]; output.data[1] = m_last_fm.data[1]; output.data[2] = held_ssg;
    }
    void generate_extra(output_data *output, uint32_t mask) {
        // The public provider defaults to MAX fidelity; the host exposes no
        // fidelity changes. This is its exact one-source-sample clock path.
        if (next_fm_clock()) {
            const uint32_t channels = (m_irq_enable & 0x80) ? 0x3f : 7;
            const uint32_t envelope = m_fm.clock(fm_engine::ALL_CHANNELS);
            if ((envelope & 3) == 0) m_adpcm_a.clock((envelope & 4) ? 0x0f : 0x3f);
            m_adpcm_b.clock();
            for (uint32_t ch = 0; ch < 6; ++ch) {
                auto &value = held_fm[ch]; value.clear();
                if (channels & (1u << ch)) m_fm.output(value, 1, 32767, 1u << ch);
                // Evaluate muted channels too, so their feedback state advances.
                if (mask & (1u << ch)) value.clear();
            }
            held_adpcm.clear();
            if (!m_rhythm_muted) m_adpcm_a.output(held_adpcm, 0x3f);
            if (!m_delta_t_muted) m_adpcm_b.output(held_adpcm, 1);
            remix_history();
        }
        output->data[0] = m_last_fm.data[0]; output->data[1] = m_last_fm.data[1];
        m_ssg_resampler.resample(output, 1); held_ssg = output->data[2];
    }
    void clear_csm_key() {
        const auto *channel = m_fm.debug_channel(2);
        for (uint32_t op = 0; op < 4; ++op) channel->debug_operator(op)->keyonoff(0, ymfm::KEYON_CSM);
        m_fm.invalidate_caches();
    }
};
struct NativeYm2608 {
    Interface intf;
    Chip chip;
    const bool additional;
    uint32_t output_rate, clock = 8000000, source_mute_mask = 0;
    uint32_t forced_mask = 0, pending = 0;
    bool stopped = false;
    std::array<uint8_t, 6> keys{}, pending_keys{};
    std::array<uint8_t, 3> ssg_levels{};
    uint64_t remainder = 0;
    double last_left = 0, last_right = 0;
    std::array<uint8_t, 512> registers{};
    std::array<bool, 512> written{};
    std::array<uint8_t, 2> frequency_latch{};

    explicit NativeYm2608(uint32_t rate, bool extra = false) : chip(intf), additional(extra), output_rate(rate) { reset(); }
    void reset() {
        chip.reset();
        // Additional Worklet calls chip.reset only, preserving output-rate phase
        // and held PCM. The primary Native profile keeps its prior reset behavior.
        if (!additional) { remainder = 0; last_left = last_right = 0; }
        forced_mask = pending = 0; stopped = false;
        keys.fill(0); pending_keys.fill(0); ssg_levels.fill(0);
        registers.fill(0); written.fill(false); frequency_latch.fill(0);
        for (auto reg : {0xb4, 0xb5, 0xb6, 0x1b4, 0x1b5, 0x1b6}) registers[reg] = 0xc0;
        for (uint32_t reg = 0x18; reg <= 0x1d; ++reg) registers[reg] = 0xdf;
        registers[0x10c] = registers[0x10d] = 0xff;
        registers[0x29] = 0x1f; registers[0x110] = 0x1c;
        chip.set_adpcm_mute((source_mute_mask & 2) != 0, (source_mute_mask & 4) != 0);
    }
    void raw(uint8_t port, uint8_t reg, uint8_t value) { chip.write(port * 2, reg); chip.write(port * 2 + 1, value); }
    void restore(uint8_t ch) {
        if (!(forced_mask & (1u << ch))) return;
        forced_mask &= ~(1u << ch);
        for (uint8_t op = 0; op < 4; ++op) {
            const uint8_t reg = 0x40 + ch % 3 + op * 4;
            raw(ch / 3, reg, registers[(ch / 3) * 256 + reg]);
        }
    }
    void write(uint8_t port, uint8_t reg, uint8_t value, bool author = true) {
        if (port > 1) return;
        const uint32_t base = port * 256;
        // ymfm commits a high/low frequency pair on the low-byte write. Keep
        // the applied pair for inspection and latch-safe Stop restoration.
        if ((reg & 0xf0) == 0xa0 && (reg & 3) != 3) {
            auto &latch = frequency_latch[(reg >> 3) & 1];
            if (reg & 4) latch = value & 0x3f;
            else {
                registers[base + reg] = value;
                registers[base + (reg | 4)] = latch;
                written[base + reg] = written[base + (reg | 4)] = true;
            }
        } else if (!(port == 1 && reg == 0x10 && (value & 0x80))) {
            // IRQ flag-clear is a command; it does not replace the applied
            // mask. Keeping the mask avoids changing IRQ settings on Stop.
            registers[base + reg] = value;
            written[base + reg] = true;
        }
        if (additional) {
            if (!port && reg == 0x28 && (value & 3) < 3) {
                const uint8_t ch = (value & 3) + ((value & 4) ? 3 : 0);
                pending &= ~(1u << ch); keys[ch] = value >> 4;
                if (value & 0xf0) { restore(ch); stopped = false; }
            }
            if (!port && reg == 0x27 && (value & 0x81) == 0x81) { restore(2); stopped = false; }
            if (!port && reg >= 8 && reg <= 10) {
                if (author && (value & 31)) ssg_levels[reg - 8] = value & 31;
                if (value & 31) stopped = false;
            }
            if ((!port && reg == 0x10 && !(value & 0x80) && (value & 63)) || (port && !reg && (value & 0x80))) stopped = false;
            const uint8_t ch = port * 3 + (reg & 3);
            if (reg >= 0x40 && reg <= 0x4e && (reg & 3) < 3 && (forced_mask & (1u << ch))) value |= 127;
        }
        raw(port, reg, value);
    }
    void key_off(uint8_t voice) {
        if (voice < 6) {
            write(0, 0x28, voice < 3 ? voice : voice + 1);
            if (additional) {
                forced_mask |= 1u << voice;
                for (uint8_t op = 0; op < 4; ++op) {
                    const uint8_t reg = 0x40 + voice % 3 + op * 4;
                    raw(voice / 3, reg, registers[(voice / 3) * 256 + reg] | 127);
                }
                if (voice == 2) write(0, 0x27, registers[0x27] & ~0x81);
                chip.silence_fm(voice);
                // Only an upsampled frame can reuse this held source sample.
                // At higher chip rates the next output always renders afresh.
                if (chip.sample_rate(clock) < output_rate) {
                    Chip::output_data held; chip.held_output(held);
                    const int32_t ssg = source_mute_mask & 1 ? 0 : held.data[2];
                    last_left = normalize(held.data[0] + ssg); last_right = normalize(held.data[1] + ssg);
                }
            }
        }
        else if (voice < 9) write(0, 8 + voice - 6, 0, false);
        else if (voice < 15) write(0, 0x10, 0x80 | (1 << (voice - 9)));
        else if (voice == 15) write(1, 0, 1);
    }
    void key_off_fm(uint8_t voice) {
        if (voice == 2 && (registers[0x27] & 0x81) == 0x81) write(0, 0x28, 2);
        else key_off(voice);
    }
    void cancel_csm() {
        write(0, 0x27, registers[0x27] & ~0x81); chip.clear_csm_key();
        if (!keys[2] && !(pending & 4)) key_off(2);
    }
    void audition_fm(uint8_t ch, uint8_t mask) {
        if (ch >= 6 || mask >= 16) return;
        key_off(ch);
        if (mask) { pending_keys[ch] = mask; pending |= 1u << ch; }
    }
    void stop() {
        if (additional) {
            for (uint8_t voice = 0; voice < 16; ++voice) key_off(voice);
            write(0, 0x27, registers[0x27] & 0xc0);
            stopped = true; last_left = last_right = 0; return;
        }
        const auto saved = registers;
        const auto valid = written;
        const auto saved_latch = frequency_latch;
        reset(); chip.clear_output_history();
        for (uint32_t index = 0; index < 512; ++index) {
            if (!valid[index]) continue;
            const uint8_t port = index >> 8, reg = index & 255;
            if ((reg >= 0xa0 && reg <= 0xaf) || (index >= 0x2d && index <= 0x2f) || index == 0x10 || index == 0x28 ||
                index == 0x100 || index == 0x108 || (index >= 8 && index <= 10)) continue;
            uint8_t value = saved[index];
            if (index == 0x27) value &= 0xc0; // Stop timers/CSM triggers.
            if (index == 0x110) value &= 0x7f;
            write(port, reg, value);
        }
        for (uint8_t port = 0; port < 2; ++port)
            for (uint8_t base : {0xa0, 0xa8}) for (uint8_t ch = 0; ch < 3; ++ch) {
                const uint8_t low = base + ch, high = low + 4;
                if (valid[port * 256 + high]) write(port, high, saved[port * 256 + high]);
                if (valid[port * 256 + low]) write(port, low, saved[port * 256 + low]);
            }
        write(0, 0xa4, saved_latch[0]); write(0, 0xac, saved_latch[1]);
        // Explicitly stop all non-FM sections; their RAM/ROM and pitch remain.
        for (uint8_t voice = 6; voice < 16; ++voice) key_off(voice);
    }
    static float normalize(int32_t value) {
        return static_cast<float>(std::max(-32768, std::min(32767, value))) / 32768.0f;
    }
    void sample(float *left, float *right) {
        // Match Ym2608AudioEngine exactly: normalize/clamp each native sample,
        // then average in double precision, holding the prior value on upsample.
        remainder += chip.sample_rate(clock);
        const uint32_t count = static_cast<uint32_t>(remainder / output_rate);
        remainder -= static_cast<uint64_t>(count) * output_rate;
        bool fm_clock = false;
        if (count) {
            double l = 0, r = 0;
            for (uint32_t n = 0; n < count; ++n) {
                fm_clock |= additional && chip.next_fm_clock();
                Chip::output_data output;
                if (additional) chip.generate_extra(&output, forced_mask); else chip.generate(&output);
                intf.advance_sample(chip);
                const int32_t ssg = source_mute_mask & 1 ? 0 : output.data[2];
                l += normalize(output.data[0] + ssg); r += normalize(output.data[1] + ssg);
            }
            last_left = l / count; last_right = r / count;
        }
        *left = stopped ? 0 : static_cast<float>(last_left); *right = stopped ? 0 : static_cast<float>(last_right);
        if (fm_clock && pending) {
            const uint32_t starts = pending; pending = 0;
            for (uint8_t ch = 0; ch < 6; ++ch) if (starts & (1u << ch)) write(0, 0x28, (pending_keys[ch] << 4) | (ch < 3 ? ch : ch + 1));
        }
    }
};
NativeYm2608 *core(void *ptr) { return static_cast<NativeYm2608 *>(ptr); }
int transfer(std::vector<uint8_t> &target, const uint8_t *bytes, uint32_t offset, uint32_t size) {
    if (offset > target.size() || size > target.size() - offset || (size && !bytes)) return 0;
    if (size) std::memcpy(target.data() + offset, bytes, size);
    return 1;
}
}
extern "C" {
void *native_ym2608_create(uint32_t rate) {
    if (rate < 8000 || rate > 384000) return nullptr;
    try { return new NativeYm2608(rate); } catch (...) { return nullptr; }
}
void *native_ym2608_create_extra(uint32_t rate) {
    if (rate < 8000 || rate > 384000) return nullptr;
    try { return new NativeYm2608(rate, true); } catch (...) { return nullptr; }
}
void native_ym2608_destroy(void *ptr) { delete core(ptr); }
void native_ym2608_reset(void *ptr) { core(ptr)->reset(); }
void native_ym2608_stop(void *ptr) { core(ptr)->stop(); }
void native_ym2608_key_off(void *ptr, uint8_t voice) { core(ptr)->key_off(voice); }
void native_ym2608_key_off_fm(void *ptr, uint8_t voice) { core(ptr)->key_off_fm(voice); }
void native_ym2608_cancel_csm(void *ptr) { core(ptr)->cancel_csm(); }
void native_ym2608_audition_fm_key_on(void *ptr, uint8_t ch, uint8_t mask) { core(ptr)->audition_fm(ch, mask); }
void native_ym2608_set_retained_ssg_level(void *ptr, uint8_t ch, uint8_t level) { if (ch < 3 && level < 32) core(ptr)->ssg_levels[ch] = level; }
void native_ym2608_write(void *ptr, uint8_t port, uint8_t reg, uint8_t value) { core(ptr)->write(port, reg, value); }
void native_ym2608_sample(void *ptr, float *left, float *right) { core(ptr)->sample(left, right); }
int native_ym2608_set_clock(void *ptr, uint32_t clock) {
    if (clock < 100000 || clock > 100000000) return 0;
    core(ptr)->clock = clock; return 1;
}
void native_ym2608_set_source_mute_mask(void *ptr, uint32_t mask) {
    auto *h = core(ptr); h->source_mute_mask = mask & 7;
    h->chip.set_adpcm_mute((mask & 2) != 0, (mask & 4) != 0);
}
int native_ym2608_load_rom(void *ptr, const uint8_t *bytes, uint32_t offset, uint32_t size) { return transfer(core(ptr)->intf.rom, bytes, offset, size); }
int native_ym2608_load_memory(void *ptr, const uint8_t *bytes, uint32_t offset, uint32_t size) { return transfer(core(ptr)->intf.memory, bytes, offset, size); }
void native_ym2608_clear_memory(void *ptr) { auto &memory = core(ptr)->intf.memory; std::fill(memory.begin(), memory.end(), 0); }
int native_ym2608_copy_memory(void *ptr, uint8_t *bytes, uint32_t offset, uint32_t size) {
    const auto &memory = core(ptr)->intf.memory;
    if (offset > memory.size() || size > memory.size() - offset || (size && !bytes)) return 0;
    if (size) std::memcpy(bytes, memory.data() + offset, size);
    return 1;
}
uint8_t native_ym2608_read(void *ptr, uint8_t offset) { return core(ptr)->chip.read(offset); }
uint8_t native_ym2608_read_status(void *ptr) { return core(ptr)->chip.read_status(); }
uint8_t native_ym2608_read_status_hi(void *ptr) { return core(ptr)->chip.read_status_hi(); }
uint8_t native_ym2608_get_irq(void *ptr) { return core(ptr)->intf.irq_asserted ? 1 : 0; }
void native_ym2608_get_state(void *ptr, NativeYm2608State *state) {
    auto *h = core(ptr);
    std::memcpy(state->registers, h->registers.data(), h->registers.size());
    state->clock = h->clock; state->source_mute_mask = h->source_mute_mask;
    state->status = h->chip.peek_status(); state->status_hi = h->chip.peek_status_hi();
    state->irq = h->intf.irq_asserted ? 1 : 0;
}
void native_ym2608_get_extra_state(void *ptr, NativeYm2608ExtraState *state) {
    auto *h = core(ptr);
    std::memcpy(state->registers, h->registers.data(), h->registers.size());
    state->clock = h->clock; state->source_mute_mask = h->source_mute_mask;
    std::memcpy(state->keys, h->keys.data(), 6); std::memcpy(state->ssg_levels, h->ssg_levels.data(), 3);
    state->prescaler = h->chip.prescaler(); state->status = h->chip.peek_status(); state->status_hi = h->chip.peek_status_hi();
    state->irq = h->intf.irq_asserted ? 1 : 0;
}

}
