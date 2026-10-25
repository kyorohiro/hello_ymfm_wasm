#pragma once
// Copyright 2026 Tetorica contributors. BSD-3-Clause; see LICENSE.
// Alternative LGPL-2.1-or-later engine; see vendor/nuked-opn2/LICENSE.
// Existing Native policy ABI and raw Browser-compatible synchronous C ABI.
// Neither API applies a machine mix, source gain or DC filter. Serialize every
// handle's access. Do not call the private OPN2_SetChipType provider directly.
#include "native_genesis_ym2612.h"

extern "C" {
void *native_nuked_ym2612_create(uint32_t output_rate);
void native_nuked_ym2612_destroy(void *);
void native_nuked_ym2612_reset(void *);
void native_nuked_ym2612_stop(void *);
void native_nuked_ym2612_write(void *, uint8_t port, uint8_t reg, uint8_t value);
void native_nuked_ym2612_key_off(void *, uint8_t channel);
void native_nuked_ym2612_key_off_fm(void *, uint8_t channel);
void native_nuked_ym2612_cancel_csm(void *);
void native_nuked_ym2612_audition_fm_key_on(void *, uint8_t channel, uint8_t operator_mask);
void native_nuked_ym2612_sample(void *, float *left, float *right);
int native_nuked_ym2612_set_clock(void *, uint32_t clock);
void native_nuked_ym2612_set_mute_mask(void *, uint32_t mask);
uint8_t native_nuked_ym2612_read(void *, uint8_t offset);
uint8_t native_nuked_ym2612_read_status(void *);
uint8_t native_nuked_ym2612_get_irq(void *);
void native_nuked_ym2612_get_state(void *, NativeYm2612State *);

// Raw source-rate API. offset 0/2 selects an address and 1/3 writes data;
// each write advances 24 internal cycles. sample_rate returns clock/144.
// All arrays passed to generate must have at least frames writable floats.
void *tetorica_nuked_create(void);
void tetorica_nuked_destroy(void *);
void tetorica_nuked_reset(void *);
void tetorica_nuked_write(void *, uint32_t offset, uint8_t value);
uint8_t tetorica_nuked_read(void *, uint32_t offset);
uint8_t tetorica_nuked_read_status(void *);
uint8_t tetorica_nuked_get_irq(void *);
uint32_t tetorica_nuked_sample_rate(void *, uint32_t clock);
void tetorica_nuked_generate(void *, float *left, float *right, uint32_t frames);
// Envelope outputs are zero for this backend; PCM is identical to generate.
void tetorica_nuked_generate_with_internal_envelope(void *, float *left, float *right,
    float *env0, float *env1, float *env2, float *env3, uint32_t frames, uint32_t channel_index);
}
