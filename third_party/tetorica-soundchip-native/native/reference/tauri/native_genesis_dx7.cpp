// Copyright 2026 Tetorica contributors. SPDX-License-Identifier: Apache-2.0
#include <array>
#include <mutex>
#include <new>
#include "synth_unit.h"
#include "native_genesis_dx7.h"
namespace {
struct NativeDx7 {
  SynthUnit synth{nullptr};
  uint32_t rate;
  uint32_t index = 64;
  uint64_t phase = 0;
  float left = 0, right = 0;
  bool primed = false;
  std::array<int16_t, 64> pcm{};
  explicit NativeDx7(uint32_t rate) : rate(rate) {}
  float next() {
    if (index == 64) { synth.GetSamples(64, pcm.data()); index = 0; }
    return pcm[index++] / 32768.0f;
  }
  float sample() {
    // At 44.1 kHz do not introduce the resampler's two-sample prefetch.
    if (rate == 44100) return next();
    if (!primed) { left = next(); right = next(); primed = true; }
    // The JS resampler calculates in double, then stores float32.
    const float result = static_cast<float>(static_cast<double>(left) +
      (static_cast<double>(right) - left) * (static_cast<double>(phase) / rate));
    phase += 44100;
    // Also support lower device sample rates; 48/96 match the browser exactly.
    while (phase >= rate) { phase -= rate; left = right; right = next(); }
    return result;
  }
  void panic() {
    synth.NativePanic();
    index = 64; phase = 0; left = right = 0; primed = false;
    pcm.fill(0);
  }
};
}
extern "C" {
void *native_dx7_create(uint32_t rate) {
  if (rate < 8000 || rate > 384000) return nullptr;
  try {
    // Initialization happens only during device setup, never in a callback.
    // MSFA LUTs are fixed at 44.1 kHz for all instances/device sample rates.
    static std::once_flag initialized;
    std::call_once(initialized, [] { SynthUnit::Init(44100.0); });
    return new NativeDx7(rate);
  } catch (...) { return nullptr; }
}
void native_dx7_destroy(void *ptr) { delete static_cast<NativeDx7 *>(ptr); }
void native_dx7_voice(void *ptr, const uint8_t *voice, uint32_t id, bool live) {
  auto &synth = static_cast<NativeDx7 *>(ptr)->synth;
  if (live) synth.EditVoice(voice, id); else synth.SelectVoice(voice, id);
}
int native_dx7_note_on(void *ptr, uint8_t note, uint8_t velocity) {
  return static_cast<NativeDx7 *>(ptr)->synth.NativeNoteOn(note, velocity);
}
int native_dx7_note_on_mask(void *ptr, uint8_t note, uint8_t velocity, uint16_t preserve_mask) {
  return static_cast<NativeDx7 *>(ptr)->synth.NativeNoteOnMask(note, velocity, preserve_mask);
}
void native_dx7_release_slot(void *ptr, uint8_t slot) {
  static_cast<NativeDx7 *>(ptr)->synth.NativeReleaseSlot(slot);
}
void native_dx7_kill_slot(void *ptr, uint8_t slot) {
  static_cast<NativeDx7 *>(ptr)->synth.NativeKillSlot(slot);
}
void native_dx7_panic(void *ptr) { static_cast<NativeDx7 *>(ptr)->panic(); }
float native_dx7_sample(void *ptr) { return static_cast<NativeDx7 *>(ptr)->sample(); }
size_t native_dx7_core_size() { return sizeof(NativeDx7) + 16 * sizeof(Dx7Note); }
}
