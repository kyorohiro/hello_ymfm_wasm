// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro
#pragma once
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
/* Experimental CPU-free MAME SCSP instrument: 32 slots, private 512 KiB RAM,
 * fixed 44,100 Hz stereo. No BIOS, CPU, sound device, scheduler or file I/O.
 * All offsets are byte offsets relative to SCSP register base, not bus addresses.
 * Each handle must be used by one thread at a time. Returns 1 on success, 0 on
 * invalid/unsupported input; read returns 0xffffffff on invalid access.
 * Slot registers 0x000..0x3fe; master 0x400; DSP config 0x402; monitor 0x408;
 * ring/DSP reads 0x600..0xee2. Ring, COEF, MADRS, MPRO writes 0x600..0xbfe
 * except reserved 0x7c0..0x7fe. Word offsets must be even. Mask uses set bits
 * for written bits. Master accepts only MEM4B=1, DAC18B, MVOL. CPU timer/IRQ,
 * DMA, serial MIDI and external input are not exposed. Unsupported writes
 * fail before changing registers. FM/LFO/DSP are retained but experimental.
 */
void *scsp_create(void);
void scsp_destroy(void *handle);
int scsp_reset(void *handle,int clear_ram);
uint32_t scsp_sample_rate(void);
int scsp_write(void *handle,uint32_t byte_offset,uint16_t value,uint16_t mask);
uint32_t scsp_read(void *handle,uint32_t byte_offset);
/* RAM upload/readback uses original bytes. PCM8 is signed; PCM16 is big endian.
 * Host access rejects out-of-range transfers; internal chip reads wrap RAM. */
int scsp_load_ram(void *handle,uint32_t address,const uint8_t *data,uint32_t bytes);
int scsp_read_ram(void *handle,uint32_t address,uint8_t *data,uint32_t bytes);
/* Caller-owned nonoverlapping arrays, at most 1,048,576 frames. Zero frames is
 * a no-op permitting null output pointers. No allocation occurs in render. */
int scsp_render(void *handle,float *left,float *right,uint32_t frames);
#ifdef __cplusplus
}
#endif
