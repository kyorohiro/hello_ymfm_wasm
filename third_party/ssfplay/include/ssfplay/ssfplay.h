#ifndef SSFPLAY_SSFPLAY_H
#define SSFPLAY_SSFPLAY_H

#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32)
# if defined(SSFPLAY_STATIC)
#  define SSFPLAY_API
# elif defined(SSFPLAY_BUILDING)
#  define SSFPLAY_API __declspec(dllexport)
# else
#  define SSFPLAY_API __declspec(dllimport)
# endif
#else
# define SSFPLAY_API __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef struct ssfplay_decoder ssfplay_decoder;

typedef enum ssfplay_result {
  SSFPLAY_OK = 0,
  SSFPLAY_EOF = 1,
  SSFPLAY_ERROR_INVALID_ARGUMENT = -1,
  SSFPLAY_ERROR_BUSY = -2,
  SSFPLAY_ERROR_IO = -3,
  SSFPLAY_ERROR_FORMAT = -4,
  SSFPLAY_ERROR_INTERNAL = -5
} ssfplay_result;

typedef enum ssfplay_metadata_field {
  SSFPLAY_METADATA_TITLE,
  SSFPLAY_METADATA_GAME,
  SSFPLAY_METADATA_ARTIST,
  SSFPLAY_METADATA_COPYRIGHT,
  SSFPLAY_METADATA_YEAR,
  SSFPLAY_METADATA_GENRE
} ssfplay_metadata_field;

typedef struct ssfplay_config {
  uint32_t sample_rate;
  uint32_t resampler_quality;
  int64_t length_ms;
  int64_t fade_ms;
} ssfplay_config;

SSFPLAY_API void ssfplay_config_init(ssfplay_config* config);
SSFPLAY_API ssfplay_result ssfplay_open(
    const char* path, const ssfplay_config* config, ssfplay_decoder** decoder);
SSFPLAY_API void ssfplay_close(ssfplay_decoder* decoder);
SSFPLAY_API ssfplay_result ssfplay_reset(ssfplay_decoder* decoder);
SSFPLAY_API ssfplay_result ssfplay_render(
    ssfplay_decoder* decoder, int16_t* interleaved_stereo,
    size_t requested_frames, size_t* rendered_frames);
SSFPLAY_API const char* ssfplay_metadata(
    const ssfplay_decoder* decoder, ssfplay_metadata_field field);
SSFPLAY_API int64_t ssfplay_length_ms(const ssfplay_decoder* decoder);
SSFPLAY_API int64_t ssfplay_fade_ms(const ssfplay_decoder* decoder);
SSFPLAY_API uint32_t ssfplay_sample_rate(const ssfplay_decoder* decoder);
SSFPLAY_API const char* ssfplay_error(const ssfplay_decoder* decoder);
SSFPLAY_API const char* ssfplay_last_error(void);
SSFPLAY_API const char* ssfplay_result_string(ssfplay_result result);

#ifdef __cplusplus
}
#endif

#endif
