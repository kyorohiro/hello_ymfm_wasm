#pragma once
#include <cstdint>

// Applied register/status view. Inspection does not read ADPCM data or change IRQ.
struct NativeYm2608State {
    uint8_t registers[512];
    uint32_t clock;
    uint32_t source_mute_mask;
    uint8_t status;
    uint8_t status_hi;
    uint8_t irq;
};

// Additional-instance metadata. Keep the primary state ABI unchanged.
struct NativeYm2608ExtraState {
    uint8_t registers[512];
    uint32_t clock;
    uint32_t source_mute_mask;
    uint8_t keys[6];
    uint8_t ssg_levels[3];
    uint8_t prescaler;
    uint8_t status;
    uint8_t status_hi;
    uint8_t irq;
};

extern "C" {
void *native_ym2608_create(uint32_t output_rate);
void *native_ym2608_create_extra(uint32_t output_rate);
void native_ym2608_destroy(void *chip);
// Reset retains uploaded rhythm/ADPCM memory, clock and source mute settings.
void native_ym2608_reset(void *chip);
// Stop clears active voices while retaining their authored controls and memory.
void native_ym2608_stop(void *chip);
void native_ym2608_key_off(void *chip, uint8_t voice);
void native_ym2608_key_off_fm(void *chip, uint8_t voice);
void native_ym2608_cancel_csm(void *chip);
void native_ym2608_audition_fm_key_on(void *chip, uint8_t channel, uint8_t mask);
void native_ym2608_set_retained_ssg_level(void *chip, uint8_t channel, uint8_t level);
void native_ym2608_get_extra_state(void *chip, NativeYm2608ExtraState *state);
void native_ym2608_write(void *chip, uint8_t port, uint8_t reg, uint8_t value);
void native_ym2608_sample(void *chip, float *left, float *right);
int native_ym2608_set_clock(void *chip, uint32_t clock);
void native_ym2608_set_source_mute_mask(void *chip, uint32_t mask);
int native_ym2608_load_rom(void *chip, const uint8_t *bytes, uint32_t offset, uint32_t size);
int native_ym2608_load_memory(void *chip, const uint8_t *bytes, uint32_t offset, uint32_t size);
void native_ym2608_clear_memory(void *chip);
int native_ym2608_copy_memory(void *chip, uint8_t *bytes, uint32_t offset, uint32_t size);
uint8_t native_ym2608_read(void *chip, uint8_t offset);
uint8_t native_ym2608_read_status(void *chip);
uint8_t native_ym2608_read_status_hi(void *chip);
uint8_t native_ym2608_get_irq(void *chip);
void native_ym2608_get_state(void *chip, NativeYm2608State *state);
}
