#pragma once
#include <cstdint>

struct NativeOplState {
    uint8_t registers[512];
    uint32_t clock, mute_mask;
    uint8_t kind, channels, status, irq;
};
extern "C" {
uint64_t native_opl_memory_revision(void *);
uint64_t native_opl_memory_upload_revision(void *);
// Callback installs control-owned writable ADPCM pages; Y8950 only.
void native_opl_memory_page(void *, uint32_t index, uint8_t *page);
void native_opl_memory_length(void *, uint32_t bytes);
void native_opl_cancel_adpcm(void *);
// kind: 0 YM3526, 1 YM3812, 2 YMF262, 3 Y8950. One selected core is constructed.
void *native_opl_create(uint32_t output_rate, uint8_t kind);
void native_opl_destroy(void *);
void native_opl_reset(void *);
void native_opl_stop(void *);
void native_opl_write(void *, uint16_t reg, uint8_t value);
// voices 0..17: FM; 18..22: BD, SD, TOM, CYM, HH; 23: Y8950 ADPCM.
void native_opl_key_off(void *, uint8_t voice);
void native_opl_audition_key_on(void *, uint8_t voice);
void native_opl_sample(void *, float *left, float *right);
int native_opl_set_clock(void *, uint32_t clock);
void native_opl_set_mute_mask(void *, uint32_t mask);
uint8_t native_opl_read(void *, uint8_t offset);
uint8_t native_opl_read_status(void *);
uint8_t native_opl_get_irq(void *);
void native_opl_get_state(void *, NativeOplState *);
}
