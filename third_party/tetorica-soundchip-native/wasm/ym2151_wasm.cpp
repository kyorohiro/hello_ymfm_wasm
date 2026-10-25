#include "opn_state.h"
#include <cstdint>
#include <memory>

#include "ymfm_wasm_interface.h"
#include "ymfm_opm.h"

namespace
{

// The bundled ymfm OPP variant shares the FM core; apply its Timer B divider.
struct opm_interface : ymfm_wasm_interface
{
    bool opp = false;
    void ymfm_set_timer(uint32_t timer, int32_t clocks) override
    {
        ymfm_wasm_interface::ymfm_set_timer(timer,
            opp && timer == 1 && clocks >= 0 ? clocks * 2 : clocks);
    }
};

struct ym2151_handle
{
    opm_interface intf;
    std::unique_ptr<ymfm::ym2151> opm;
    std::unique_ptr<ymfm::ym2164> opp;
    ymfm::ym2151 &chip;
    uint32_t mute_mask = 0;

    explicit ym2151_handle(bool is_ym2164 = false) : intf(),
        opm(is_ym2164 ? nullptr : new ymfm::ym2151(intf)),
        opp(is_ym2164 ? new ymfm::ym2164(intf) : nullptr),
        chip(is_ym2164 ? *opp : *opm)
    {
        intf.opp = is_ym2164;
        chip.reset();
    }
};

inline ym2151_handle *cast_handle(void *ptr)
{
    return static_cast<ym2151_handle *>(ptr);
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

void *ym2151_create()
{
    return new ym2151_handle();
}

void *ym2164_create()
{
    return new ym2151_handle(true);
}

void ym2151_destroy(void *ptr)
{
    delete cast_handle(ptr);
}

void ym2151_reset(void *ptr)
{
    cast_handle(ptr)->chip.reset();
}

void ym2151_write(void *ptr, uint32_t offset, uint8_t data)
{
    cast_handle(ptr)->chip.write(offset, data);
}

uint8_t ym2151_read(void *ptr, uint32_t offset)
{
    return cast_handle(ptr)->chip.read(offset);
}

uint8_t ym2151_read_status(void *ptr)
{
    return cast_handle(ptr)->chip.read_status();
}

uint8_t ym2151_get_irq(void *ptr)
{
    return cast_handle(ptr)->intf.irq_asserted ? 1 : 0;
}

uint32_t ym2151_sample_rate(void *ptr, uint32_t clock)
{
    return cast_handle(ptr)->chip.sample_rate(clock);
}

void ym2151_set_mute_mask(void *ptr, uint32_t mask)
{
    cast_handle(ptr)->mute_mask = mask;
    cast_handle(ptr)->chip.set_mute_mask(mask);
}

void ym2151_generate(void *ptr, float *left, float *right, uint32_t frames)
{
    auto *handle = cast_handle(ptr);
    for (uint32_t index = 0; index < frames; index++)
    {
        ymfm::ym2151::output_data output;
        handle->chip.generate(&output);
        handle->intf.advance_sample(handle->chip);
        left[index] = normalize_sample(output.data[0]);
        right[index] = normalize_sample(output.data[1]);
    }
}


uint32_t ym2151_save_state(void *ptr, uint8_t *out) {
    auto *h = cast_handle(ptr);
    return save_opn_state(h->chip, h->intf, {&h->mute_mask}, {}, out);
}
int ym2151_load_state(void *ptr, const uint8_t *data, uint32_t size) {
    auto *h = cast_handle(ptr);
    if (!load_opn_state(h->chip, h->intf, {&h->mute_mask}, {}, data, size)) return 0;
    h->chip.set_mute_mask(h->mute_mask); return 1;
}
}
