// Native Nuked adapter, copyright 2026 Tetorica contributors.
// Licensed under GNU LGPL version 2.1 or (at your option) any later version.
// See ../native-nuked/LICENSE. Provided without warranty.
// Macro-only namespacing of the unmodified Browser Nuked C wrapper.
// Chip type is process-global upstream; initialize it once before the first
// core is published, so later constructors cannot race an audio callback.
#include <cstdint>
#include <cstdlib>
#include <mutex>
extern "C" void tetorica_nuked_OPN2_SetChipType(uint32_t);
extern "C" void tetorica_nuked_select_chip_type_once(uint32_t type) {
    static std::once_flag selected;
    std::call_once(selected, [type] { tetorica_nuked_OPN2_SetChipType(type); });
}
#define OPN2_Reset tetorica_nuked_OPN2_Reset
#define OPN2_SetChipType tetorica_nuked_select_chip_type_once
#define OPN2_Clock tetorica_nuked_OPN2_Clock
#define OPN2_Write tetorica_nuked_OPN2_Write
#define OPN2_SetTestPin tetorica_nuked_OPN2_SetTestPin
#define OPN2_ReadTestPin tetorica_nuked_OPN2_ReadTestPin
#define OPN2_ReadIRQPin tetorica_nuked_OPN2_ReadIRQPin
#define OPN2_Read tetorica_nuked_OPN2_Read
#define ym2612_create tetorica_nuked_create
#define ym2612_destroy tetorica_nuked_destroy
#define ym2612_reset tetorica_nuked_reset
#define ym2612_write tetorica_nuked_write
#define ym2612_read tetorica_nuked_read
#define ym2612_read_status tetorica_nuked_read_status
#define ym2612_get_irq tetorica_nuked_get_irq
#define ym2612_sample_rate tetorica_nuked_sample_rate
#define ym2612_generate tetorica_nuked_generate
#define ym2612_generate_with_internal_envelope tetorica_nuked_generate_with_internal_envelope
#ifdef TETORICA_NUKED_AUDIT_ALLOCATIONS
extern "C" void *tetorica_nuked_fixture_malloc(std::size_t);
extern "C" void tetorica_nuked_fixture_free(void *);
#define malloc tetorica_nuked_fixture_malloc
#define free tetorica_nuked_fixture_free
#endif
extern "C" {
#include "nuked_opn2_wasm.c"
}

#include "native_genesis_nuked_ym2612.inc"
