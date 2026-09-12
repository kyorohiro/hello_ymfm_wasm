#include <cstdint>
#include <vector>

#include "ymfm_wasm_interface.h"
#include "ymfm_opn.h"

namespace
{

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
    ymfm::ym2608 chip;
    uint32_t source_mute_mask = 0;

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

void ym2608_generate(void *ptr, float *left, float *right, uint32_t frames)
{
    auto *handle = cast_handle(ptr);
    for (uint32_t index = 0; index < frames; index++)
    {
        ymfm::ym2608::output_data output;
        handle->chip.generate(&output);
        handle->intf.advance_sample(handle->chip);
        // Match examples/vgmrender: SSG is a separate mono output.
        const int32_t ssg = (handle->source_mute_mask & 1) ? 0 : output.data[2];
        left[index] = normalize_sample(output.data[0] + ssg);
        right[index] = normalize_sample(output.data[1] + ssg);
    }
}

}
