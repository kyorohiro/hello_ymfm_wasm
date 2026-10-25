#pragma once
#include <cstdint>
extern "C" {
void *native_rf5c164_create(uint32_t rate);
void native_rf5c164_destroy(void *chip);
void native_rf5c164_reset(void *chip);
void native_rf5c164_clear_memory(void *chip);
void native_rf5c164_write(void *chip, uint8_t reg, uint8_t value);
void native_rf5c164_write_memory(void *chip, uint16_t offset, uint8_t value);
int native_rf5c164_load(void *chip, const uint8_t *data, uint32_t offset, uint32_t size);
void native_rf5c164_sample(void *chip, float *left, float *right);
void native_rf5c164_set_clock(void *chip, uint32_t clock);
}
