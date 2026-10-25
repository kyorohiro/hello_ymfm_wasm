#pragma once
#include <cstdint>

struct NativeYm2612State {
    uint8_t registers[512];
    uint32_t clock, channel_mute_mask;
    uint8_t keys[6], status, irq;
};
extern "C" {
void *native_ym2612_create(uint32_t output_rate);
void native_ym2612_destroy(void *);
void native_ym2612_reset(void *);
void native_ym2612_stop(void *);
void native_ym2612_write(void *, uint8_t port, uint8_t reg, uint8_t value);
// Cancellation silences immediately. An ordinary 0x28 write retains release.
void native_ym2612_key_off(void *, uint8_t channel);
// Release a normal FM lease while an independently owned CH3 CSM source runs.
void native_ym2612_key_off_fm(void *, uint8_t channel);
// Release the Timer-A/CSM source without stealing an independent normal CH3 key.
void native_ym2612_cancel_csm(void *);
void native_ym2612_audition_fm_key_on(void *, uint8_t channel, uint8_t operator_mask);
void native_ym2612_sample(void *, float *left, float *right);
int native_ym2612_set_clock(void *, uint32_t clock);
void native_ym2612_set_mute_mask(void *, uint32_t mask);
uint8_t native_ym2612_read(void *, uint8_t offset);
uint8_t native_ym2612_read_status(void *);
uint8_t native_ym2612_get_irq(void *);
void native_ym2612_get_state(void *, NativeYm2612State *);
}
