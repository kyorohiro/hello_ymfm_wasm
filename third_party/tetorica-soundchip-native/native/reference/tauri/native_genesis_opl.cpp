// Native OPL renderer for DOS PC / MSX Audio. Exact shared Browser ymfm provider.
#include "native_genesis_opl.h"
#include "ymfm_opl.h"
#include "native_genesis_y8950_memory.h"
#include <algorithm>
#include <array>
#include <cstring>

namespace {
constexpr uint8_t SLOTS[9] = {0, 1, 2, 8, 9, 10, 16, 17, 18};
constexpr uint8_t PAIRS[6] = {0, 1, 2, 9, 10, 11};
float normalize(int32_t value) { return float(std::max(-32768, std::min(32767, value))) / 32768.0f; }
template<class Chip> void output_sample(const typename Chip::output_data &output, float &l, float &r) {
    l = r = normalize(output.data[0]);
}
template<> void output_sample<ymfm::ymf262>(const ymfm::ymf262::output_data &output, float &l, float &r) {
    l = normalize(output.data[0] + output.data[2]);
    r = normalize(output.data[1] + output.data[3]);
}
// Same y8950::generate ordering and truncation, with the last FM-only
// contribution retained so stopping ADPCM never drops a held FM sample.
struct Y8950 : ymfm::y8950 {
    output_data held_fm{};
    explicit Y8950(ymfm_wasm_interface &intf) : y8950(intf) {}
    void generate(output_data *output, uint32_t count=1) {
        for(uint32_t n=0;n<count;++n,++output) {
            m_fm.clock(fm_engine::ALL_CHANNELS); m_adpcm_b.clock();
            m_fm.output(output->clear(),1,32767,fm_engine::ALL_CHANNELS & ~m_mute_mask);
            output_data discarded; m_fm.output(discarded.clear(),1,32767,fm_engine::ALL_CHANNELS & m_mute_mask);
            held_fm = *output;
            if(!(m_mute_mask & 0x200)) m_adpcm_b.output(*output,3);
            output->roundtrip_fp();
        }
    }
};
template<class Chip> void restore_fm_hold(Chip &, double &, double &) {}
void restore_fm_hold(Y8950 &chip, double &left, double &right) {
    auto output = chip.held_fm; output.roundtrip_fp(); left = right = normalize(output.data[0]);
}
struct OplBase {
    virtual ~OplBase() = default;
    virtual uint64_t memory_upload_revision() const = 0;
    virtual uint64_t memory_revision() const = 0;
    virtual void memory_page(uint32_t,uint8_t*) = 0;
    virtual void memory_length(uint32_t) = 0;
    virtual void cancel_adpcm() = 0;
    virtual void reset() = 0;
    virtual void stop() = 0;
    virtual void write(uint16_t, uint8_t) = 0;
    virtual void off(uint8_t) = 0;
    virtual void audition(uint8_t) = 0;
    virtual void sample(float *, float *) = 0;
    virtual int set_clock(uint32_t) = 0;
    virtual void mute(uint32_t) = 0;
    virtual uint8_t read(uint8_t) = 0;
    virtual uint8_t status() = 0;
    virtual uint8_t irq() const = 0;
    virtual void state(NativeOplState *) = 0;
};
template<class Chip> struct NativeOpl final : OplBase {
    NativeY8950Memory intf;
    Chip chip;
    const uint32_t output_rate;
    const uint8_t kind, channels;
    uint32_t clock, external_mute = 0, forced_mute, pending = 0;
    uint64_t remainder = 0;
    double left = 0, right = 0;
    bool silent = true;
    std::array<uint8_t, 512> registers{};
    NativeOpl(uint32_t sr, uint8_t type) : chip(intf), output_rate(sr), kind(type),
        channels(type == 2 ? 18 : 9), clock(type == 2 ? 14318180 : 3579545), forced_mute((1u << channels) - 1) {
        chip.reset(); update_mute();
    }
    uint32_t all_channels() const { return (1u << channels) - 1; }
    void update_mute() { chip.set_mute_mask(external_mute | forced_mute); }
    void raw(uint16_t reg, uint8_t value) {
        chip.write((reg >> 8) * 2, uint8_t(reg)); chip.write((reg >> 8) * 2 + 1, value);
    }
    uint8_t paired(uint8_t channel) const {
        for (uint8_t i = 0; i < 6; ++i) if (PAIRS[i] == channel && (registers[0x104] & (1 << i))) return channel + 3;
        return channel;
    }
    int operator_channel(uint16_t reg) const {
        const uint8_t slot = reg & 31;
        for (uint8_t ch = 0; ch < 9; ++ch) if (slot == SLOTS[ch] || slot == SLOTS[ch] + 3) return (reg >> 8) * 9 + ch;
        return -1;
    }
    void restore_one(uint8_t ch) {
        if (forced_mute & (1u << ch)) {
            forced_mute &= ~(1u << ch);
            const uint16_t bank = ch >= 9 ? 0x100 : 0;
            for (uint8_t slot : {SLOTS[ch % 9], uint8_t(SLOTS[ch % 9] + 3)}) raw(bank + 0x40 + slot, registers[bank + 0x40 + slot]);
        }
    }
    void restore(uint8_t ch) { restore_one(ch); restore_one(paired(ch)); update_mute(); }
    uint64_t memory_upload_revision() const override { return kind==3?intf.memory_upload_revision:0; }
    uint64_t memory_revision() const override { return kind==3?intf.memory_revision:0; }
    void memory_page(uint32_t i, uint8_t *p) override { if(kind==3)intf.memory_page(i,p); }
    void memory_length(uint32_t n) override { if(kind==3)intf.memory_length(n); }
    void cancel_adpcm() override { if(kind==3){write(7,1);if(chip.sample_rate(clock)<output_rate)restore_fm_hold(chip,left,right);} }
    void write(uint16_t reg, uint8_t value) override {
        if (reg >= (kind == 2 ? 512 : 256)) return;
        const uint8_t low = uint8_t(reg), bank = reg >> 8;
        registers[reg] = value;
        if(kind==3&&reg==7&&(value&128)&&!(value&1))silent=false;
        if (low >= 0xb0 && low <= 0xb8) {
            const uint8_t ch = bank * 9 + low - 0xb0;
            pending &= ~(1u << ch);
            if (value & 32) { restore(ch); silent = false; }
        }
        if (reg == 0xbd) {
            // Gate writes replace any preview still waiting for a source interval.
            pending &= (1u << 18) - 1;
            if (value & 31) { for (uint8_t ch = 6; ch < 9; ++ch) restore(ch); silent = false; }
        }
        const int ch = low >= 0x40 && low <= 0x55 ? operator_channel(reg) : -1;
        raw(reg, ch >= 0 && (forced_mute & (1u << ch)) ? uint8_t((value & 192) | 63) : value);
    }
    void off_one(uint8_t ch) {
        pending &= ~(1u << ch);
        const uint16_t bank = ch >= 9 ? 0x100 : 0, reg = bank + 0xb0 + ch % 9;
        registers[reg] &= 223; raw(reg, registers[reg]); forced_mute |= 1u << ch;
        for (uint8_t slot : {SLOTS[ch % 9], uint8_t(SLOTS[ch % 9] + 3)}) raw(bank + 0x40 + slot, uint8_t((registers[bank + 0x40 + slot] & 192) | 63));
    }
    void off(uint8_t voice) override {
        if(kind==3&&voice==23){write(7,(registers[7]&16)|1);return;}
        if (voice < channels) { const uint8_t pair = paired(voice); off_one(voice); if (pair != voice) off_one(pair); update_mute(); }
        else if (voice >= 18 && voice < 23) {
            pending &= ~(1u << voice); const uint8_t value = registers[0xbd] & ~(16 >> (voice - 18));
            registers[0xbd] = value; raw(0xbd, value);
        }
    }
    void audition(uint8_t voice) override {
        if(kind==3&&voice==23){const uint8_t repeat=registers[7]&16;write(7,repeat|1);write(7,0xa0|repeat);return;}
        if (voice >= channels && !(voice >= 18 && voice < 23)) return;
        off(voice); pending |= 1u << voice;
    }
    void stop() override {
        cancel_adpcm(); pending = 0; for (uint8_t ch = 0; ch < channels; ++ch) off(ch);
        registers[0xbd] &= 224; raw(0xbd, registers[0xbd]);
        silent = true; left = right = 0;
    }
    void reset() override {
        chip.reset(); intf.irq_asserted = false; intf.timer_remaining[0] = intf.timer_remaining[1] = -1;
        registers.fill(0); forced_mute = all_channels(); update_mute();
        pending = 0; remainder = 0; left = right = 0; silent = true;
    }
    void sample(float *l, float *r) override {
        remainder += chip.sample_rate(clock); const uint32_t count = uint32_t(remainder / output_rate); remainder -= uint64_t(count) * output_rate;
        if (count) {
            double sum_l = 0, sum_r = 0;
            for (uint32_t i = 0; i < count; ++i) {
                typename Chip::output_data output; chip.generate(&output); intf.advance_sample(chip);
                float a, b; output_sample<Chip>(output, a, b); sum_l += a; sum_r += b;
            }
            left = sum_l / count; right = sum_r / count;
        }
        *l = silent ? 0 : float(left); *r = silent ? 0 : float(right);
        // At least one ordinary chip interval sees key-off before retrigger.
        if (count && pending) {
            const uint32_t starts = pending; pending = 0;
            for (uint8_t i = 0; i < channels; ++i) if (starts & (1u << i)) {
                const uint16_t reg = (i >= 9 ? 0x100 : 0) + 0xb0 + i % 9; write(reg, registers[reg] | 32);
            }
            uint8_t drums = 0;
            for (uint8_t i = 18; i < 23; ++i) if (starts & (1u << i)) drums |= 16 >> (i - 18);
            if (drums && (registers[0xbd] & 32)) write(0xbd, registers[0xbd] | drums);
        }
    }
    int set_clock(uint32_t value) override { if (value < 100000 || value > 100000000) return 0; clock = value; return 1; }
    void mute(uint32_t mask) override { external_mute = mask & all_channels(); update_mute(); left = right = 0; }
    uint8_t read(uint8_t offset) override { return chip.read(offset); }
    uint8_t status() override { return chip.read_status(); }
    uint8_t irq() const override { return intf.irq_asserted ? 1 : 0; }
    void state(NativeOplState *s) override {
        std::memcpy(s->registers, registers.data(), registers.size()); s->clock = clock; s->mute_mask = external_mute;
        s->kind = kind; s->channels = channels; s->status = status(); s->irq = irq();
    }
};
OplBase *core(void *p) { return static_cast<OplBase *>(p); }
}
extern "C" {
void *native_opl_create(uint32_t rate, uint8_t kind) {
    if (rate < 8000 || rate > 384000) return nullptr;
    try {
        if (kind == 0) return new NativeOpl<ymfm::ym3526>(rate, kind);
        if (kind == 1) return new NativeOpl<ymfm::ym3812>(rate, kind);
        if (kind == 2) return new NativeOpl<ymfm::ymf262>(rate, kind);
        // Empty ADPCM RAM and I/O use the interface's zero read / no-op write
        // defaults, exactly like the shipped Y8950 WASM before loading memory.
        if (kind == 3) return new NativeOpl<Y8950>(rate, kind);
    } catch (...) {}
    return nullptr;
}
void native_opl_destroy(void *p) { delete core(p); }
uint64_t native_opl_memory_upload_revision(void*p){return core(p)->memory_upload_revision();}
uint64_t native_opl_memory_revision(void*p){return core(p)->memory_revision();}
void native_opl_memory_page(void*p,uint32_t index,uint8_t*page){core(p)->memory_page(index,page);}
void native_opl_memory_length(void*p,uint32_t size){core(p)->memory_length(size);}
void native_opl_cancel_adpcm(void*p){core(p)->cancel_adpcm();}
void native_opl_reset(void *p) { core(p)->reset(); }
void native_opl_stop(void *p) { core(p)->stop(); }
void native_opl_write(void *p, uint16_t reg, uint8_t value) { core(p)->write(reg, value); }
void native_opl_key_off(void *p, uint8_t voice) { core(p)->off(voice); }
void native_opl_audition_key_on(void *p, uint8_t voice) { core(p)->audition(voice); }
void native_opl_sample(void *p, float *l, float *r) { core(p)->sample(l, r); }
int native_opl_set_clock(void *p, uint32_t clock) { return core(p)->set_clock(clock); }
void native_opl_set_mute_mask(void *p, uint32_t mask) { core(p)->mute(mask); }
uint8_t native_opl_read(void *p, uint8_t offset) { return core(p)->read(offset); }
uint8_t native_opl_read_status(void *p) { return core(p)->status(); }
uint8_t native_opl_get_irq(void *p) { return core(p)->irq(); }
void native_opl_get_state(void *p, NativeOplState *s) { core(p)->state(s); }
}
