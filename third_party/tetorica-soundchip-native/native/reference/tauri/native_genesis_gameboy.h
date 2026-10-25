// SPDX-License-Identifier: BSD-3-Clause
#pragma once
#include <cstdint>

struct NativeGameboyState {
    uint8_t registers[48];
    uint32_t active_mask;
    uint32_t clock;
    uint32_t source_mute_mask;
};
extern "C" {
void *native_gameboy_create(uint32_t rate);
void native_gameboy_destroy(void *ptr);
void native_gameboy_reset(void *ptr);
void native_gameboy_stop(void *ptr);
void native_gameboy_stop_channel(void *ptr, uint8_t channel);
void native_gameboy_write(void *ptr, uint8_t address, uint8_t value);
int native_gameboy_set_clock(void *ptr, uint32_t hz);
void native_gameboy_set_mute_mask(void *ptr, uint32_t mask);
void native_gameboy_sample(void *ptr, float *left, float *right);
void native_gameboy_get_state(void *ptr, NativeGameboyState *state);
}
