#include <cstdint>
#include <memory>

#include "ymfm.h"
#include "ymfm_opn.h"

namespace
{

struct ym2612_debug_chip : public ymfm::ym2612
{
    using ymfm::ym2612::ym2612;
    using ymfm::ym2612::m_fm;
};

struct ym2612_wasm_interface : public ymfm::ymfm_interface
{
    bool irq_asserted = false;

    void ymfm_update_irq(bool asserted) override
    {
        irq_asserted = asserted;
    }
};

struct ym2612_handle
{
    ym2612_wasm_interface intf;
    ym2612_debug_chip chip;

    ym2612_handle() : intf(), chip(intf)
    {
        chip.reset();
    }
};

inline ym2612_handle *cast_handle(void *ptr)
{
    return static_cast<ym2612_handle *>(ptr);
}

inline float normalize_sample(int32_t value)
{
    if (value < -32768)
        value = -32768;
    if (value > 32767)
        value = 32767;
    return static_cast<float>(value) / 32768.0f;
}

inline float normalize_attenuation(uint16_t attenuation)
{
    if (attenuation > 0x3ff)
        attenuation = 0x3ff;
    return 1.0f - (static_cast<float>(attenuation) / 1023.0f);
}

inline uint32_t channel_slot_opoffs(uint32_t channel_index, uint32_t slot_index)
{
    static constexpr uint32_t SLOT_BASES[4] = {0, 4, 8, 12};
    if (slot_index > 3)
        return 0xffffffff;
    return (channel_index % 3) + SLOT_BASES[slot_index] + 0x100 * (channel_index / 3);
}

template<typename OperatorType>
OperatorType *resolve_channel_slot_operator(ym2612_handle *handle, uint32_t channel_index, uint32_t slot_index)
{
    auto *channel = handle->chip.m_fm.debug_channel(channel_index);
    if (channel == nullptr)
        return nullptr;

    const uint32_t desired_opoffs = channel_slot_opoffs(channel_index, slot_index);
    for (uint32_t index = 0; index < 4; index++)
    {
        auto *op = channel->debug_operator(index);
        if (op != nullptr && op->opoffs() == desired_opoffs)
            return op;
    }
    return nullptr;
}

} // namespace

extern "C"
{

void *ym2612_create()
{
    return new ym2612_handle();
}

void ym2612_destroy(void *ptr)
{
    delete cast_handle(ptr);
}

void ym2612_reset(void *ptr)
{
    cast_handle(ptr)->chip.reset();
}

void ym2612_write(void *ptr, uint32_t offset, uint8_t data)
{
    cast_handle(ptr)->chip.write(offset, data);
}

uint8_t ym2612_read(void *ptr, uint32_t offset)
{
    return cast_handle(ptr)->chip.read(offset);
}

uint8_t ym2612_read_status(void *ptr)
{
    return cast_handle(ptr)->chip.read_status();
}

uint8_t ym2612_get_irq(void *ptr)
{
    return cast_handle(ptr)->intf.irq_asserted ? 1 : 0;
}

uint32_t ym2612_sample_rate(void *ptr, uint32_t clock)
{
    return cast_handle(ptr)->chip.sample_rate(clock);
}

void ym2612_generate(void *ptr, float *left, float *right, uint32_t frames)
{
    auto *handle = cast_handle(ptr);
    for (uint32_t index = 0; index < frames; index++)
    {
        ymfm::ym2612::output_data output;
        handle->chip.generate(&output);
        left[index] = normalize_sample(output.data[0]);
        right[index] = normalize_sample(output.data[1]);
    }
}

void ym2612_generate_with_internal_envelope(
    void *ptr,
    float *left,
    float *right,
    float *env0,
    float *env1,
    float *env2,
    float *env3,
    uint32_t frames,
    uint32_t channel_index)
{
    auto *handle = cast_handle(ptr);
    auto *op0 = resolve_channel_slot_operator<ymfm::fm_operator<ymfm::opna_registers>>(handle, channel_index, 0);
    auto *op1 = resolve_channel_slot_operator<ymfm::fm_operator<ymfm::opna_registers>>(handle, channel_index, 1);
    auto *op2 = resolve_channel_slot_operator<ymfm::fm_operator<ymfm::opna_registers>>(handle, channel_index, 2);
    auto *op3 = resolve_channel_slot_operator<ymfm::fm_operator<ymfm::opna_registers>>(handle, channel_index, 3);

    for (uint32_t index = 0; index < frames; index++)
    {
        ymfm::ym2612::output_data output;
        handle->chip.generate(&output);
        left[index] = normalize_sample(output.data[0]);
        right[index] = normalize_sample(output.data[1]);
        env0[index] = (op0 != nullptr) ? normalize_attenuation(op0->debug_eg_attenuation()) : 0.0f;
        env1[index] = (op1 != nullptr) ? normalize_attenuation(op1->debug_eg_attenuation()) : 0.0f;
        env2[index] = (op2 != nullptr) ? normalize_attenuation(op2->debug_eg_attenuation()) : 0.0f;
        env3[index] = (op3 != nullptr) ? normalize_attenuation(op3->debug_eg_attenuation()) : 0.0f;
    }
}

}
