#pragma once
#include <stdint.h>
// Fixed applied state. All fields are written/read on the owning audio thread;
// the Rust host publishes its own atomic copy for IPC readers.
struct NativeNesState {
  uint8_t registers[0x90]; // Native CPU address minus $4000, including FDS.
  uint8_t wave[64], modulation[32];
  uint32_t periods[5], lengths[4], volumes[4];
  uint32_t dmc_address, dmc_remaining, dmc_output, dmc_frequency;
  uint32_t fds_frequency, fds_mod_frequency, fds_mod_index, fds_mod_clock;
  int32_t fds_mod_counter;
  uint32_t fds_gain, fds_sweep_gain, fds_master, fds_accumulator, fds_output;
  uint32_t enable_mask, mute_mask, fds_enabled, fds_io, fds_active;
  uint32_t fds_write_enabled, fds_mod_enabled, frame_irq, dmc_irq;
  double clock, base_clock;
};
extern "C" {
void *native_nes_create(uint32_t rate, double base_clock, bool fds);
void native_nes_destroy(void *ptr);
void native_nes_reset(void *ptr); // Full public reset, clears DMC RAM and FDS wave.
void native_nes_stop(void *ptr);  // Gates off; preserve RAM, patch/wave, clock/mute.
void native_nes_stop_channel(void *ptr, uint8_t channel); // 0..4 APU, 5 FDS; also gates when FDS IO is disabled.
void native_nes_write_enable(void *ptr, uint8_t value, uint8_t preserve_mask); // Host-protected $4015 merge; no protected DMC refill.
void native_nes_enable_channel(void *ptr, uint8_t channel, bool enabled); // Independent 0..4 host gate; preserves other DMC phase.
uint32_t native_nes_active_mask(void *ptr); // Gate/length state; never advances audio.
uint32_t native_nes_core_size(); // Exact retained C++ allocation, including 64 KiB RAM.
void native_nes_write(void *ptr, uint16_t address, uint8_t value);
void native_nes_enable(void *ptr, uint8_t channel, bool enabled);
int native_nes_load(void *ptr, const uint8_t *bytes, uint32_t offset, uint32_t size);
void native_nes_set_mute(void *ptr, uint8_t mask);
int native_nes_set_clock(void *ptr, uint32_t hz); // 100000..100000000, preserves phase.
void native_nes_sample(void *ptr, float *left, float *right);
void native_nes_get_state(void *ptr, NativeNesState *out);
uint8_t native_nes_read_memory(void *ptr, uint16_t address);
}
