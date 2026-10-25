#pragma once
#include <cstdint>
struct NativeAy8910State {
    uint8_t registers[16];
    uint32_t clock;
    uint8_t levels[3];
};
extern "C" {
void *native_ay8910_create(uint32_t output_rate);
void native_ay8910_destroy(void *);
void native_ay8910_reset(void *);
void native_ay8910_stop(void *);
void native_ay8910_all_notes_off(void *);
void native_ay8910_write(void *, uint8_t reg, uint8_t value);
void native_ay8910_key_off(void *, uint8_t channel);
void native_ay8910_preview_key_off(void *, uint8_t channel);
void native_ay8910_audition_key_on(void *, uint8_t channel);
void native_ay8910_set_retained_level(void *, uint8_t channel, uint8_t level);
void native_ay8910_sample(void *, float *left, float *right);
int native_ay8910_set_clock(void *, uint32_t clock);
uint8_t native_ay8910_read(void *, uint8_t reg);
void native_ay8910_get_state(void *, NativeAy8910State *);
}
