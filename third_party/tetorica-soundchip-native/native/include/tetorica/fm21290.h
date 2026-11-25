// SPDX-License-Identifier: BSD-3-Clause
#pragma once
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
/* YM21290 EGS / YM21280 OPS register model. One instance per audio stream.
 * Supply an output rate of 8000..384000 Hz. Writes accept the modeled
 * CPU addresses (including the 0x30f1 gate register) and an 8-bit value.
 * Render replaces the caller's mono buffer. Calls return 1 on success, 0
 * on invalid input. No allocation takes place during writes or rendering. */
typedef struct fm21290_chip fm21290_chip;
fm21290_chip* fm21290_create(unsigned sample_rate);
void fm21290_destroy(fm21290_chip* chip);
int fm21290_write(fm21290_chip* chip, unsigned address, unsigned value);
int fm21290_render(fm21290_chip* chip, float* output, size_t frames);
#ifdef __cplusplus
}
#endif
