#pragma once
#include <cstdint>

struct NativeMasterSystemState {
    uint8_t registers[64];
    uint16_t periods[3];
    uint8_t attenuation[4], levels[4];
    uint32_t psg_clock, opll_clock, psg_mute_mask, opll_mute_mask;
    uint8_t latch, noise_mode, status, irq;
};
extern "C" {
void *native_master_system_create(uint32_t output_rate);
void native_master_system_destroy(void *);
// chip: 0 = mono Sega PSG, 1 = YM2413, 2 = both (reset/stop only).
void native_master_system_reset(void *, uint8_t chip);
void native_master_system_stop(void *, uint8_t chip);
// voice: PSG 0..3, OPLL 4..12, drums 13..17 (BD, SD, TOM, CYM, HH).
void native_master_system_key_off(void *, uint8_t voice);
// OPLL preview releases for one ordinary source interval before key on.
void native_master_system_audition_key_on(void *, uint8_t voice);
void native_master_system_write(void *, uint8_t chip, uint8_t reg, uint8_t value);
void native_master_system_sample(void *, float *psg_left, float *psg_right, float *opll_left, float *opll_right);
int native_master_system_set_clock(void *, uint8_t chip, uint32_t clock);
void native_master_system_set_mute_mask(void *, uint8_t chip, uint32_t mask);
uint8_t native_master_system_read(void *, uint8_t offset);
uint8_t native_master_system_read_status(void *);
uint8_t native_master_system_get_irq(void *);
void native_master_system_get_state(void *, NativeMasterSystemState *);
}
