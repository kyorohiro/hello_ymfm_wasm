#include "opn_state.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

#include "ymfm_wasm_interface.h"
#include "ymfm_opn.h"

namespace
{

// Preserve ymfm's clock cadence, held sample, status transitions and clipping.
// Keep the stereo sources separately so host faders never rewrite registers
// or skip clocks when muted. SSG already has its own mono output.
class ym2610_source_mixer : public ymfm::ym2610
{
public:
    using stem_data = fm_engine::output_data;
    ym2610_source_mixer(ymfm::ymfm_interface &intf, uint8_t mask) : ym2610(intf, mask)
    {
        for (auto &stem : m_stems) stem.clear();
    }

    const stem_data *stems() const { return m_stems; }
    void restore_stems(const int32_t *values)
    {
        for (uint32_t part = 0; part < 3; part++)
            for (uint32_t channel = 0; channel < 2; channel++)
                m_stems[part].data[channel] = values[part * 2 + channel];
    }

    void generate_sources(output_data &output)
    {
        if (m_ssg_resampler.sampindex() % m_fm_samples_per_output == 0)
            clock_sources();
        output.data[0] = m_last_fm.data[0];
        output.data[1] = m_last_fm.data[1];
        m_ssg_resampler.resample(&output, 1);
    }

    float mix_stereo(uint32_t channel, const float *gains) const
    {
        const float sample = m_stems[0].data[channel] * gains[0]
            + m_stems[1].data[channel] * gains[2] + m_stems[2].data[channel] * gains[3];
        return std::max(-32768.0f, std::min(32767.0f, sample));
    }

private:
    stem_data m_stems[3]; // FM, ADPCM-A, ADPCM-B

    void clock_sources()
    {
        const uint32_t env_counter = m_fm.clock(m_fm_mask);
        if (ymfm::bitfield(env_counter, 0, 2) == 0) m_eos_status |= m_adpcm_a.clock(0x3f);
        m_adpcm_b.clock();

        // As in ym2610::clock_fm_and_adpcm(), expose EOS-B on transition only.
        const uint8_t eos = (m_adpcm_b.status() & ymfm::adpcm_b_channel::STATUS_EOS) ? 0x40 : 0;
        if (((eos ^ m_eos_status) & 0x40) != 0)
            m_eos_status = (m_eos_status & ~0xc0) | eos | (eos << 1);

        m_fm.output(m_stems[0].clear(), 1, 32767, m_fm_mask);
        m_stems[1].clear();
        m_stems[2].clear();
        if (!m_adpcm_a_muted) m_adpcm_a.output(m_stems[1], 0x3f);
        if (!m_adpcm_b_muted) m_adpcm_b.output(m_stems[2], 1);
        for (uint32_t channel = 0; channel < 2; channel++)
            m_last_fm.data[channel] =
                m_stems[0].data[channel] + m_stems[1].data[channel] + m_stems[2].data[channel];
        m_last_fm.clamp16();
    }
};

struct ym2610b_wasm_interface : public ymfm_wasm_interface
{
    std::vector<uint8_t> rom[2];
    uint8_t ymfm_external_read(ymfm::access_class type, uint32_t address) override {
        if (type != ymfm::ACCESS_ADPCM_A && type != ymfm::ACCESS_ADPCM_B) return 0;
        const auto &data = rom[type == ymfm::ACCESS_ADPCM_B ? 1 : 0];
        return address < data.size() ? data[address] : 0;
    }
};

struct ym2610b_handle
{
    ym2610b_wasm_interface intf;
    ym2610_source_mixer chip;
    uint32_t mute_mask = 0;
    float source_gains[4] = {1.0f, 1.0f, 1.0f, 1.0f};

    ym2610b_handle(bool variant = true) : intf(), chip(intf, variant ? 0x3f : 0x36) { chip.reset(); }
};

inline ym2610b_handle *cast_handle(void *ptr) { return static_cast<ym2610b_handle *>(ptr); }

inline bool valid_source_gain(float gain) { return std::isfinite(gain) && gain >= 0 && gain <= 3.8f; }

inline float normalize_sample(float value)
{
    if (value < -32768) value = -32768;
    if (value > 32767) value = 32767;
    return value / 32768.0f;
}

constexpr uint32_t SOURCE_STATE_MAGIC = 0x31424e4f; // "ONB1", same-build host trailer.
constexpr uint32_t SOURCE_STATE_BYTES = 4 * sizeof(float) + 7 * sizeof(uint32_t);

} // namespace

extern "C"
{

void *ym2610b_create() { return new ym2610b_handle(); }
void *ym2610b_create_variant(uint32_t variant) { return new ym2610b_handle(variant != 0); }
void ym2610b_destroy(void *ptr) { delete cast_handle(ptr); }
void ym2610b_reset(void *ptr) { cast_handle(ptr)->chip.reset(); }
void ym2610b_write(void *ptr, uint32_t offset, uint8_t data) { cast_handle(ptr)->chip.write(offset, data); }
uint8_t ym2610b_read(void *ptr, uint32_t offset) { return cast_handle(ptr)->chip.read(offset); }
uint8_t ym2610b_read_status(void *ptr) { return cast_handle(ptr)->chip.read_status(); }
uint8_t ym2610b_read_status_hi(void *ptr) { return cast_handle(ptr)->chip.read_status_hi(); }
uint8_t ym2610b_get_irq(void *ptr) { return cast_handle(ptr)->intf.irq_asserted ? 1 : 0; }
uint32_t ym2610b_sample_rate(void *ptr, uint32_t clock) { return cast_handle(ptr)->chip.sample_rate(clock); }

void ym2610b_clear_roms(void *ptr) {
    for (auto &rom : cast_handle(ptr)->intf.rom) rom.clear();
}
int ym2610b_load_rom(void *ptr, uint32_t type, uint32_t size, uint32_t offset, const uint8_t *data, uint32_t length) {
    if (type > 1 || size > 0x1000000 || offset > size || length > size - offset) return 0;
    auto &rom = cast_handle(ptr)->intf.rom[type];
    rom.resize(size, 0);
    for (uint32_t i = 0; i < length; i++) rom[offset+i] = data[i];
    return 1;
}
void ym2610b_set_source_mute_mask(void *ptr, uint32_t mask) {
    auto *h = cast_handle(ptr);
    h->mute_mask = mask;
    h->chip.set_adpcm_mute((mask & 2) != 0, (mask & 4) != 0);
}

int ym2610b_set_source_gains(void *ptr, float fm, float ssg, float adpcm_a, float adpcm_b)
{
    if (!ptr || !valid_source_gain(fm) || !valid_source_gain(ssg) ||
        !valid_source_gain(adpcm_a) || !valid_source_gain(adpcm_b)) return 0;
    auto *h = cast_handle(ptr);
    h->source_gains[0] = fm;
    h->source_gains[1] = ssg;
    h->source_gains[2] = adpcm_a;
    h->source_gains[3] = adpcm_b;
    return 1;
}

void ym2610b_generate(void *ptr, float *left, float *right, uint32_t frames)
{
    auto *handle = cast_handle(ptr);
    const auto &gains = handle->source_gains;
    const bool unity = gains[0] == 1.0f && gains[2] == 1.0f && gains[3] == 1.0f;
    for (uint32_t index = 0; index < frames; index++)
    {
        ymfm::ym2610b::output_data output;
        handle->chip.generate_sources(output);
        handle->intf.advance_sample(handle->chip);
        const float ssg = (handle->mute_mask & 1) ? 0.0f : output.data[2] * gains[1];
        left[index] = normalize_sample((unity ? output.data[0] : handle->chip.mix_stereo(0, gains)) + ssg);
        right[index] = normalize_sample((unity ? output.data[1] : handle->chip.mix_stereo(1, gains)) + ssg);
    }
}


uint32_t ym2610b_save_state(void *ptr, uint8_t *out) {
    auto *h = cast_handle(ptr);
    const uint32_t size = save_opn_state(h->chip, h->intf, {&h->mute_mask}, {&h->intf.rom[0], &h->intf.rom[1]}, out);
    if (out) {
        std::memcpy(out + size, h->source_gains, sizeof(h->source_gains));
        uint8_t *stems = out + size + sizeof(h->source_gains);
        for (uint32_t part = 0; part < 3; part++)
            std::memcpy(stems + part * 2 * sizeof(int32_t), h->chip.stems()[part].data, 2 * sizeof(int32_t));
        std::memcpy(out + size + SOURCE_STATE_BYTES - sizeof(SOURCE_STATE_MAGIC), &SOURCE_STATE_MAGIC, sizeof(SOURCE_STATE_MAGIC));
    }
    return size + SOURCE_STATE_BYTES;
}
int ym2610b_load_state(void *ptr, const uint8_t *data, uint32_t size) {
    if (!ptr || !data || size < SOURCE_STATE_BYTES) return 0;
    const uint32_t chip_size = size - SOURCE_STATE_BYTES;
    float gains[4];
    int32_t stems[6];
    uint32_t magic;
    std::memcpy(gains, data + chip_size, sizeof(gains));
    std::memcpy(stems, data + chip_size + sizeof(gains), sizeof(stems));
    std::memcpy(&magic, data + size - sizeof(magic), sizeof(magic));
    if (magic != SOURCE_STATE_MAGIC) return 0;
    for (const auto gain : gains) if (!valid_source_gain(gain)) return 0;
    for (const auto value : stems) if (value < -0x1000000 || value > 0x1000000) return 0;
    auto *h = cast_handle(ptr);
    if (!load_opn_state(h->chip, h->intf, {&h->mute_mask}, {&h->intf.rom[0], &h->intf.rom[1]}, data, chip_size)) return 0;
    std::memcpy(h->source_gains, gains, sizeof(gains));
    h->chip.restore_stems(stems);
    h->chip.set_adpcm_mute((h->mute_mask & 2) != 0, (h->mute_mask & 4) != 0);
    return 1;
}
}
