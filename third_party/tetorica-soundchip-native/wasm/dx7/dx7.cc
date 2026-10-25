// Copyright 2026 Tetorica contributors. SPDX-License-Identifier: Apache-2.0
// Thin adapter: all synthesis and allocation remain in upstream SynthUnit.
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include "synth.h"
#include "synth_unit.h"
#include "dx7.h"

namespace {
constexpr int kFrames = 1024;
struct DX7 {
  SynthUnit* synth;
  uint8_t voice[155] = {};
  bool has_voice = false;
  uint32_t voice_id = 0;
  int16_t pcm[kFrames];
  float output[kFrames];
  DX7() : synth(new SynthUnit(nullptr)) {}
  ~DX7() { delete synth; }
};
}

extern "C" {
void* dx7_create() {
  // Within native builds this is one fixed rate. Each JS core has its own
  // WASM memory, including MSFA's global LUTs and static initialization.
  static bool initialized = false;
  if (!initialized) {
    SynthUnit::Init(44100.0);
    initialized = true;
  }
  return new DX7;
}
void dx7_destroy(void* handle) { delete static_cast<DX7*>(handle); }
uint8_t* dx7_voice_ptr(void* handle) { return static_cast<DX7*>(handle)->voice; }
float* dx7_output_ptr(void* handle) { return static_cast<DX7*>(handle)->output; }
void dx7_set_voice(void* handle) {
  auto* dx7 = static_cast<DX7*>(handle);
  dx7->synth->SetVoice(dx7->voice);
  dx7->has_voice = true;
  dx7->voice_id = 0;
}
void dx7_select_voice(void* handle, uint32_t voice_id) {
  auto* dx7 = static_cast<DX7*>(handle);
  dx7->synth->SelectVoice(dx7->voice, voice_id);
  dx7->has_voice = true;
  dx7->voice_id = voice_id;
}
void dx7_edit_voice(void* handle, uint32_t voice_id) {
  auto* dx7 = static_cast<DX7*>(handle);
  dx7->synth->EditVoice(dx7->voice, voice_id);
  dx7->has_voice = true;
  dx7->voice_id = voice_id;
}
void dx7_note_on(void* handle, int note, int velocity) {
  if (note < 0 || note > 127 || velocity < 0 || velocity > 127) return;
  const uint8_t message[] = { 0x90, static_cast<uint8_t>(note), static_cast<uint8_t>(velocity) };
  static_cast<DX7*>(handle)->synth->SendMidi(message, 3);
}
void dx7_note_off(void* handle, int note) {
  if (note < 0 || note > 127) return;
  const uint8_t message[] = { 0x80, static_cast<uint8_t>(note), 0 };
  static_cast<DX7*>(handle)->synth->SendMidi(message, 3);
}
void dx7_all_notes_off(void* handle) { static_cast<DX7*>(handle)->synth->AllNotesOff(); }
void dx7_panic(void* handle) {
  auto* dx7 = static_cast<DX7*>(handle);
  delete dx7->synth;
  dx7->synth = new SynthUnit(nullptr);
  if (dx7->has_voice) dx7->synth->SelectVoice(dx7->voice, dx7->voice_id);
}
void dx7_render(void* handle, int frames) {
  if (frames < 0 || frames > kFrames) return;
  auto* dx7 = static_cast<DX7*>(handle);
  dx7->synth->GetSamples(frames, dx7->pcm);
  for (int i = 0; i < frames; ++i) dx7->output[i] = dx7->pcm[i] / 32768.0f;
}
}
