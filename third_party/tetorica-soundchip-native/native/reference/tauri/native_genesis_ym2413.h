#pragma once
#include <cstdint>
struct NativeYm2413State {
    uint8_t registers[64];
    uint32_t clock;
    uint8_t status, irq;
};
extern "C" {
void *native_ym2413_create(uint32_t output_rate);
void native_ym2413_destroy(void *);
void native_ym2413_reset(void *);
void native_ym2413_stop(void *);
void native_ym2413_write(void *, uint8_t reg, uint8_t value);
// Logical voices: FM0..8, BD/SD/TOM/CYM/HH9..13.
void native_ym2413_key_off(void *, uint8_t voice);
// Public/manual preview release keeps the preceding resampler-held frame.
void native_ym2413_preview_key_off(void *, uint8_t voice);
void native_ym2413_audition_key_on(void *, uint8_t voice);
void native_ym2413_sample(void *, float *left, float *right);
int native_ym2413_set_clock(void *, uint32_t clock);
uint8_t native_ym2413_read(void *, uint8_t offset);
uint8_t native_ym2413_read_status(void *);
uint8_t native_ym2413_get_irq(void *);
void native_ym2413_get_state(void *, NativeYm2413State *);
}
