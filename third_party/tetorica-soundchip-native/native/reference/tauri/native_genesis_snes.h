// SPDX-License-Identifier: LGPL-2.1-or-later
#pragma once
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct NativeSnesState {
  uint8_t registers[128];
  uint64_t native_frames;
  uint32_t timeline_loaded, timeline_playing, timeline_position, timeline_total;
} NativeSnesState;
void* native_snes_create(uint32_t rate);
uint32_t native_snes_core_size(void);
void native_snes_destroy(void*);
void native_snes_reset(void*);
void native_snes_stop(void*);
void native_snes_write(void*, uint8_t reg, uint8_t value);
void native_snes_write_protected(void*, uint8_t reg, uint8_t value, uint8_t mask);
void native_snes_key_on(void*, uint8_t channel);
void native_snes_key_off(void*, uint8_t channel);
int native_snes_load(void*, const uint8_t*, uint32_t address, uint32_t size);
void native_snes_sample(void*, float* left, float* right);
void native_snes_get_state(void*, NativeSnesState*);
void native_snes_get_ram(void*, uint8_t* output);
// Stable read-only view of the Core-owned, initialized 65536-byte allocation.
// Valid until destruction; caller must exclude core mutation while reading it.
const uint8_t* native_snes_ram_data(const void*);
uint8_t native_snes_read_memory(void*, uint16_t address);
// Borrowed immutable storage remains alive until reset/stop/another preparation.
void native_snes_prepare_timeline(void*, const uint8_t* ram, const uint8_t* dsp,
                                 const uint32_t* events, uint32_t event_count,
                                 uint32_t duration_clocks);
void native_snes_play_timeline(void*);
void native_snes_stop_timeline(void*);
#ifdef __cplusplus
}
#endif
