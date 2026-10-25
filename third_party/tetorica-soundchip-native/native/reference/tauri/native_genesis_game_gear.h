#pragma once
#include <cstdint>

struct NativeGameGearState {
    uint16_t periods[3];
    uint8_t attenuation[4], levels[4];
    uint32_t clock, mute_mask;
    uint8_t latch, noise_mode, stereo;
};
extern "C" {
void *native_game_gear_create(uint32_t output_rate);
void native_game_gear_destroy(void *);
void native_game_gear_reset(void *);
void native_game_gear_stop(void *);
void native_game_gear_write(void *, uint8_t value);
void native_game_gear_key_off(void *, uint8_t channel);
void native_game_gear_audition_key_on(void *, uint8_t channel);
void native_game_gear_sample(void *, float *left, float *right);
int native_game_gear_set_clock(void *, uint32_t clock);
void native_game_gear_set_mute_mask(void *, uint32_t mask);
void native_game_gear_set_stereo(void *, uint8_t mask);
void native_game_gear_get_state(void *, NativeGameGearState *);
}
