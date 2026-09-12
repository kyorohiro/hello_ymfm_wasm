#include <cstdint>
#include <vector>

#include "ymfm_wasm_interface.h"
#include "ymfm_opn.h"

namespace
{

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
    ymfm::ym2610 chip;
    uint32_t mute_mask = 0;

    ym2610b_handle(bool variant = true) : intf(), chip(intf, variant ? 0x3f : 0x36) { chip.reset(); }
};

inline ym2610b_handle *cast_handle(void *ptr) { return static_cast<ym2610b_handle *>(ptr); }

inline float normalize_sample(int32_t value)
{
    if (value < -32768) value = -32768;
    if (value > 32767) value = 32767;
    return static_cast<float>(value) / 32768.0f;
}

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

void ym2610b_generate(void *ptr, float *left, float *right, uint32_t frames)
{
    auto *handle = cast_handle(ptr);
    for (uint32_t index = 0; index < frames; index++)
    {
        ymfm::ym2610b::output_data output;
        handle->chip.generate(&output);
        handle->intf.advance_sample(handle->chip);
        left[index] = normalize_sample(output.data[0] + ((handle->mute_mask & 1) ? 0 : output.data[2]));
        right[index] = normalize_sample(output.data[1] + ((handle->mute_mask & 1) ? 0 : output.data[2]));
    }
}

}
