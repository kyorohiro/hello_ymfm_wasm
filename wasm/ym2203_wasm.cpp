#include <cstdint>

#include "ymfm.h"
#include "ymfm_opn.h"

namespace
{

struct ym2203_wasm_interface : public ymfm::ymfm_interface
{
    bool irq_asserted = false;

    void ymfm_update_irq(bool asserted) override
    {
        irq_asserted = asserted;
    }
};

struct ym2203_handle
{
    ym2203_wasm_interface intf;
    ymfm::ym2203 chip;

    ym2203_handle() : intf(), chip(intf)
    {
        chip.reset();
    }
};

inline ym2203_handle *cast_handle(void *ptr)
{
    return static_cast<ym2203_handle *>(ptr);
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

void *ym2203_create()
{
    return new ym2203_handle();
}

void ym2203_destroy(void *ptr)
{
    delete cast_handle(ptr);
}

void ym2203_reset(void *ptr)
{
    cast_handle(ptr)->chip.reset();
}

void ym2203_write(void *ptr, uint32_t offset, uint8_t data)
{
    cast_handle(ptr)->chip.write(offset, data);
}

uint8_t ym2203_read(void *ptr, uint32_t offset)
{
    return cast_handle(ptr)->chip.read(offset);
}

uint8_t ym2203_read_status(void *ptr)
{
    return cast_handle(ptr)->chip.read_status();
}

uint8_t ym2203_get_irq(void *ptr)
{
    return cast_handle(ptr)->intf.irq_asserted ? 1 : 0;
}

uint32_t ym2203_sample_rate(void *ptr, uint32_t clock)
{
    return cast_handle(ptr)->chip.sample_rate(clock);
}

void ym2203_generate(void *ptr, float *left, float *right, uint32_t frames)
{
    auto *handle = cast_handle(ptr);
    for (uint32_t index = 0; index < frames; index++)
    {
        ymfm::ym2203::output_data output;
        handle->chip.generate(&output);
        int32_t mix_left = 0;
        int32_t mix_right = 0;
        for (uint32_t out = 0; out < ymfm::ym2203::OUTPUTS; out++)
        {
            if ((out & 1U) == 0)
                mix_left += output.data[out];
            else
                mix_right += output.data[out];
        }
        right[index] = normalize_sample(mix_right);
        left[index] = normalize_sample(mix_left);
    }
}

}
