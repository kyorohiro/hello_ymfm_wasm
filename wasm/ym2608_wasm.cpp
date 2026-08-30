#include <cstdint>
#include <vector>

#include "ymfm.h"
#include "ymfm_opn.h"

namespace
{

struct ym2608_wasm_interface : public ymfm::ymfm_interface
{
    bool irq_asserted = false;
    std::vector<uint8_t> adpcm_a_rom;

    uint8_t ymfm_external_read(ymfm::access_class type, uint32_t address) override
    {
        if (type == ymfm::ACCESS_ADPCM_A)
        {
            return address < adpcm_a_rom.size()
                ? adpcm_a_rom[address]
                : 0;
        }
        return 0;
    }

    void ymfm_update_irq(bool asserted) override
    {
        irq_asserted = asserted;
    }
};

struct ym2608_handle
{
    ym2608_wasm_interface intf;
    ymfm::ym2608 chip;

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
    const uint32_t end = offset + length;
    if (rom.size() < end)
        rom.resize(end);
    for (uint32_t index = 0; index < length; index++)
        rom[offset + index] = data[index];
}

void ym2608_generate(void *ptr, float *left, float *right, uint32_t frames)
{
    auto *handle = cast_handle(ptr);
    for (uint32_t index = 0; index < frames; index++)
    {
        ymfm::ym2608::output_data output;
        handle->chip.generate(&output);
        left[index] = normalize_sample(output.data[0]);
        right[index] = normalize_sample(output.data[1]);
    }
}

}
