// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro
#ifndef TETORICA_PS1_SPU_H
#define TETORICA_PS1_SPU_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

/* Fixed 44,100 Hz, 24-voice, 512 KiB MAME-derived experimental instrument core.
 * All integer return values are 1 on success and 0 on invalid/unsupported input.
 * Register addresses are even byte offsets 0..0x3fe relative to 0x1f801c00.
 * Volume sweeps and nonstandard RAM-control modes are unsupported and rejected.
 * Uploading RAM invalidates overlapping decoded sample caches. First 0x1000 RAM
 * bytes are capture buffers, overwritten by rendering; place samples above them.
 * Each handle is independent. A handle must not be accessed concurrently.
 */
void *ps1_spu_create(void);
void ps1_spu_destroy(void *handle);
int ps1_spu_reset(void *handle, int clear_ram);
uint32_t ps1_spu_sample_rate(void);
int ps1_spu_write(void *handle, uint32_t byte_offset, uint16_t value);
/* Instrument-editor extensions, not hardware register-write semantics.
 * Refresh applies the latched ADSR registers to the current envelope without
 * restarting sample playback or resetting its level. channel is 0..23.
 * Audition key-on uses a 128-frame fade before restarting an active voice and
 * a 128-frame fade-in. Key-off preserves slower/infinite programmed release,
 * limiting only faster release to at least 128 native frames. on is 0 or 1.
 * Both key-off paths use ADSR rates latched by key-on or explicit refresh;
 * deferred ADSR register edits are not applied implicitly when releasing.
 * Raw key-on/key-off register writes keep their original behavior. */
int ps1_spu_refresh_envelope(void *handle, uint32_t channel);
int ps1_spu_audition_key(void *handle, uint32_t channel, int on);
/* Invalid handle/offset returns 0xffffffff; valid register values are 16-bit. */
uint32_t ps1_spu_read(void *handle, uint32_t byte_offset);
int ps1_spu_load_ram(void *handle, uint32_t byte_address, const uint8_t *data, uint32_t length);
int ps1_spu_read_ram(void *handle, uint32_t byte_address, uint8_t *data, uint32_t length);
/* Finite normalized stereo PCM, frames <= 1,048,576; nonoverlapping output arrays.
 * Zero frames is a no-op and permits null output pointers. */
/* Optional software mixer, not a PS1 register. divisor 1 (default) retains
 * original saturation. 2..32 mixes in a wide accumulator before attenuation,
 * retaining fractional dry output precision. Set before rendering or reset;
 * changing the divisor discards queued output. Reset preserves the divisor. */
int ps1_spu_set_mix_headroom(void *handle, uint32_t divisor);
/* Optional software PCM bank, outside the physical RAM/address registers.
 * Copies signed mono PCM at the source rate declared by the host's tuning.
 * frames <= 79,380,000 (30 min at 44.1 kHz); zero clears the bank.
 * Mask selects the voices using this bank at their next key-on; bits 0..23.
 * Loops require at least 4 frames. Set/replace while stopped. Reset preserves the bank and mask. */
int ps1_spu_set_host_pcm(void *handle, const int16_t *pcm, uint32_t frames, int loop);
int ps1_spu_set_host_mask(void *handle, uint32_t mask);
int ps1_spu_render(void *handle, float *left, float *right, uint32_t frames);
#ifdef __cplusplus
}
#endif
#endif
