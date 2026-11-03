#include <cstdint>
#include <vector>
#include <cstring>

#include "ymfm_wasm_interface.h"
#include "ymfm_opl.h"

namespace
{

struct sample_interface : ymfm_wasm_interface
{
    std::vector<uint8_t> memory;
    uint8_t ymfm_external_read(ymfm::access_class type, uint32_t address) override
    { return type == ymfm::ACCESS_PCM && address < memory.size() ? memory[address] : 0; }
    void ymfm_external_write(ymfm::access_class type, uint32_t address, uint8_t data) override
    { if (type == ymfm::ACCESS_PCM && address < memory.size()) memory[address] = data; }
};

struct ymf278b_handle
{
    sample_interface intf;
    ymfm::ymf278b chip;

    ymf278b_handle() : intf(), chip(intf)
    {
        chip.reset();
    }
};

inline ymf278b_handle *cast_handle(void *ptr)
{
    return static_cast<ymf278b_handle *>(ptr);
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

void *ymf278b_create()
{
    return new ymf278b_handle();
}

void ymf278b_destroy(void *ptr)
{
    delete cast_handle(ptr);
}

void ymf278b_reset(void *ptr)
{
    cast_handle(ptr)->chip.reset();
}

void ymf278b_write(void *ptr, uint32_t offset, uint8_t data)
{
    cast_handle(ptr)->chip.write(offset, data);
}

uint8_t ymf278b_read(void *ptr, uint32_t offset)
{
    return cast_handle(ptr)->chip.read(offset);
}

uint8_t ymf278b_read_status(void *ptr)
{
    return cast_handle(ptr)->chip.read_status();
}

uint8_t ymf278b_get_irq(void *ptr)
{
    return cast_handle(ptr)->intf.irq_asserted ? 1 : 0;
}

uint32_t ymf278b_sample_rate(void *ptr, uint32_t clock)
{
    return cast_handle(ptr)->chip.sample_rate(clock);
}

void ymf278b_set_fm_mute_mask(void *ptr, uint32_t mask)
{
    cast_handle(ptr)->chip.set_fm_mute_mask(mask);
}

void ymf278b_set_pcm_mute_mask(void *ptr, uint32_t mask)
{
    cast_handle(ptr)->chip.set_pcm_mute_mask(mask);
}

int ymf278b_load_memory(void *ptr, const uint8_t *data, uint32_t size, uint32_t offset, uint32_t memory_size)
{
    if (memory_size > 4194304 || offset > memory_size || size > memory_size - offset) return 0;
    auto &memory = cast_handle(ptr)->intf.memory;
    memory.resize(memory_size, 0);
    if (size) std::memcpy(memory.data() + offset, data, size);
    return 1;
}
void ymf278b_clear_memory(void *ptr) { cast_handle(ptr)->intf.memory.clear(); }

void ymf278b_generate(void *ptr, float *left, float *right, uint32_t frames)
{
    auto *handle = cast_handle(ptr);
    for (uint32_t index = 0; index < frames; index++)
    {
        ymfm::ymf278b::output_data output;
        handle->chip.generate(&output);
        handle->intf.advance(768);
        // DO2 is the mixed FM + PCM stereo output.
        left[index] = normalize_sample(output.data[4]);
        right[index] = normalize_sample(output.data[5]);
    }
}

}
