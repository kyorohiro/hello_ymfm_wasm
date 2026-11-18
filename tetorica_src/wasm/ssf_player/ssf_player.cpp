// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (c) 2026 kyorohiro.
// A bounded PCM ABI around the independently instantiated Mednafen SSF core.
#include <ssfplay/ssfplay.h>

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
constexpr const char* input_path = "/tetorica.ssf";
constexpr uint32_t max_input = 2 * 1024 * 1024;
constexpr uint32_t max_frames = 16384;
std::string last_error;

struct Renderer {
  ssfplay_decoder* decoder = nullptr;
  std::vector<int16_t> samples;
  bool ended = false;

  ~Renderer() { ssfplay_close(decoder); }
};
}

extern "C" {

double ssfplay_tetorica_native_frame(const ssfplay_decoder* decoder);
int ssfplay_tetorica_snapshot(const ssfplay_decoder* decoder, uint32_t* words,
                            uint32_t word_count, uint8_t* ram, uint32_t ram_size);
int ssfplay_tetorica_dsp_snapshot(const ssfplay_decoder* decoder, uint32_t* words,
                                uint32_t word_count);
int ssfplay_tetorica_edit_voice(const ssfplay_decoder* decoder, uint32_t slot,
                              const uint32_t* edits, uint32_t count);

uint32_t ssf_abi_version() { return 4; }

Renderer* ssf_create(const uint8_t* bytes, uint32_t size) {
  last_error.clear();
  if (!bytes || size < 16 || size > max_input) {
    last_error = "Invalid flattened SSF container";
    return nullptr;
  }
  try {
    std::ofstream input(input_path, std::ios::binary | std::ios::trunc);
    input.write(reinterpret_cast<const char*>(bytes), size);
    input.close();
    if (!input) throw std::runtime_error("Could not stage SSF program");
    std::unique_ptr<Renderer> renderer(new Renderer);
    ssfplay_config config;
    ssfplay_config_init(&config);
    config.sample_rate = 44100;
    config.resampler_quality = 10;
    // The browser applies the already parsed, sample-exact length/fade/volume.
    config.length_ms = 0;
    config.fade_ms = 0;
    const ssfplay_result result = ssfplay_open(input_path, &config, &renderer->decoder);
    std::remove(input_path);
    if (result != SSFPLAY_OK) {
      last_error = ssfplay_last_error();
      if (last_error.empty()) last_error = ssfplay_result_string(result);
      return nullptr;
    }
    return renderer.release();
  } catch (const std::exception& error) {
    last_error = error.what();
    std::remove(input_path);
    return nullptr;
  }
}

int32_t ssf_render(Renderer* renderer, float* left, float* right, uint32_t frames) {
  if (!renderer || !left || !right || frames > max_frames) {
    last_error = "Invalid SSF render buffers";
    return -1;
  }
  if (renderer->ended || !frames) return 0;
  try {
    renderer->samples.resize(frames * 2);
    size_t produced = 0;
    const ssfplay_result result = ssfplay_render(renderer->decoder,
        renderer->samples.data(), frames, &produced);
    if (result != SSFPLAY_OK && result != SSFPLAY_EOF) {
      last_error = ssfplay_error(renderer->decoder);
      if (last_error.empty()) last_error = ssfplay_result_string(result);
      return -1;
    }
    for (size_t frame = 0; frame < produced; ++frame) {
      left[frame] = renderer->samples[frame * 2] / 32768.0f;
      right[frame] = renderer->samples[frame * 2 + 1] / 32768.0f;
    }
    renderer->ended = result == SSFPLAY_EOF || produced < frames;
    return static_cast<int32_t>(produced);
  } catch (const std::exception& error) {
    last_error = error.what();
    return -1;
  }
}

uint32_t ssf_ended(const Renderer* renderer) { return renderer && renderer->ended; }
double ssf_native_frame(const Renderer* renderer) {
  return renderer ? ssfplay_tetorica_native_frame(renderer->decoder) : -1;
}
uint32_t ssf_read_snapshot(const Renderer* renderer, uint32_t* words,
                         uint32_t word_count, uint8_t* ram, uint32_t ram_size) {
  return renderer && ssfplay_tetorica_snapshot(renderer->decoder, words, word_count, ram, ram_size);
}
uint32_t ssf_edit_voice(Renderer* renderer, uint32_t slot, const uint32_t* edits,
                       uint32_t count) {
  if (!renderer || !ssfplay_tetorica_edit_voice(renderer->decoder, slot, edits, count)) {
    last_error = "Invalid SSF voice parameter edit";
    return 0;
  }
  return 1;
}
uint32_t ssf_read_dsp_snapshot(const Renderer* renderer, uint32_t* words,
                             uint32_t word_count) {
  return renderer && ssfplay_tetorica_dsp_snapshot(renderer->decoder, words, word_count);
}
void ssf_destroy(Renderer* renderer) { delete renderer; }
const char* ssf_last_error() { return last_error.c_str(); }
}
