#include <ssfplay/ssfplay.h>

#include <cstdint>
#include <cstdlib>
#include <cstring>

extern "C" {

ssfplay_decoder* ssfplay_wasm_open(const char* path, uint32_t sample_rate,
                                   uint32_t quality, int64_t length_ms,
                                   int64_t fade_ms) {
  ssfplay_config config;
  ssfplay_config_init(&config);
  if (sample_rate) config.sample_rate = sample_rate;
  config.resampler_quality = quality <= 10 ? quality : 10;
  config.length_ms = length_ms;
  config.fade_ms = fade_ms;
  ssfplay_decoder* decoder = nullptr;
  if (ssfplay_open(path, &config, &decoder) != SSFPLAY_OK)
    return nullptr;
  return decoder;
}

size_t ssfplay_wasm_render(ssfplay_decoder* decoder, int16_t* output,
                           size_t frames) {
  size_t rendered = 0;
  ssfplay_result result = ssfplay_render(decoder, output, frames, &rendered);
  if (result != SSFPLAY_OK && result != SSFPLAY_EOF)
    return 0;
  return rendered;
}

void ssfplay_wasm_close(ssfplay_decoder* decoder) {
  ssfplay_close(decoder);
}

const char* ssfplay_wasm_last_error(void) {
  return ssfplay_last_error();
}

}
