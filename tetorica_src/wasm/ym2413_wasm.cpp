#include <cstdint>

#include "ymfm_wasm_interface.h"
#include "ymfm_opl.h"

namespace
{

struct ym2413_handle
{
    ymfm_wasm_interface intf;
    ymfm::ym2413 chip;

    ym2413_handle() : intf(), chip(intf)
    {
        chip.reset();
    }
};

inline ym2413_handle *cast_handle(void *ptr)
{
    return static_cast<ym2413_handle *>(ptr);
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

void *ym2413_create()
{
    return new ym2413_handle();
}

void ym2413_destroy(void *ptr)
{
    delete cast_handle(ptr);
}

void ym2413_reset(void *ptr)
{
    cast_handle(ptr)->chip.reset();
}

void ym2413_write(void *ptr, uint32_t offset, uint8_t data)
{
    cast_handle(ptr)->chip.write(offset, data);
}

uint8_t ym2413_read(void *ptr, uint32_t offset)
{
    return cast_handle(ptr)->chip.read(offset);
}

uint8_t ym2413_read_status(void *ptr)
{
    return cast_handle(ptr)->chip.read_status();
}

uint8_t ym2413_get_irq(void *ptr)
{
    return cast_handle(ptr)->intf.irq_asserted ? 1 : 0;
}

uint32_t ym2413_sample_rate(void *ptr, uint32_t clock)
{
    return cast_handle(ptr)->chip.sample_rate(clock);
}

void ym2413_set_mute_mask(void *ptr, uint32_t mask)
{
    cast_handle(ptr)->chip.set_mute_mask(mask);
}

void ym2413_generate(void *ptr, float *left, float *right, uint32_t frames)
{
    auto *handle = cast_handle(ptr);
    for (uint32_t index = 0; index < frames; index++)
    {
        ymfm::ym2413::output_data output;
        handle->chip.generate(&output);
        handle->intf.advance_sample(handle->chip);
        // OPLL separates melody and rhythm outputs; both are mono.
        // Match examples/vgmrender by summing them into both channels.
        int32_t mix = 0;
        for (uint32_t out = 0; out < ymfm::ym2413::OUTPUTS; out++)
            mix += output.data[out];
        left[index] = right[index] = normalize_sample(mix);
    }
}

}
