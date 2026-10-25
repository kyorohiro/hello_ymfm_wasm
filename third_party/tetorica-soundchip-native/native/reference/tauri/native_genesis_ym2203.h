#pragma once
#include <cstdint>

struct NativeYm2203State {
    uint8_t registers[256];
    uint32_t clock, source_mute_mask, channel_mute_mask;
    uint8_t keys[3], ssg_levels[3], prescaler, status, irq;
};
extern "C" {
void *native_ym2203_create(uint32_t output_rate);
// Additional OPN Worklet profile: reset also clears output-rate hold/remainder.
void *native_ym2203_create_extra(uint32_t output_rate);
void native_ym2203_destroy(void *);
void native_ym2203_reset(void *);
void native_ym2203_stop(void *);
void native_ym2203_write(void *, uint8_t port, uint8_t reg, uint8_t value);
// Voices 0..2 are FM; 3..5 are SSG. Ordinary register key-off keeps release.
void native_ym2203_key_off(void *, uint8_t voice);
void native_ym2203_key_off_fm(void *, uint8_t voice);
void native_ym2203_cancel_csm(void *);
void native_ym2203_audition_key_on(void *, uint8_t voice);
void native_ym2203_audition_fm_key_on(void *, uint8_t channel, uint8_t operator_mask);
void native_ym2203_set_retained_ssg_level(void *, uint8_t channel, uint8_t level);
void native_ym2203_sample(void *, float *left, float *right);
int native_ym2203_set_clock(void *, uint32_t clock);
// Source bit0 = SSG (same as WASM); bit1 = FM. Channel bits0..2 mute FM.
void native_ym2203_set_source_mute_mask(void *, uint32_t mask);
void native_ym2203_set_mute_mask(void *, uint32_t mask);
uint8_t native_ym2203_read(void *, uint8_t offset);
uint8_t native_ym2203_read_status(void *);
uint8_t native_ym2203_get_irq(void *);
void native_ym2203_get_state(void *, NativeYm2203State *);
}
