#include <cstdint>

#include "ymfm_wasm_interface.h"
#include "ymfm_opl.h"

namespace
{

struct ymf262_handle
{
    ymfm_wasm_interface intf;
    ymfm::ymf262 chip;

    ymf262_handle() : intf(), chip(intf)
    {
        chip.reset();
    }
};

inline ymf262_handle *cast_handle(void *ptr)
{
    return static_cast<ymf262_handle *>(ptr);
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

void *ymf262_create()
{
    return new ymf262_handle();
}

void ymf262_destroy(void *ptr)
{
    delete cast_handle(ptr);
}

void ymf262_reset(void *ptr)
{
    cast_handle(ptr)->chip.reset();
}

void ymf262_write(void *ptr, uint32_t offset, uint8_t data)
{
    cast_handle(ptr)->chip.write(offset, data);
}

uint8_t ymf262_read(void *ptr, uint32_t offset)
{
    return cast_handle(ptr)->chip.read(offset);
}

uint8_t ymf262_read_status(void *ptr)
{
    return cast_handle(ptr)->chip.read_status();
}

uint8_t ymf262_get_irq(void *ptr)
{
    return cast_handle(ptr)->intf.irq_asserted ? 1 : 0;
}

uint32_t ymf262_sample_rate(void *ptr, uint32_t clock)
{
    return cast_handle(ptr)->chip.sample_rate(clock);
}

void ymf262_set_mute_mask(void *ptr, uint32_t mask)
{
    cast_handle(ptr)->chip.set_mute_mask(mask);
}

void ymf262_generate(void *ptr, float *left, float *right, uint32_t frames)
{
    auto *handle = cast_handle(ptr);
    for (uint32_t index = 0; index < frames; index++)
    {
        ymfm::ymf262::output_data output;
        handle->chip.generate(&output);
        handle->intf.advance_sample(handle->chip);
        // Fold four OPL3 output buses into stereo: A+C left, B+D right.
        left[index] = normalize_sample(output.data[0] + output.data[2]);
        right[index] = normalize_sample(output.data[1] + output.data[3]);
    }
}

}
