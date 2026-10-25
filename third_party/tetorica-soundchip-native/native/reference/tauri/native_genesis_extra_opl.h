#pragma once
#include <cstdint>
struct NativeExtraOplState {
    uint8_t registers[512];
    uint32_t clock;
    uint8_t kind, channels, status, irq;
};
extern "C" {
uint64_t native_extra_opl_memory_revision(void *);
uint64_t native_extra_opl_memory_upload_revision(void *);
// Callback installs control-owned writable ADPCM pages; Y8950 only.
void native_extra_opl_memory_page(void *, uint32_t index, uint8_t *page);
void native_extra_opl_memory_length(void *, uint32_t bytes);
void native_extra_opl_cancel_adpcm(void *);
// Same selected kind IDs as primary: 0 YM3526, 1 YM3812, 2 YMF262, 3 Y8950.
void *native_extra_opl_create(uint32_t output_rate, uint8_t kind);
void native_extra_opl_destroy(void *);
void native_extra_opl_reset(void *);
void native_extra_opl_all_notes_off(void *);
void native_extra_opl_host_all_notes_off(void *);
void native_extra_opl_stop(void *);
void native_extra_opl_write(void *, uint16_t reg, uint8_t value);
// FM0..8 (OPL3 0..17), BD/SD/TOM/CYM/HH18..22, Y8950 ADPCM23.
void native_extra_opl_key_off(void *, uint8_t voice);
void native_extra_opl_key_off_fm(void *, uint8_t channel);
void native_extra_opl_preview_key_off(void *, uint8_t voice);
void native_extra_opl_audition_key_on(void *, uint8_t voice);
void native_extra_opl_source_preview_key_off(void *, uint8_t voice);
void native_extra_opl_source_audition_key_on(void *, uint8_t voice);
void native_extra_opl_cancel_csm(void *);
uint8_t native_extra_opl_csm_active(void *);
uint8_t native_extra_opl_four_op_mask(void *);
uint8_t native_extra_opl_effective_register(void *, uint16_t reg);
void native_extra_opl_get_effective_registers(void *, uint8_t *output512);
void native_extra_opl_cancel_adpcm(void *);
void native_extra_opl_sample(void *, float *left, float *right);
int native_extra_opl_set_clock(void *, uint32_t clock);
uint8_t native_extra_opl_read(void *, uint8_t offset);
uint8_t native_extra_opl_read_status(void *);
uint8_t native_extra_opl_get_irq(void *);
void native_extra_opl_get_state(void *, NativeExtraOplState *);
}
