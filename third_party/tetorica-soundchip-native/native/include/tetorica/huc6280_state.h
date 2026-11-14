// SPDX-License-Identifier: BSD-3-Clause
#ifndef TETORICA_HUC6280_STATE_H
#define TETORICA_HUC6280_STATE_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
// Raw deterministic core handles. These are not native_huc6280_* wrapper
// handles: the wrapper has a separate outer clock resampler/observational API.
void *huc6280_create(uint32_t clock, uint32_t rate);
void huc6280_destroy(void *handle);
void huc6280_reset(void *handle);
void huc6280_mute(void *handle, uint32_t channel, uint32_t muted);
void huc6280_write(void *handle, uint32_t reg, uint32_t value);
void huc6280_generate(void *handle, float *left, float *right, uint32_t frames);
// Exact 512-byte LE format v1; save/validate/load return 1 on success, 0 on
// rejection. size(NULL)=0; null/incorrect-size buffers reject. Calls allocate
// no memory. Caller serializes access and provides readable/writable storage.
// Validation/load reject incompatible models, clocks, rates and malformed
// values without changing native state. Matching instances can share snapshots.
uint32_t huc6280_state_size(void *handle);
int huc6280_save_state(void *handle, uint8_t *data, uint32_t size);
int huc6280_validate_state(void *handle, const uint8_t *data, uint32_t size);
int huc6280_load_state(void *handle, const uint8_t *data, uint32_t size);
#ifdef __cplusplus
}
#endif
#endif
