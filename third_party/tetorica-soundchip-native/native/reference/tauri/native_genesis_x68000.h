#pragma once
#include <cstdint>

struct NativeX68000State {
    uint8_t registers[256];
    uint32_t fm_clock, oki_clock, sample_bytes, position, fed_bytes, divider, fm_mute_mask;
    uint8_t status, irq, pan, playing, streaming, repeat, amd, pmd;
};
extern "C" {
void *native_x68000_create(uint32_t output_rate);
void native_x68000_destroy(void *);
// chip: 0 = YM2151, 1 = OKIM6258, 2 = both (reset/stop only).
void native_x68000_reset(void *, uint8_t chip);
void native_x68000_stop(void *, uint8_t chip);
void native_x68000_key_off(void *, uint8_t voice);
// Preview retrigger: release for the next ordinary native FM interval, then key on.
void native_x68000_audition_key_on(void *, uint8_t channel, uint8_t mask);
void native_x68000_write(void *, uint8_t chip, uint8_t reg, uint8_t value);
void native_x68000_sample(void *, float *fm_left, float *fm_right, float *oki_left, float *oki_right);
int native_x68000_set_clock(void *, uint8_t chip, uint32_t clock);
void native_x68000_set_fm_mute_mask(void *, uint32_t mask);
// Upload to an inactive, preallocated bank. Sequential chunks; commit is atomic.
int native_x68000_sample_begin(void *, uint32_t size);
int native_x68000_sample_chunk(void *, const uint8_t *, uint32_t offset, uint32_t size);
int native_x68000_sample_commit(void *);
void native_x68000_sample_abort(void *);
int native_x68000_oki_play(void *, uint8_t repeat);
void native_x68000_oki_set_repeat(void *, uint8_t repeat);
uint8_t native_x68000_read(void *, uint8_t offset);
uint8_t native_x68000_read_status(void *);
uint8_t native_x68000_get_irq(void *);
void native_x68000_get_state(void *, NativeX68000State *);
}
