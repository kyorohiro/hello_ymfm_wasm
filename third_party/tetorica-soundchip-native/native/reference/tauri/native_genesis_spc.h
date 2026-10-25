// SPDX-License-Identifier: LGPL-2.1-or-later
#pragma once
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct NativeSpcState {
    uint64_t native_frames, base_native_frames, output_frames;
    double playback_native_frames;
    uint32_t sample_rate, loaded, playing, mute_mask, failed;
} NativeSpcState;
typedef struct NativeSpcEvent { uint64_t clock; uint32_t reg, value; } NativeSpcEvent;
void *native_spc_create(uint32_t rate);
void native_spc_destroy(void *);
uint32_t native_spc_core_size(void);
const char *native_spc_error(const void *);
// Control-only operations. Never call on a Core already installed on a callback.
// Input is copied by SNES_SPC; the original file is retained by the Rust host.
int native_spc_load_control(void *, const uint8_t *, uint32_t size);
int native_spc_seek_control(void *, uint32_t frames);
// Callback-only controls and rendering; no allocation, destruction, or locks.
int native_spc_set_playing(void *, uint32_t playing);
int native_spc_set_mute_mask(void *, uint32_t mask);
void native_spc_sample(void *, float *left, float *right);
void native_spc_get_state(const void *, NativeSpcState *);
// snapshot needs a caller-owned 0x10200-byte workspace. Public analysis RAM is
// [0x100,0x10100); DSP registers are [0x10100,0x10180). This is not a full state.
int native_spc_snapshot(void *, uint8_t *output, uint32_t size);
void native_spc_read_dsp_registers(const void *, uint8_t *output128);
int native_spc_observe(void *, uint32_t enabled, uint32_t capacity);
// Borrowed event storage: read/drain only while excluding Core mutation.
const NativeSpcEvent *native_spc_event_data(const void *);
uint32_t native_spc_event_count(const void *);
void native_spc_events_clear(void *);
uint32_t native_spc_overflow_take(void *);
#ifdef __cplusplus
}
#endif
