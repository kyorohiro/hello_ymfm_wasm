#pragma once
#include <cstdint>

// Applied register/status view. Inspection does not read ADPCM data or change IRQ.
struct NativeYm2610BState {
    uint8_t registers[512];
    uint32_t clock;
    uint32_t source_mute_mask;
    uint8_t status;
    uint8_t status_hi;
    uint8_t irq;
    uint8_t variant;
};

struct NativeYm2610BExtraState {
    uint8_t registers[512];
    uint32_t clock;
    uint32_t source_mute_mask;
    uint8_t keys[6];
    uint8_t ssg_levels[3];
    uint8_t status;
    uint8_t status_hi;
    uint8_t irq;
    uint8_t variant;
};

extern "C" {
// Independent YM2610 / YM2610B, with control-owned sparse ROM.
// variant is immutable: 0 = four physical FM slots, 1 = all six.
void *native_ym2610b_create_extra_variant(uint32_t output_rate, uint8_t variant);
void *native_ym2610b_create_extra(uint32_t output_rate);
void *native_ym2610b_alloc_rom_page();
void native_ym2610b_free_rom_page(void *page);
// Publishes an immutable 64 KiB page into bank 0/1, page 0..255; never frees.
// The caller retains current and retired versions until callback refs drain.
int native_ym2610b_install_rom_page(void *chip, uint8_t bank, uint16_t index, void *page);
void native_ym2610b_key_off_fm(void *chip, uint8_t channel);
void native_ym2610b_cancel_csm(void *chip);
void native_ym2610b_audition_fm_key_on(void *chip, uint8_t channel, uint8_t mask);
void native_ym2610b_set_retained_ssg_level(void *chip, uint8_t channel, uint8_t level);
void native_ym2610b_get_extra_state(void *chip, NativeYm2610BExtraState *state);
void *native_ym2610b_create(uint32_t output_rate, uint8_t variant);
void native_ym2610b_destroy(void *chip);
// Variant: 0 = YM2610 (physical FM channels 1,2,4,5), 1 = YM2610B (all six).
// Reset retains both independently uploaded ADPCM ROM banks, clock and source mute.
void native_ym2610b_reset(void *chip);
// Stop clears active voices while retaining their authored controls and memory.
void native_ym2610b_stop(void *chip);
void native_ym2610b_key_off(void *chip, uint8_t voice);
void native_ym2610b_write(void *chip, uint8_t port, uint8_t reg, uint8_t value);
void native_ym2610b_sample(void *chip, float *left, float *right);
int native_ym2610b_set_clock(void *chip, uint32_t clock);
void native_ym2610b_set_source_mute_mask(void *chip, uint32_t mask);
// Primary only: type 0 = ADPCM-A, 1 = ADPCM-B; each bank reserves 16 MiB.
// Additional ROM uploads prepare immutable pages on control and publish pointers;
// non-empty load_rom rejects additional instances to prevent callback copies.
int native_ym2610b_load_rom(void *chip, uint8_t type, const uint8_t *bytes, uint32_t offset, uint32_t size);
void native_ym2610b_clear_rom(void *chip, uint8_t type);
int native_ym2610b_copy_rom(void *chip, uint8_t type, uint8_t *bytes, uint32_t offset, uint32_t size);
uint8_t native_ym2610b_read(void *chip, uint8_t offset);
uint8_t native_ym2610b_read_status(void *chip);
uint8_t native_ym2610b_read_status_hi(void *chip);
uint8_t native_ym2610b_get_irq(void *chip);
void native_ym2610b_get_state(void *chip, NativeYm2610BState *state);
}
