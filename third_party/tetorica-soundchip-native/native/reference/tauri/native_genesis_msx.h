#pragma once
#include <cstdint>

struct NativeMsxState {
    uint8_t registers[64], ay_registers[16], levels[3];
    uint32_t ay_clock, opll_clock, ay_mute_mask, opll_mute_mask;
    uint8_t status, irq;
};
extern "C" {
void *native_msx_create(uint32_t output_rate);
void native_msx_destroy(void *);
// chip: 0 = AY-3-8910, 1 = YM2413, 2 = both (reset/stop only).
void native_msx_reset(void *, uint8_t chip);
void native_msx_stop(void *, uint8_t chip);
// voice: AY 0..2, OPLL 3..11, drums 12..16 (BD, SD, TOM, CYM, HH).
void native_msx_key_off(void *, uint8_t voice);
void native_msx_audition_key_on(void *, uint8_t voice);
void native_msx_set_retained_level(void *, uint8_t channel, uint8_t level);
void native_msx_write(void *, uint8_t chip, uint8_t reg, uint8_t value);
void native_msx_sample(void *, float *ay_left, float *ay_right, float *opll_left, float *opll_right);
int native_msx_set_clock(void *, uint8_t chip, uint32_t clock);
void native_msx_set_mute_mask(void *, uint8_t chip, uint32_t mask);
uint8_t native_msx_read(void *, uint8_t chip, uint8_t reg);
uint8_t native_msx_read_status(void *);
uint8_t native_msx_get_irq(void *);
void native_msx_get_state(void *, NativeMsxState *);
}
