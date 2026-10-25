// SPDX-License-Identifier: BSD-3-Clause
#pragma once
#include <stddef.h>
#include <stdint.h>

struct NativeHuc6280State {
    uint8_t selected;
    uint8_t globals[10];
    uint8_t registers[8][8];
    uint8_t waveforms[8][32];
    uint8_t indices[8];
    uint8_t dda[8];
    uint32_t clock;
};
extern "C" {
void *native_huc6280_create(uint32_t rate);
size_t native_huc6280_core_size();
void native_huc6280_destroy(void *ptr);
void native_huc6280_reset(void *ptr);
void native_huc6280_stop(void *ptr);
void native_huc6280_write(void *ptr, uint32_t reg, uint8_t value, int32_t channel);
void native_huc6280_waveform(void *ptr, uint32_t channel, const uint8_t *samples);
void native_huc6280_key_off(void *ptr, uint32_t channel);
void native_huc6280_set_mute_mask(void *ptr, uint32_t mask);
int32_t native_huc6280_set_clock(void *ptr, uint32_t hz);
void native_huc6280_sample(void *ptr, float *left, float *right);
void native_huc6280_get_state(void *ptr, NativeHuc6280State *out);
}
