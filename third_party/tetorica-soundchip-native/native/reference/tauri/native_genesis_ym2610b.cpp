// The same pinned ymfm OPNB core as Browser/WASM, with its output-rate adapter.
#include "native_genesis_ym2610b.h"
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
constexpr uint32_t ROM_SIZE = 0x1000000, PAGE_SIZE = 0x10000, PAGE_COUNT = ROM_SIZE / PAGE_SIZE;
struct Interface : ymfm_wasm_interface {
    const bool sparse;
    // Primary mode retains its original dense banks. Additional instances use
    // externally owned, immutable 64 KiB versions prepared on control.
    std::vector<uint8_t> rom[2];
    std::array<std::array<uint8_t *, PAGE_COUNT>, 2> pages{};
    explicit Interface(bool extra) : sparse(extra) {
        if (!sparse) for (auto &bank : rom) bank.resize(ROM_SIZE, 0);
    }
    uint8_t ymfm_external_read(ymfm::access_class type, uint32_t address) override {
        if ((type != ymfm::ACCESS_ADPCM_A && type != ymfm::ACCESS_ADPCM_B) || address >= ROM_SIZE) return 0;
        const uint8_t bank = type == ymfm::ACCESS_ADPCM_B ? 1 : 0;
        if (!sparse) return rom[bank][address];
        const auto *page = pages[bank][address / PAGE_SIZE];
        return page ? page[address % PAGE_SIZE] : 0;
    }
    int transfer(uint8_t type, const uint8_t *bytes, uint32_t offset, uint32_t size) {
        if (type > 1 || offset > ROM_SIZE || size > ROM_SIZE - offset || (size && !bytes)) return 0;
        if (!sparse) { if (size) std::memcpy(rom[type].data() + offset, bytes, size); return 1; }
        // Additional pages are immutable versions prepared on control. Audio
        // commands publish pointers only; they never copy multi-MiB payloads.
        return size == 0 ? 1 : 0;
    }
    int copy(uint8_t type, uint8_t *bytes, uint32_t offset, uint32_t size) const {
        if (type > 1 || offset > ROM_SIZE || size > ROM_SIZE - offset || (size && !bytes)) return 0;
        if (!sparse) { if (size) std::memcpy(bytes, rom[type].data() + offset, size); return 1; }
        while (size) {
            const uint32_t count = std::min(size, PAGE_SIZE - offset % PAGE_SIZE);
            const auto *page = pages[type][offset / PAGE_SIZE];
            if (page) std::memcpy(bytes, page + offset % PAGE_SIZE, count); else std::memset(bytes, 0, count);
            offset += count; bytes += count; size -= count;
        }
        return 1;
    }
    void clear(uint8_t type) {
        if (type > 1) return;
        if (!sparse) std::fill(rom[type].begin(), rom[type].end(), 0);
        else pages[type].fill(nullptr);
    }
};
struct Chip : ymfm::ym2610 {
    Chip(Interface &intf, bool variant) : ym2610(intf, variant ? 0x3f : 0x36) {}
    // Both YM2610 status reads are observational (unlike OPNA's status_hi).
    void clear_output_history() { m_last_fm.clear(); }
    bool next_fm_clock() const { return m_ssg_resampler.sampindex() % m_fm_samples_per_output == 0; }
    void clear_csm_key() {
        const auto *channel = m_fm.debug_channel(2);
        for (uint32_t op = 0; op < 4; ++op) channel->debug_operator(op)->keyonoff(0, ymfm::KEYON_CSM);
        m_fm.invalidate_caches();
    }
    std::array<fm_engine::output_data, 6> held_fm{};
    fm_engine::output_data held_adpcm{};
    int32_t held_ssg = 0;
    void remix_history() {
        m_last_fm.clear();
        for (const auto &ch : held_fm) for (uint32_t bus = 0; bus < 2; ++bus) m_last_fm.data[bus] += ch.data[bus];
        for (uint32_t bus = 0; bus < 2; ++bus) m_last_fm.data[bus] += held_adpcm.data[bus];
        m_last_fm.clamp16();
    }
    void silence_fm(uint8_t ch) { held_fm[ch].clear(); remix_history(); }
    void held_output(output_data &out) const { out.data[0] = m_last_fm.data[0]; out.data[1] = m_last_fm.data[1]; out.data[2] = held_ssg; }
    void generate_extra(output_data *out, uint32_t mask) {
        if (next_fm_clock()) {
            const uint32_t envelope = m_fm.clock(m_fm_mask);
            if ((envelope & 3) == 0) m_eos_status |= m_adpcm_a.clock(0x3f);
            m_adpcm_b.clock();
            const uint8_t eos = (m_adpcm_b.status() & ymfm::adpcm_b_channel::STATUS_EOS) ? 0x40 : 0;
            if ((eos ^ m_eos_status) & 0x40) m_eos_status = (m_eos_status & ~0xc0) | eos | (eos << 1);
            for (uint32_t ch = 0; ch < 6; ++ch) {
                auto &value = held_fm[ch]; value.clear();
                if (m_fm_mask & (1u << ch)) m_fm.output(value, 1, 32767, 1u << ch);
                if (mask & (1u << ch)) value.clear();
            }
            held_adpcm.clear();
            if (!m_adpcm_a_muted) m_adpcm_a.output(held_adpcm, 0x3f);
            if (!m_adpcm_b_muted) m_adpcm_b.output(held_adpcm, 1);
            remix_history();
        }
        out->data[0] = m_last_fm.data[0]; out->data[1] = m_last_fm.data[1];
        m_ssg_resampler.resample(out, 1); held_ssg = out->data[2];
    }
};
struct NativeYm2610B {
    Interface intf;
    Chip chip;
    uint32_t output_rate, clock = 8000000, source_mute_mask = 0;
    const bool variant, additional;
    uint32_t forced_mask = 0, pending = 0;
    bool stopped = false;
    std::array<uint8_t, 6> keys{}, pending_keys{};
    std::array<uint8_t, 3> ssg_levels{};
    uint64_t remainder = 0;
    double last_left = 0, last_right = 0;
    std::array<uint8_t, 512> registers{};
    std::array<bool, 512> written{};
    std::array<uint8_t, 2> frequency_latch{};

    NativeYm2610B(uint32_t rate, bool full, bool extra = false) : intf(extra), chip(intf, full), output_rate(rate), variant(full), additional(extra) { reset(); }
    void reset() {
        chip.reset();
        remainder = 0; last_left = last_right = 0;
        registers.fill(0); written.fill(false); frequency_latch.fill(0);
        forced_mask = pending = 0; stopped = false; keys.fill(0); pending_keys.fill(0); ssg_levels.fill(0);
        for (auto reg : {0xb4, 0xb5, 0xb6, 0x1b4, 0x1b5, 0x1b6}) registers[reg] = 0xc0;
        for (uint32_t reg = 0x108; reg <= 0x10d; ++reg) registers[reg] = 0xdf;
        registers[0x1c] = 0;
        chip.set_adpcm_mute((source_mute_mask & 2) != 0, (source_mute_mask & 4) != 0);
    }
    void raw(uint8_t port, uint8_t reg, uint8_t value) { chip.write(port * 2, reg); chip.write(port * 2 + 1, value); }
    void restore(uint8_t ch) {
        if (!(forced_mask & (1u << ch))) return;
        forced_mask &= ~(1u << ch);
        for (uint8_t op = 0; op < 4; ++op) { const uint8_t reg = 0x40 + ch % 3 + op * 4; raw(ch / 3, reg, registers[(ch / 3) * 256 + reg]); }
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
        } else {
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
            if (!port && reg >= 8 && reg <= 10) { if (author && (value & 31)) ssg_levels[reg - 8] = value & 31; if (value & 31) stopped = false; }
            if ((port && !reg && !(value & 0x80) && (value & 63)) || (!port && reg == 0x10 && (value & 0xc1) == 0x80)) stopped = false;
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
                for (uint8_t op = 0; op < 4; ++op) { const uint8_t reg = 0x40 + voice % 3 + op * 4; raw(voice / 3, reg, registers[(voice / 3) * 256 + reg] | 127); }
                if (voice == 2) write(0, 0x27, registers[0x27] & ~0x81);
                chip.silence_fm(voice);
                if (chip.sample_rate(clock) < output_rate) { Chip::output_data held; chip.held_output(held); const int32_t ssg = source_mute_mask & 1 ? 0 : held.data[2]; last_left = normalize(held.data[0] + ssg); last_right = normalize(held.data[1] + ssg); }
            }
        }
        else if (voice < 9) write(0, 8 + voice - 6, 0, false);
        else if (voice < 15) write(1, 0, 0x80 | (1 << (voice - 9)));
        else if (voice == 15) write(0, 0x10, 1);
    }
    void key_off_fm(uint8_t ch) { if (ch == 2 && (registers[0x27] & 0x81) == 0x81) write(0, 0x28, 2); else key_off(ch); }
    void cancel_csm() { write(0, 0x27, registers[0x27] & ~0x81); chip.clear_csm_key(); if (!keys[2] && !(pending & 4)) key_off(2); }
    void audition_fm(uint8_t ch, uint8_t mask) {
        if (ch >= 6 || !((variant ? 0x3f : 0x36) & (1u << ch)) || mask >= 16) return;
        key_off(ch); if (mask) { pending_keys[ch] = mask; pending |= 1u << ch; }
    }
    void stop() {
        if (additional) { for (uint8_t ch = 0; ch < 16; ++ch) key_off(ch); write(0, 0x27, registers[0x27] & 0xc0); stopped = true; last_left = last_right = 0; return; }
        const auto saved = registers;
        const auto valid = written;
        const auto saved_latch = frequency_latch;
        reset(); chip.clear_output_history();
        for (uint32_t index = 0; index < 512; ++index) {
            if (!valid[index]) continue;
            const uint8_t port = index >> 8, reg = index & 255;
            if ((reg >= 0xa0 && reg <= 0xaf) || index == 0x10 || index == 0x18 || index == 0x28 ||
                index == 0x100 || (index >= 8 && index <= 10)) continue;
            uint8_t value = saved[index];
            if (index == 0x27) value &= 0xc0; // Stop timers/CSM triggers.
            write(port, reg, value);
        }
        for (uint8_t port = 0; port < 2; ++port)
            for (uint8_t base : {0xa0, 0xa8}) for (uint8_t ch = 0; ch < 3; ++ch) {
                const uint8_t low = base + ch, high = low + 4;
                if (valid[port * 256 + high]) write(port, high, saved[port * 256 + high]);
                if (valid[port * 256 + low]) write(port, low, saved[port * 256 + low]);
            }
        write(0, 0xa4, saved_latch[0]); write(0, 0xac, saved_latch[1]);
        // Explicitly stop all non-FM sections; their ROM ranges and pitch remain.
        for (uint8_t voice = 6; voice < 16; ++voice) key_off(voice);
    }
    static float normalize(int32_t value) {
        return static_cast<float>(std::max(-32768, std::min(32767, value))) / 32768.0f;
    }
    void sample(float *left, float *right) {
        // Match Ym2610BAudioEngine exactly: normalize/clamp each native sample,
        // then average in double precision, holding the prior value on upsample.
        remainder += chip.sample_rate(clock);
        const uint32_t count = static_cast<uint32_t>(remainder / output_rate);
        remainder -= static_cast<uint64_t>(count) * output_rate;
        bool fm_clock = false;
        if (count) {
            double l = 0, r = 0;
            for (uint32_t n = 0; n < count; ++n) {
                Chip::output_data output;
                fm_clock |= additional && chip.next_fm_clock();
                if (additional) chip.generate_extra(&output, forced_mask); else chip.generate(&output);
                intf.advance_sample(chip);
                const int32_t ssg = source_mute_mask & 1 ? 0 : output.data[2];
                l += normalize(output.data[0] + ssg); r += normalize(output.data[1] + ssg);
            }
            last_left = l / count; last_right = r / count;
        }
        *left = stopped ? 0 : static_cast<float>(last_left); *right = stopped ? 0 : static_cast<float>(last_right);
        if (fm_clock && pending) { const uint32_t starts = pending; pending = 0; for (uint8_t ch = 0; ch < 6; ++ch) if (starts & (1u << ch)) write(0, 0x28, (pending_keys[ch] << 4) | (ch < 3 ? ch : ch + 1)); }
    }
};
NativeYm2610B *core(void *ptr) { return static_cast<NativeYm2610B *>(ptr); }

}
extern "C" {
void *native_ym2610b_create(uint32_t rate, uint8_t variant) {
    if (rate < 8000 || rate > 384000 || variant > 1) return nullptr;
    try { return new NativeYm2610B(rate, variant != 0); } catch (...) { return nullptr; }
}
void *native_ym2610b_create_extra_variant(uint32_t rate, uint8_t variant) {
    if (rate < 8000 || rate > 384000 || variant > 1) return nullptr;
    try { return new NativeYm2610B(rate, variant != 0, true); } catch (...) { return nullptr; }
}
void *native_ym2610b_create_extra(uint32_t rate) {
    return native_ym2610b_create_extra_variant(rate, 0);
}
void *native_ym2610b_alloc_rom_page() { try { return new uint8_t[PAGE_SIZE](); } catch (...) { return nullptr; } }
void native_ym2610b_free_rom_page(void *page) { delete[] static_cast<uint8_t *>(page); }
int native_ym2610b_install_rom_page(void *ptr, uint8_t type, uint16_t index, void *page) {
    auto &intf = core(ptr)->intf;
    if (!intf.sparse || type > 1 || index >= PAGE_COUNT || !page) return 0;
    auto &target = intf.pages[type][index];
    target = static_cast<uint8_t *>(page); return 1;
}
void native_ym2610b_destroy(void *ptr) { delete core(ptr); }
void native_ym2610b_reset(void *ptr) { core(ptr)->reset(); }
void native_ym2610b_stop(void *ptr) { core(ptr)->stop(); }
void native_ym2610b_key_off(void *ptr, uint8_t voice) { core(ptr)->key_off(voice); }
void native_ym2610b_key_off_fm(void *ptr, uint8_t ch) { core(ptr)->key_off_fm(ch); }
void native_ym2610b_cancel_csm(void *ptr) { core(ptr)->cancel_csm(); }
void native_ym2610b_audition_fm_key_on(void *ptr, uint8_t ch, uint8_t mask) { core(ptr)->audition_fm(ch, mask); }
void native_ym2610b_set_retained_ssg_level(void *ptr, uint8_t ch, uint8_t level) { if (ch < 3 && level < 32) core(ptr)->ssg_levels[ch] = level; }
void native_ym2610b_write(void *ptr, uint8_t port, uint8_t reg, uint8_t value) { core(ptr)->write(port, reg, value); }
void native_ym2610b_sample(void *ptr, float *left, float *right) { core(ptr)->sample(left, right); }
int native_ym2610b_set_clock(void *ptr, uint32_t clock) {
    if (clock < 100000 || clock > 100000000) return 0;
    core(ptr)->clock = clock; return 1;
}
void native_ym2610b_set_source_mute_mask(void *ptr, uint32_t mask) {
    auto *h = core(ptr); h->source_mute_mask = mask & 7;
    h->chip.set_adpcm_mute((mask & 2) != 0, (mask & 4) != 0);
}
int native_ym2610b_load_rom(void *ptr, uint8_t type, const uint8_t *bytes, uint32_t offset, uint32_t size) { return core(ptr)->intf.transfer(type, bytes, offset, size); }
void native_ym2610b_clear_rom(void *ptr, uint8_t type) { core(ptr)->intf.clear(type); }
int native_ym2610b_copy_rom(void *ptr, uint8_t type, uint8_t *bytes, uint32_t offset, uint32_t size) { return core(ptr)->intf.copy(type, bytes, offset, size); }
uint8_t native_ym2610b_read(void *ptr, uint8_t offset) { return core(ptr)->chip.read(offset); }
uint8_t native_ym2610b_read_status(void *ptr) { return core(ptr)->chip.read_status(); }
uint8_t native_ym2610b_read_status_hi(void *ptr) { return core(ptr)->chip.read_status_hi(); }
uint8_t native_ym2610b_get_irq(void *ptr) { return core(ptr)->intf.irq_asserted ? 1 : 0; }
void native_ym2610b_get_state(void *ptr, NativeYm2610BState *state) {
    auto *h = core(ptr);
    std::memcpy(state->registers, h->registers.data(), h->registers.size());
    state->clock = h->clock; state->source_mute_mask = h->source_mute_mask;
    state->status = h->chip.read_status(); state->status_hi = h->chip.read_status_hi();
    state->irq = h->intf.irq_asserted ? 1 : 0; state->variant = h->variant ? 1 : 0;
}
void native_ym2610b_get_extra_state(void *ptr, NativeYm2610BExtraState *state) {
    auto *h = core(ptr); std::memcpy(state->registers, h->registers.data(), 512);
    state->clock = h->clock; state->source_mute_mask = h->source_mute_mask;
    std::memcpy(state->keys, h->keys.data(), 6); std::memcpy(state->ssg_levels, h->ssg_levels.data(), 3);
    state->status = h->chip.read_status(); state->status_hi = h->chip.read_status_hi();
    state->irq = h->intf.irq_asserted ? 1 : 0; state->variant = h->variant ? 1 : 0;
}

}
