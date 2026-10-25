#pragma once
#include <cstdint>
struct NativeExtraOkim6258State {
    uint32_t clock, clock_buffer, divider, sample_bytes, position, fed_bytes;
    uint8_t pan, playing, streaming, repeat;
};
extern "C" {
void *native_extra_okim6258_create(uint32_t output_rate);
void native_extra_okim6258_destroy(void *);
void native_extra_okim6258_reset(void *);
void native_extra_okim6258_stop(void *);
int native_extra_okim6258_write(void *, uint8_t reg, uint8_t value);
int native_extra_okim6258_set_clock(void *, uint32_t clock);
// The caller retains immutable bytes until replaced or the core is destroyed.
// Binding, playback and rendering never copy, allocate, free or own the bytes.
int native_extra_okim6258_load_sample(void *, const uint8_t *bytes, uint32_t size);
int native_extra_okim6258_play(void *, uint8_t repeat);
void native_extra_okim6258_set_repeat(void *, uint8_t repeat);
void native_extra_okim6258_sample(void *, float *left, float *right);
void native_extra_okim6258_get_state(void *, NativeExtraOkim6258State *);
}
