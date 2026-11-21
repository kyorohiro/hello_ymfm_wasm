// SPDX-License-Identifier: BSD-3-Clause
#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Experimental Saturn sound-board renderer. The caller supplies a complete
 * 512 KiB big-endian sound RAM image already assembled from SSF/SSFLib.
 * The renderer copies the image and starts the 68000 at its reset vector.
 * Use one thread at a time per handle. Native output is 44,100 Hz stereo. */
void *scsp_ssf_create(const uint8_t *ram, uint32_t size);
void scsp_ssf_destroy(void *handle);

/* Write up to 1,048,576 frames to nonoverlapping buffers. Returns 1 on
 * success, or 0 for invalid arguments or an unsupported bus access. After
 * a bus fault, discard the whole output block and recreate the renderer. */
int scsp_ssf_render(void *handle, float *left, float *right, uint32_t frames);

/* First unsupported bus address, or UINT32_MAX if no fault occurred. */
uint32_t scsp_ssf_fault_address(const void *handle);

#ifdef __cplusplus
}
#endif
