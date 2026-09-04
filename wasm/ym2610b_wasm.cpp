#include <cstdint>

#include "ymfm.h"
#include "ymfm_opn.h"

namespace
{

struct ym2610b_wasm_interface : public ymfm::ymfm_interface
{
    bool irq_asserted = false;

    // FM-only uses no sample ROM. ADPCM-A/B support adds ROM-backed reads later.
    uint8_t ymfm_external_read(ymfm::access_class, uint32_t) override { return 0; }

    void ymfm_update_irq(bool asserted) override { irq_asserted = asserted; }
};

struct ym2610b_handle
{
    ym2610b_wasm_interface intf;
    ymfm::ym2610b chip;

    ym2610b_handle() : intf(), chip(intf) { chip.reset(); }
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
void ym2610b_destroy(void *ptr) { delete cast_handle(ptr); }
void ym2610b_reset(void *ptr) { cast_handle(ptr)->chip.reset(); }
void ym2610b_write(void *ptr, uint32_t offset, uint8_t data) { cast_handle(ptr)->chip.write(offset, data); }
uint8_t ym2610b_read(void *ptr, uint32_t offset) { return cast_handle(ptr)->chip.read(offset); }
uint8_t ym2610b_read_status(void *ptr) { return cast_handle(ptr)->chip.read_status(); }
uint8_t ym2610b_read_status_hi(void *ptr) { return cast_handle(ptr)->chip.read_status_hi(); }
uint8_t ym2610b_get_irq(void *ptr) { return cast_handle(ptr)->intf.irq_asserted ? 1 : 0; }
uint32_t ym2610b_sample_rate(void *ptr, uint32_t clock) { return cast_handle(ptr)->chip.sample_rate(clock); }

void ym2610b_generate(void *ptr, float *left, float *right, uint32_t frames)
{
    auto *handle = cast_handle(ptr);
    for (uint32_t index = 0; index < frames; index++)
    {
        ymfm::ym2610b::output_data output;
        handle->chip.generate(&output);
        left[index] = normalize_sample(output.data[0]);
        right[index] = normalize_sample(output.data[1]);
    }
}

}
