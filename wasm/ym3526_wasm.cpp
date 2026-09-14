#include <cstdint>

#include "ymfm_wasm_interface.h"
#include "ymfm_opl.h"

namespace
{

struct ym3526_handle
{
    ymfm_wasm_interface intf;
    ymfm::ym3526 chip;

    ym3526_handle() : intf(), chip(intf)
    {
        chip.reset();
    }
};

inline ym3526_handle *cast_handle(void *ptr)
{
    return static_cast<ym3526_handle *>(ptr);
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

void *ym3526_create()
{
    return new ym3526_handle();
}

void ym3526_destroy(void *ptr)
{
    delete cast_handle(ptr);
}

void ym3526_reset(void *ptr)
{
    cast_handle(ptr)->chip.reset();
}

void ym3526_write(void *ptr, uint32_t offset, uint8_t data)
{
    cast_handle(ptr)->chip.write(offset, data);
}

uint8_t ym3526_read(void *ptr, uint32_t offset)
{
    return cast_handle(ptr)->chip.read(offset);
}

uint8_t ym3526_read_status(void *ptr)
{
    return cast_handle(ptr)->chip.read_status();
}

uint8_t ym3526_get_irq(void *ptr)
{
    return cast_handle(ptr)->intf.irq_asserted ? 1 : 0;
}

uint32_t ym3526_sample_rate(void *ptr, uint32_t clock)
{
    return cast_handle(ptr)->chip.sample_rate(clock);
}

void ym3526_generate(void *ptr, float *left, float *right, uint32_t frames)
{
    auto *handle = cast_handle(ptr);
    for (uint32_t index = 0; index < frames; index++)
    {
        ymfm::ym3526::output_data output;
        handle->chip.generate(&output);
        handle->intf.advance_sample(handle->chip);
        left[index] = normalize_sample(output.data[0]);
        right[index] = normalize_sample(output.data[0]);
    }
}

}
