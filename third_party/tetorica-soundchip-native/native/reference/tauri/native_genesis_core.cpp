#include <algorithm>
#include <array>
#include <cstdint>
#include <new>

extern "C" {
void *ym2612_create();
void ym2612_destroy(void *);
void ym2612_reset(void *);
void ym2612_write(void *, uint32_t, uint8_t);
uint32_t ym2612_sample_rate(void *, uint32_t);
void ym2612_generate(void *, float *, float *, uint32_t);
uint8_t ym2612_read(void *, uint32_t);
uint8_t ym2612_read_status(void *);
uint8_t ym2612_get_irq(void *);
void *tetorica_nuked_create();
void tetorica_nuked_destroy(void *);
void tetorica_nuked_reset(void *);
void tetorica_nuked_write(void *, uint32_t, uint8_t);
uint32_t tetorica_nuked_sample_rate(void *, uint32_t);
void tetorica_nuked_generate(void *, float *, float *, uint32_t);
uint8_t tetorica_nuked_read(void *, uint32_t);
uint8_t tetorica_nuked_read_status(void *);
uint8_t tetorica_nuked_get_irq(void *);
void *segapsg_create(uint32_t, uint32_t);
void segapsg_destroy(void *);
void segapsg_reset(void *);
void segapsg_write(void *, uint8_t);
void segapsg_set_stereo(void *, uint8_t);
void segapsg_generate(void *, float *, float *, uint32_t);
}

namespace {
constexpr uint32_t YM_CLOCK = 7670454;
constexpr uint32_t PSG_CLOCK = 3579545;
struct FmApi {
    void *(*create)();
    void (*destroy)(void *);
    void (*reset)(void *);
    void (*write)(void *, uint32_t, uint8_t);
    uint32_t (*sample_rate)(void *, uint32_t);
    void (*generate)(void *, float *, float *, uint32_t);
    uint8_t (*read)(void *, uint32_t);
    uint8_t (*read_status)(void *);
    uint8_t (*get_irq)(void *);
};
const FmApi YMFM{ym2612_create, ym2612_destroy, ym2612_reset, ym2612_write, ym2612_sample_rate, ym2612_generate, ym2612_read, ym2612_read_status, ym2612_get_irq};
const FmApi NUKED{tetorica_nuked_create, tetorica_nuked_destroy, tetorica_nuked_reset, tetorica_nuked_write, tetorica_nuked_sample_rate, tetorica_nuked_generate, tetorica_nuked_read, tetorica_nuked_read_status, tetorica_nuked_get_irq};
struct NativeGenesis {
    const bool nuked;
    const FmApi &fm;
    void *ym = nullptr;
    void *psg = nullptr;
    uint32_t output_rate;
    uint32_t chip_rate;
    uint64_t remainder = 0;
    float fm_left = 0, fm_right = 0, psg_left = 0, psg_right = 0;
    float idle_left = 0, idle_right = 0;
    double nuked_left = 0, nuked_right = 0, nuked_psg_left = 0, nuked_psg_right = 0;
    std::array<double, 5> nuked_current{{1, 1, 1, 1, 1}}, nuked_target{{1, 1, 1, 1, 1}};
    std::array<uint32_t, 3> nuked_ramp{};
    bool voices_stopped = false;
    std::array<float, 5> current{{1, 1, 1, 1, 1}};
    std::array<float, 5> target{{1, 1, 1, 1, 1}};
    uint32_t ramp = 0;
    std::array<std::array<uint8_t, 256>, 2> registers{};
    std::array<std::array<bool, 256>, 2> written{};
    std::array<uint8_t, 2> frequency_latch{};
    std::array<uint16_t, 3> periods{};
    std::array<uint8_t, 4> attenuation{{15,15,15,15}};
    uint8_t psg_latch = 0, noise = 0, stereo = 0xff;

    explicit NativeGenesis(uint32_t rate, bool use_nuked = false) : nuked(use_nuked), fm(use_nuked ? NUKED : YMFM), output_rate(rate) {
        ym = fm.create();
        if (!ym) throw std::bad_alloc();
        chip_rate = fm.sample_rate(ym, YM_CLOCK);
        try { psg = segapsg_create(chip_rate, PSG_CLOCK); }
        catch (...) { fm.destroy(ym); ym = nullptr; throw; }
        if (!psg) { fm.destroy(ym); ym = nullptr; throw std::bad_alloc(); }
        // ymfm keeps its existing centering. The deployed Nuked Worklet emits
        // the YM2612 ladder DC unchanged and does not consume a calibration frame.
        if (!nuked) fm.generate(ym, &idle_left, &idle_right, 1);
        reset();
    }
    ~NativeGenesis() {
        if (ym) fm.destroy(ym);
        if (psg) segapsg_destroy(psg);
    }
    void reset() {
        fm.reset(ym);
        segapsg_reset(psg);
        remainder = 0;
        fm_left = fm_right = psg_left = psg_right = 0;
        nuked_left = nuked_right = nuked_psg_left = nuked_psg_right = 0;
        voices_stopped = false;
        registers = {};
        written = {};
        frequency_latch = {};
        periods = {};
        attenuation.fill(15);
        psg_latch = noise = 0;
        stereo = 0xff;
    }
    void write(uint8_t port, uint8_t reg, uint8_t value) {
        if (port > 1) return;
        if (nuked && port == 0 && ((reg == 0x28 && (value & 0xf0) && (value & 3) < 3) || (reg == 0x2b && (value & 0x80)) ||
            (reg == 0x2a && (registers[0][0x2b] & 0x80)) || (reg == 0x27 && (value & 0xc1) == 0x81))) voices_stopped = false;
        if ((reg & 0xf0) == 0xa0) {
            if ((reg & 3) != 3) {
                // ymfm shares normal/special high-frequency latches across
                // both ports. Record the committed pair, not just last writes.
                auto &latch = frequency_latch[(reg >> 3) & 1];
                if (reg & 4) latch = value & 0x3f;
                else {
                    registers[port][reg] = value;
                    registers[port][reg | 4] = latch;
                    written[port][reg] = written[port][reg | 4] = true;
                }
            }
        } else {
            registers[port][reg] = value;
            written[port][reg] = true;
        }
        fm.write(ym, port * 2, reg);
        fm.write(ym, port * 2 + 1, value);
    }
    void psg_write(uint8_t value) {
        if (value & 0x80) psg_latch = value & 0x70;
        const uint8_t channel = psg_latch >> 5;
        if (nuked && (psg_latch & 0x10) && (value & 15) != 15) voices_stopped = false;
        if (psg_latch & 0x10) attenuation[channel] = value & 15;
        if (!(psg_latch & 0x10)) {
            if (channel == 3) noise = value & 7;
            else if (value & 0x80) periods[channel] = (periods[channel] & 0x3f0) | (value & 15);
            else periods[channel] = (periods[channel] & 15) | ((value & 63) << 4);
        }
        segapsg_write(psg, value);
    }
    void psg_mute(uint8_t channel) {
        const uint8_t saved = psg_latch;
        psg_write(0x9f | (channel << 5));
        const uint8_t original_channel = saved >> 5;
        const uint8_t value = (saved & 0x10) ? attenuation[original_channel] : original_channel == 3 ? noise : periods[original_channel] & 15;
        psg_write(0x80 | saved | value);
    }
    void stop() {
        // Stop removes voices and phase history but preserves the authored raw
        // patch. Restore each frequency high/low pair in latch-safe order.
        const auto saved = registers;
        const auto valid = written;
        const auto saved_latch = frequency_latch;
        const auto saved_periods = periods;
        const uint8_t saved_noise = noise, saved_stereo = stereo;
        reset();
        for (uint8_t port = 0; port < 2; ++port) {
            for (uint32_t reg = 0; reg < 256; ++reg) {
                if (!valid[port][reg] || (reg >= 0xa0 && reg <= 0xaf)) continue;
                if (port == 0 && (reg == 0x28 || reg == 0x2a)) continue;
                const uint8_t value = (port == 0 && reg == 0x27) ? saved[port][reg] & 0xc0 : (port == 0 && reg == 0x2b) ? saved[port][reg] & 0x7f : saved[port][reg];
                write(port, static_cast<uint8_t>(reg), value);
            }
            for (uint8_t base : {0xa0, 0xa8}) for (uint8_t channel = 0; channel < 3; ++channel) {
                const uint8_t low = base + channel, high = low + 4;
                if (valid[port][high]) write(port, high, saved[port][high]);
                if (valid[port][low]) write(port, low, saved[port][low]);
            }
        }
        write(0, 0xa4, saved_latch[0]);
        write(0, 0xac, saved_latch[1]);
        for (uint8_t channel = 0; channel < 3; ++channel) {
            psg_write(0x80 | (channel << 5) | (saved_periods[channel] & 15));
            psg_write(saved_periods[channel] >> 4);
        }
        psg_write(0xe0 | saved_noise);
        for (uint8_t channel = 0; channel < 4; ++channel) psg_write(0x9f | (channel << 5));
        // Playground's authoring-side PSG reset returns to tone latch CH1.
        psg_write(0x80 | (saved_periods[0] & 15));
        stereo = saved_stereo;
        segapsg_set_stereo(psg, stereo);
        if (nuked) voices_stopped = true;
    }
    void sample_nuked(float *output) {
        for (size_t source = 0; source < nuked_ramp.size(); ++source) {
            auto &remaining = nuked_ramp[source];
            if (!remaining) continue;
            const size_t begin = source * 2, end = std::min(begin + 2, nuked_current.size());
            for (size_t i = begin; i < end; ++i)
                nuked_current[i] += (nuked_target[i] - nuked_current[i]) / remaining;
            --remaining;
        }
        remainder += chip_rate;
        const uint32_t count = static_cast<uint32_t>(remainder / output_rate);
        remainder -= static_cast<uint64_t>(count) * output_rate;
        if (count) {
            double fl = 0, fr = 0, pl = 0, pr = 0;
            for (uint32_t i = 0; i < count; ++i) {
                float l, r; fm.generate(ym, &l, &r, 1);
                fl += double(l) * nuked_current[0]; fr += double(r) * nuked_current[1];
                segapsg_generate(psg, &l, &r, 1); pl += l; pr += r;
            }
            nuked_left = fl / count; nuked_right = fr / count;
            nuked_psg_left = pl / count; nuked_psg_right = pr / count;
        }
        output[0] = voices_stopped ? 0 : float(std::max(-1.0, std::min(1.0, nuked_left * .9 + nuked_psg_left * .35 * nuked_current[2])));
        output[1] = voices_stopped ? 0 : float(std::max(-1.0, std::min(1.0, nuked_right * .9 + nuked_psg_right * .35 * nuked_current[3])));
    }
    void sample(float *output) {
        if (nuked) { sample_nuked(output); return; }
        if (ramp) {
            for (size_t i = 0; i < current.size(); ++i)
                current[i] += (target[i] - current[i]) / ramp;
            --ramp;
        }
        remainder += chip_rate;
        const uint32_t count = static_cast<uint32_t>(remainder / output_rate);
        remainder -= static_cast<uint64_t>(count) * output_rate;
        if (count) {
            float fl = 0, fr = 0, pl = 0, pr = 0;
            for (uint32_t i = 0; i < count; ++i) {
                float left, right;
                fm.generate(ym, &left, &right, 1);
                fl += (left - idle_left) * current[0];
                fr += (right - idle_right) * current[1];
                segapsg_generate(psg, &left, &right, 1);
                pl += left;
                pr += right;
            }
            fm_left = fl / count;
            fm_right = fr / count;
            psg_left = pl / count;
            psg_right = pr / count;
        }
        output[0] = std::max(-1.0f, std::min(1.0f, fm_left * .9f + psg_left * .35f * current[2]));
        output[1] = std::max(-1.0f, std::min(1.0f, fm_right * .9f + psg_right * .35f * current[3]));
    }
};
}

extern "C" {
void *native_genesis_create(uint32_t rate) {
    try { return new NativeGenesis(rate); } catch (...) { return nullptr; }
}
void *native_genesis_create_nuked(uint32_t rate) {
    if (rate < 8000 || rate > 384000) return nullptr;
    try { return new NativeGenesis(rate, true); } catch (...) { return nullptr; }
}
void native_genesis_destroy(void *ptr) { delete static_cast<NativeGenesis *>(ptr); }
void native_genesis_reset(void *ptr) { static_cast<NativeGenesis *>(ptr)->reset(); }
void native_genesis_stop_voices(void *ptr) { static_cast<NativeGenesis *>(ptr)->stop(); }
void native_genesis_write(void *ptr, uint8_t port, uint8_t reg, uint8_t value) {
    auto *core = static_cast<NativeGenesis *>(ptr);
    core->write(port, reg, value);
}
void native_genesis_psg_write(void *ptr, uint8_t value) { static_cast<NativeGenesis *>(ptr)->psg_write(value); }
void native_genesis_psg_reset(void *ptr) {
    auto *core=static_cast<NativeGenesis *>(ptr);
    segapsg_reset(core->psg);
    core->periods = {}; core->attenuation.fill(15);
    core->psg_latch = core->noise = 0; core->stereo = 0xff;
}
void native_genesis_psg_mute(void *ptr, uint8_t channel) { if (channel < 4) static_cast<NativeGenesis *>(ptr)->psg_mute(channel); }
void native_genesis_psg_stereo(void *ptr, uint8_t value) {
    auto *core = static_cast<NativeGenesis *>(ptr);
    core->stereo = value;
    segapsg_set_stereo(core->psg, value);
}
void native_genesis_mix(void *ptr, const float *gains) {
    auto *core = static_cast<NativeGenesis *>(ptr);
    if (core->nuked) {
        // The combined transport sends all gains for a source-specific edit.
        // Preserve ramps belonging to sources whose target did not change.
        for (size_t source = 0; source < core->nuked_ramp.size(); ++source) {
            const size_t begin = source * 2, end = std::min(begin + 2, core->nuked_target.size());
            bool changed = false;
            for (size_t i = begin; i < end; ++i) changed |= core->nuked_target[i] != gains[i];
            if (changed) {
                for (size_t i = begin; i < end; ++i) core->nuked_target[i] = gains[i];
                core->nuked_ramp[source] = std::max(1u, (core->output_rate + 100) / 200);
            }
        }
    } else {
        std::copy(gains, gains + 5, core->target.begin());
        core->ramp = std::max(1u, core->output_rate / 200); // Existing ymfm 5 ms ramp.
    }
}
float native_genesis_master(void *ptr) { auto *core = static_cast<NativeGenesis *>(ptr); return core->nuked ? float(core->nuked_current[4]) : core->current[4]; }
uint8_t native_genesis_read(void *ptr, uint32_t port) { auto *core=static_cast<NativeGenesis *>(ptr); return core->fm.read(core->ym, port); }
uint8_t native_genesis_read_status(void *ptr) { auto *core=static_cast<NativeGenesis *>(ptr); return core->fm.read_status(core->ym); }
uint8_t native_genesis_get_irq(void *ptr) { auto *core=static_cast<NativeGenesis *>(ptr); return core->fm.get_irq(core->ym); }
void native_genesis_sample(void *ptr, float *output) { static_cast<NativeGenesis *>(ptr)->sample(output); }
}
