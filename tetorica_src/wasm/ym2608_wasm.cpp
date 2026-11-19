#include "opn_state.h"
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

#include "ymfm_wasm_interface.h"
#include "ymfm_opn.h"

namespace
{

// Host source taps keep the pinned ymfm engines and their clocks unchanged.
// The aggregate integer path is retained verbatim at unity. Only non-unity
// source gains use the separately cached, pre-aggregate-clipping stems.
class ym2608_source_mixer : public ymfm::ym2608
{
public:
    using stem_data = fm_engine::output_data;
    explicit ym2608_source_mixer(ymfm::ymfm_interface &intf) : ym2608(intf)
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

    void generate_sources(output_data *output, float *mixed, const float *gains)
    {
        // Exactly the original generate() cadence, including minimum-fidelity
        // prescale3's integer average. The SSG resampler advances only once.
        const bool unity = gains[0] == 1.0f && gains[2] == 1.0f && gains[3] == 1.0f;
        if (m_fm_samples_per_output != 0)
        {
            if (m_ssg_resampler.sampindex() % m_fm_samples_per_output == 0)
                clock_sources();
            output->data[0] = m_last_fm.data[0];
            output->data[1] = m_last_fm.data[1];
            weighted(mixed, gains);
        }
        else
        {
            const uint32_t step = m_ssg_resampler.sampindex() % 3;
            if (step == 0) clock_sources();
            output->data[0] = m_last_fm.data[0];
            output->data[1] = m_last_fm.data[1];
            weighted(mixed, gains);
            if (step == 1)
            {
                float next[2];
                clock_sources();
                weighted(next, gains);
                for (uint32_t channel = 0; channel < 2; channel++)
                {
                    output->data[channel] = (output->data[channel] + m_last_fm.data[channel]) / 2;
                    mixed[channel] = (mixed[channel] + next[channel]) * 0.5f;
                }
            }
        }
        // Legacy unity mixing must retain integer averages and exact rounding.
        if (unity) for (uint32_t channel = 0; channel < 2; channel++) mixed[channel] = float(output->data[channel]);
        m_ssg_resampler.resample(output, 1);
    }

private:
    stem_data m_stems[3]; // FM, Rhythm, ADPCM-B; SSG already has its own output.

    void weighted(float *mixed, const float *gains) const
    {
        for (uint32_t channel = 0; channel < 2; channel++)
        {
            const float value = m_stems[0].data[channel] * gains[0]
                + m_stems[1].data[channel] * gains[2]
                + m_stems[2].data[channel] * gains[3];
            mixed[channel] = std::max(-32768.0f, std::min(32767.0f, value));
        }
    }

    void clock_sources()
    {
        const uint32_t fmmask = ymfm::bitfield(m_irq_enable, 7) ? 0x3f : 0x07;
        const uint32_t env_counter = m_fm.clock(fm_engine::ALL_CHANNELS);
        if (ymfm::bitfield(env_counter, 0, 2) == 0)
            m_adpcm_a.clock(ymfm::bitfield(env_counter, 2) ? 0x0f : 0x3f);
        m_adpcm_b.clock();
        m_fm.output(m_stems[0].clear(), 1, 32767, fmmask);
        m_stems[1].clear(); m_stems[2].clear();
        if (!m_rhythm_muted) m_adpcm_a.output(m_stems[1], 0x3f);
        if (!m_delta_t_muted) m_adpcm_b.output(m_stems[2], 1);
        for (uint32_t channel = 0; channel < 2; channel++)
            m_last_fm.data[channel] = m_stems[0].data[channel] + m_stems[1].data[channel] + m_stems[2].data[channel];
        m_last_fm.clamp16();
    }
};

constexpr uint32_t SOURCE_STATE_MAGIC = 0x3450584d; // "MXP4", same-build host trailer.
constexpr uint32_t SOURCE_STATE_VERSION = 1;
constexpr uint32_t SOURCE_STATE_BYTES = 56;

struct ym2608_wasm_interface : public ymfm_wasm_interface
{
    std::vector<uint8_t> adpcm_a_rom;
    // The core addresses up to 16 address bits shifted by 5 (8-bit DRAM).
    std::vector<uint8_t> adpcm_b_memory = std::vector<uint8_t>(0x200000, 0);

    uint8_t ymfm_external_read(ymfm::access_class type, uint32_t address) override
    {
        if (type == ymfm::ACCESS_ADPCM_A)
        {
            return address < adpcm_a_rom.size()
                ? adpcm_a_rom[address]
                : 0;
        }
        if (type == ymfm::ACCESS_ADPCM_B)
            return address < adpcm_b_memory.size() ? adpcm_b_memory[address] : 0;
        return 0;
    }

    void ymfm_external_write(ymfm::access_class type, uint32_t address, uint8_t data) override
    {
        if (type == ymfm::ACCESS_ADPCM_B && address < adpcm_b_memory.size())
            adpcm_b_memory[address] = data;
    }
};

struct ym2608_handle
{
    ym2608_wasm_interface intf;
    ym2608_source_mixer chip;
    uint32_t source_mute_mask = 0;
    float fm_gain = 1.0f;
    float ssg_gain = 1.0f;
    float source_gains[4] = {1.0f, 1.0f, 1.0f, 1.0f}; // FM, SSG, Rhythm, ADPCM-B.

    ym2608_handle() : intf(), chip(intf)
    {
        chip.reset();
    }
};

inline ym2608_handle *cast_handle(void *ptr)
{
    return static_cast<ym2608_handle *>(ptr);
}

inline float normalize_sample(int32_t value)
{
    if (value < -32768)
        value = -32768;
    if (value > 32767)
        value = 32767;
    return static_cast<float>(value) / 32768.0f;
}

inline bool valid_output_gain(float gain)
{
    return std::isfinite(gain) && gain >= 0.0f && gain <= 1024.0f;
}

inline float normalize_mixed_sample(float value)
{
    if (value < -32768.0f)
        value = -32768.0f;
    if (value > 32767.0f)
        value = 32767.0f;
    return value / 32768.0f;
}

} // namespace

extern "C"
{

void *ym2608_create()
{
    return new ym2608_handle();
}

void ym2608_destroy(void *ptr)
{
    delete cast_handle(ptr);
}

void ym2608_reset(void *ptr)
{
    cast_handle(ptr)->chip.reset();
}

void ym2608_write(void *ptr, uint32_t offset, uint8_t data)
{
    cast_handle(ptr)->chip.write(offset, data);
}

uint8_t ym2608_read(void *ptr, uint32_t offset)
{
    return cast_handle(ptr)->chip.read(offset);
}

uint8_t ym2608_read_status(void *ptr)
{
    return cast_handle(ptr)->chip.read_status();
}

uint8_t ym2608_read_status_hi(void *ptr)
{
    return cast_handle(ptr)->chip.read_status_hi();
}

uint8_t ym2608_get_irq(void *ptr)
{
    return cast_handle(ptr)->intf.irq_asserted ? 1 : 0;
}

uint32_t ym2608_sample_rate(void *ptr, uint32_t clock)
{
    return cast_handle(ptr)->chip.sample_rate(clock);
}

void ym2608_load_adpcm_a_rom(void *ptr, uint32_t offset, const uint8_t *data, uint32_t length)
{
    auto *handle = cast_handle(ptr);
    auto &rom = handle->intf.adpcm_a_rom;
    constexpr uint32_t rom_size = 0x2000; // YM2608 internal rhythm ROM.
    if (offset > rom_size || length > rom_size - offset || (length && data == nullptr))
        return;
    const uint32_t end = offset + length;
    if (rom.size() < end)
        rom.resize(end);
    for (uint32_t index = 0; index < length; index++)
        rom[offset + index] = data[index];
}

void ym2608_clear_adpcm_b_memory(void *ptr)
{
    auto &memory = cast_handle(ptr)->intf.adpcm_b_memory;
    for (auto &byte : memory)
        byte = 0;
}

void ym2608_load_adpcm_b_memory(void *ptr, uint32_t offset, const uint8_t *data, uint32_t length)
{
    auto &memory = cast_handle(ptr)->intf.adpcm_b_memory;
    if (offset > memory.size() || length > memory.size() - offset)
        return;
    for (uint32_t index = 0; index < length; index++)
        memory[offset + index] = data[index];
}

void ym2608_set_source_mute_mask(void *ptr, uint32_t mask)
{
    auto *handle = cast_handle(ptr);
    handle->source_mute_mask = mask;
    handle->chip.set_adpcm_mute((mask & 2) != 0, (mask & 4) != 0);
}

// Host mixing controls leave the chip's registers, clocks and envelopes intact.
// The FM-side bus also contains the core's Rhythm and ADPCM-B stereo output.
int ym2608_set_output_gains(void *ptr, float fm_gain, float ssg_gain)
{
    if (!ptr || !valid_output_gain(fm_gain) || !valid_output_gain(ssg_gain))
        return 0;
    auto *handle = cast_handle(ptr);
    handle->fm_gain = fm_gain;
    handle->ssg_gain = ssg_gain;
    return 1;
}

// Separate software source faders; original register volumes are untouched.
int ym2608_set_source_gains(void *ptr, float fm, float ssg, float rhythm, float adpcm)
{
    if (!ptr || !valid_output_gain(fm) || !valid_output_gain(ssg)
        || !valid_output_gain(rhythm) || !valid_output_gain(adpcm)) return 0;
    auto *handle = cast_handle(ptr);
    handle->source_gains[0] = fm; handle->source_gains[1] = ssg;
    handle->source_gains[2] = rhythm; handle->source_gains[3] = adpcm;
    return 1;
}

void ym2608_generate(void *ptr, float *left, float *right, uint32_t frames)
{
    auto *handle = cast_handle(ptr);
    for (uint32_t index = 0; index < frames; index++)
    {
        ymfm::ym2608::output_data output;
        float fm_side[2];
        handle->chip.generate_sources(&output, fm_side, handle->source_gains);
        handle->intf.advance_sample(handle->chip);
        // Match examples/vgmrender: SSG is a separate mono output.
        const int32_t ssg = (handle->source_mute_mask & 1) ? 0 : output.data[2];
        const bool source_unity = handle->source_gains[0] == 1.0f && handle->source_gains[1] == 1.0f
            && handle->source_gains[2] == 1.0f && handle->source_gains[3] == 1.0f;
        if (handle->fm_gain == 1.0f && handle->ssg_gain == 1.0f && source_unity)
        {
            left[index] = normalize_sample(output.data[0] + ssg);
            right[index] = normalize_sample(output.data[1] + ssg);
        }
        else
        {
            const float mixed_ssg = ssg * handle->ssg_gain * handle->source_gains[1];
            left[index] = normalize_mixed_sample(fm_side[0] * handle->fm_gain + mixed_ssg);
            right[index] = normalize_mixed_sample(fm_side[1] * handle->fm_gain + mixed_ssg);
        }
    }
}


uint32_t ym2608_save_state(void *ptr, uint8_t *out) {
    auto *h = cast_handle(ptr);
    const uint32_t size = save_opn_state(h->chip, h->intf, {&h->source_mute_mask}, {&h->intf.adpcm_a_rom, &h->intf.adpcm_b_memory}, out);
    if (out) {
        std::memcpy(out + size, &h->fm_gain, sizeof(float));
        std::memcpy(out + size + sizeof(float), &h->ssg_gain, sizeof(float));
        std::memcpy(out + size + 8, h->source_gains, sizeof(h->source_gains));
        for (uint32_t part = 0; part < 3; part++)
            std::memcpy(out + size + 24 + part * 8, h->chip.stems()[part].data, 2 * sizeof(int32_t));
        std::memcpy(out + size + 48, &SOURCE_STATE_MAGIC, sizeof(uint32_t));
        std::memcpy(out + size + 52, &SOURCE_STATE_VERSION, sizeof(uint32_t));
    }
    return size + SOURCE_STATE_BYTES;
}
int ym2608_load_state(void *ptr, const uint8_t *data, uint32_t size) {
    if (!ptr || !data || size < SOURCE_STATE_BYTES) return 0;
    const uint32_t chip_size = size - SOURCE_STATE_BYTES;
    float fm_gain, ssg_gain, source_gains[4];
    int32_t stems[6]; uint32_t magic, version;
    std::memcpy(&fm_gain, data + chip_size, sizeof(float));
    std::memcpy(&ssg_gain, data + chip_size + sizeof(float), sizeof(float));
    std::memcpy(source_gains, data + chip_size + 8, sizeof(source_gains));
    std::memcpy(stems, data + chip_size + 24, sizeof(stems));
    std::memcpy(&magic, data + chip_size + 48, sizeof(uint32_t));
    std::memcpy(&version, data + chip_size + 52, sizeof(uint32_t));
    if (magic != SOURCE_STATE_MAGIC || version != SOURCE_STATE_VERSION
        || !valid_output_gain(fm_gain) || !valid_output_gain(ssg_gain)) return 0;
    for (const auto gain : source_gains) if (!valid_output_gain(gain)) return 0;
    for (const auto value : stems) if (value < -0x1000000 || value > 0x1000000) return 0;
    auto *h = cast_handle(ptr);
    if (!load_opn_state(h->chip, h->intf, {&h->source_mute_mask}, {&h->intf.adpcm_a_rom, &h->intf.adpcm_b_memory}, data, chip_size)) return 0;
    h->fm_gain = fm_gain;
    h->ssg_gain = ssg_gain;
    std::memcpy(h->source_gains, source_gains, sizeof(source_gains));
    h->chip.restore_stems(stems);
    h->chip.set_adpcm_mute((h->source_mute_mask & 2) != 0, (h->source_mute_mask & 4) != 0);
    return 1;
}
}
