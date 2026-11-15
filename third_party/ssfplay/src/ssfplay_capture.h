#ifndef SSFPLAY_CAPTURE_H
#define SSFPLAY_CAPTURE_H

#include <stddef.h>
#include <stdint.h>

#include <ssfplay/ssfplay.h>

#if defined(_WIN32)
# define SSFPLAY_PRIVATE_API __declspec(dllexport)
#else
# define SSFPLAY_PRIVATE_API __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef enum ssfplay_capture_event_type {
  SSFPLAY_CAPTURE_REGISTER_WRITE = 0,
  SSFPLAY_CAPTURE_RAM_WRITE = 1
} ssfplay_capture_event_type;

typedef struct ssfplay_capture_event {
  uint64_t sample;
  uint32_t address;
  uint8_t value;
  uint8_t type;
  uint8_t from_word_write;
  uint8_t reserved;
} ssfplay_capture_event;

typedef struct ssfplay_capture_stats {
  uint64_t byte_writes;
  uint64_t word_writes;
  uint64_t register_word_writes;
  uint64_t ram_word_writes;
  uint64_t same_sample_collisions;
  uint64_t register_writes;
  uint64_t ram_writes;
} ssfplay_capture_stats;

typedef void (*ssfplay_slot_sample_callback)(void* opaque, uint32_t slot,
                                             int16_t sample);

SSFPLAY_PRIVATE_API ssfplay_result ssfplay_capture_begin(ssfplay_decoder* decoder);
SSFPLAY_PRIVATE_API void ssfplay_capture_end(ssfplay_decoder* decoder);
SSFPLAY_PRIVATE_API const uint8_t* ssfplay_capture_initial_ram(
    const ssfplay_decoder* decoder, size_t* size);
SSFPLAY_PRIVATE_API const ssfplay_capture_event* ssfplay_capture_events(
    const ssfplay_decoder* decoder, size_t* count);
SSFPLAY_PRIVATE_API ssfplay_capture_stats ssfplay_capture_get_stats(
    const ssfplay_decoder* decoder);
SSFPLAY_PRIVATE_API ssfplay_result ssfplay_capture_replay(
    const uint8_t* initial_ram, size_t ram_size,
    const ssfplay_capture_event* events, size_t event_count,
    uint64_t sample_count, int16_t* interleaved_stereo);
SSFPLAY_PRIVATE_API ssfplay_result ssfplay_capture_replay_dsp_trace(
    const uint8_t* initial_ram, size_t ram_size,
    const ssfplay_capture_event* events, size_t event_count,
    uint64_t sample_count, const char* trace_csv_path,
    int16_t* interleaved_stereo);
SSFPLAY_PRIVATE_API ssfplay_result ssfplay_capture_replay_slot_trace(
    const uint8_t* initial_ram, size_t ram_size,
    const ssfplay_capture_event* events, size_t event_count,
    uint64_t sample_count, ssfplay_slot_sample_callback slot_callback,
    void* slot_callback_opaque, int16_t* interleaved_stereo);

#ifdef __cplusplus
}
#endif

#endif
