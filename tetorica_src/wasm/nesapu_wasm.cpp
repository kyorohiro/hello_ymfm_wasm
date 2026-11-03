// NES/FDS Browser ABI adapter. DSP lives only in the shared canonical core.
#include "nes_core.h"
#include <cstddef>
#include <cstdint>

// State contains fixed-width integers/arrays and doubles, never pointers. JS
// obtains offsets from the compiled layout, rather than assuming native ABI.
static_assert(sizeof(NativeNesState) == 400, "Unexpected NES state ABI size");
static_assert(offsetof(NativeNesState, clock) == 384, "Unexpected NES clock alignment");
namespace {
constexpr uint32_t OFFSETS[] = {
  offsetof(NativeNesState, registers),
  offsetof(NativeNesState, wave),
  offsetof(NativeNesState, modulation),
  offsetof(NativeNesState, periods),
  offsetof(NativeNesState, lengths),
  offsetof(NativeNesState, volumes),
  offsetof(NativeNesState, dmc_address),
  offsetof(NativeNesState, dmc_remaining),
  offsetof(NativeNesState, dmc_output),
  offsetof(NativeNesState, dmc_frequency),
  offsetof(NativeNesState, fds_frequency),
  offsetof(NativeNesState, fds_mod_frequency),
  offsetof(NativeNesState, fds_mod_index),
  offsetof(NativeNesState, fds_mod_clock),
  offsetof(NativeNesState, fds_mod_counter),
  offsetof(NativeNesState, fds_gain),
  offsetof(NativeNesState, fds_sweep_gain),
  offsetof(NativeNesState, fds_master),
  offsetof(NativeNesState, fds_accumulator),
  offsetof(NativeNesState, fds_output),
  offsetof(NativeNesState, enable_mask),
  offsetof(NativeNesState, mute_mask),
  offsetof(NativeNesState, fds_enabled),
  offsetof(NativeNesState, fds_io),
  offsetof(NativeNesState, fds_active),
  offsetof(NativeNesState, fds_write_enabled),
  offsetof(NativeNesState, fds_mod_enabled),
  offsetof(NativeNesState, frame_irq),
  offsetof(NativeNesState, dmc_irq),
  offsetof(NativeNesState, clock),
  offsetof(NativeNesState, base_clock),
};
}
extern "C" {
// Every frame takes the exact same core entry point used by Native output.
// Buffers are supplied/preallocated by the caller; no allocation or copies.
void nesapu_generate(void *core, float *left, float *right, uint32_t frames) {
  for (uint32_t i = 0; i < frames; ++i) {
    native_nes_sample(core, left + i, right + i);
  }
}
uint32_t nesapu_state_size() { return sizeof(NativeNesState); }
uint32_t nesapu_state_field_count() { return sizeof(OFFSETS) / sizeof(OFFSETS[0]); }
uint32_t nesapu_state_offset(uint32_t field) {
  return field < nesapu_state_field_count() ? OFFSETS[field] : UINT32_MAX;
}
}
