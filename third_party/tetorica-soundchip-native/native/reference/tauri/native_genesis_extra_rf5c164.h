#pragma once
#include <cstdint>
struct NativeExtraRf5c164State {
    uint8_t registers[8][7];
    uint8_t control, selected, mask, resampling;
    uint32_t clock, addresses[8];
    uint16_t bank, reserved;
};
extern "C" {
void *native_extra_rf5c164_create(uint32_t output_rate);
void native_extra_rf5c164_destroy(void *);
void native_extra_rf5c164_reset(void *);
void native_extra_rf5c164_write(void *, uint8_t reg, uint8_t value);
void native_extra_rf5c164_write_memory(void *, uint16_t offset, uint8_t value);
int native_extra_rf5c164_load(void *, const uint8_t *bytes, uint32_t offset, uint32_t size);
void native_extra_rf5c164_clear_memory(void *);
void native_extra_rf5c164_sample(void *, float *left, float *right);
int native_extra_rf5c164_set_clock(void *, uint32_t clock);
uint8_t native_extra_rf5c164_read(void *, uint8_t offset);
uint8_t native_extra_rf5c164_read_memory(void *, uint16_t offset);
int native_extra_rf5c164_read_memory_range(void *, uint8_t *bytes, uint32_t offset, uint32_t size);
void native_extra_rf5c164_get_state(void *, NativeExtraRf5c164State *);
// Runtime source cancellation: clear only this voice's cached contribution.
// Public register 8 writes retain the reference core's ordinary held output.
void native_extra_rf5c164_key_off(void *, uint8_t channel);
void native_extra_rf5c164_stop(void *);
}
