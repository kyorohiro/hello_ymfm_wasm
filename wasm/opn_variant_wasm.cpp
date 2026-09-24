// Shared binding for the OPN variants selected by each build script.
#include <algorithm>
#include <cstdint>
#include "ymfm_wasm_interface.h"
#include "ymfm_opn.h"

#ifndef OPN_VARIANT
#error OPN_VARIANT must name an ymfm chip class
#endif

namespace {
using Chip = ymfm::OPN_VARIANT;
struct Handle {
    ymfm_wasm_interface intf;
    Chip chip;
    Handle() : chip(intf) { chip.reset(); }
};
Handle *get(void *ptr) { return static_cast<Handle *>(ptr); }
float pcm(int32_t value) { return std::max(-32768, std::min(32767, value)) / 32768.0f; }
}
extern "C" {
void *opn_create() { return new Handle(); }
void opn_destroy(void *ptr) { delete get(ptr); }
void opn_reset(void *ptr) {
    auto *h = get(ptr);
    h->intf.timer_remaining[0] = h->intf.timer_remaining[1] = -1;
    h->intf.irq_asserted = false;
    h->chip.reset();
}
void opn_write(void *ptr, uint32_t offset, uint8_t value) { get(ptr)->chip.write(offset, value); }
uint8_t opn_read(void *ptr, uint32_t offset) { return get(ptr)->chip.read(offset); }
uint8_t opn_read_status(void *ptr) { return get(ptr)->chip.read_status(); }
uint32_t opn_get_irq(void *ptr) { return get(ptr)->intf.irq_asserted ? 1 : 0; }
uint32_t opn_sample_rate(void *ptr, uint32_t clock) { return get(ptr)->chip.sample_rate(clock); }
void opn_generate(void *ptr, float *left, float *right, uint32_t frames) {
    auto *h = get(ptr);
    for (uint32_t i = 0; i < frames; ++i) {
        Chip::output_data output;
        h->chip.generate(&output);
        h->intf.advance_sample(h->chip);
        left[i] = pcm(output.data[0]);
        right[i] = pcm(output.data[1]);
    }
}
}
