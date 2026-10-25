#pragma once
#include <stddef.h>
#include <stdint.h>
extern "C" {
void *native_dx7_create(uint32_t rate);
void native_dx7_destroy(void *ptr);
void native_dx7_voice(void *ptr, const uint8_t *voice, uint32_t id, bool live);
int native_dx7_note_on(void *ptr, uint8_t note, uint8_t velocity);
// Additional-rack adapter: skip every protected slot, including released tails.
int native_dx7_note_on_mask(void *ptr, uint8_t note, uint8_t velocity, uint16_t preserve_mask);
void native_dx7_release_slot(void *ptr, uint8_t slot);
// Stops future computation for one slot. Keeps the already mixed source block
// (up to 64 frames), output-adapter prefetch and shared output-filter tail.
void native_dx7_kill_slot(void *ptr, uint8_t slot);
void native_dx7_panic(void *ptr);
float native_dx7_sample(void *ptr);
size_t native_dx7_core_size();
}
