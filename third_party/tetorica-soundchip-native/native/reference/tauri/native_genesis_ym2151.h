#pragma once
#include <cstdint>

// Authored register gates and observational status; no audio is generated here.
struct NativeYm2151State {
    uint8_t registers[256];
    uint32_t clock;
    uint8_t keys[8];
    uint8_t status;
    uint8_t irq;
    uint8_t amd;
    uint8_t pmd;
};
extern "C" {
void *native_ym2151_create(uint32_t output_rate);
void native_ym2151_destroy(void *);
void native_ym2151_reset(void *);
void native_ym2151_stop(void *);
// Public allNotesOff preserves the authored timers/CSM and queued transport.
void native_ym2151_all_notes_off(void *);
void native_ym2151_write(void *, uint8_t reg, uint8_t value);
void native_ym2151_key_off(void *, uint8_t channel);
// Normal FM and the one global CSM source have independent leases.
void native_ym2151_key_off_fm(void *, uint8_t channel);
void native_ym2151_cancel_csm(void *);
// Release through one ordinary generated source interval before retriggering.
void native_ym2151_audition_key_on(void *, uint8_t channel, uint8_t mask);
void native_ym2151_sample(void *, float *left, float *right);
int native_ym2151_set_clock(void *, uint32_t clock);
uint8_t native_ym2151_read(void *, uint8_t offset);
uint8_t native_ym2151_read_status(void *);
uint8_t native_ym2151_get_irq(void *);
void native_ym2151_get_state(void *, NativeYm2151State *);
}
