#include <mednafen/mednafen.h>
#include <mednafen/FileStream.h>
#include <mednafen/SSFLoader.h>
#include <ssfplay/ssfplay.h>
#include "ssfplay_capture.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

using namespace Mednafen;

namespace {
struct CaptureState;
static void capture_bus_write(uint64_t sample, uint32_t address, uint32_t value,
                              unsigned size);
struct DspTraceState;
static void trace_dsp_sample(const uint32* mixs, const uint16* efreg,
                             int32 left, int32 right);
struct SlotTraceState;
static void trace_slot_sample(uint32 slot, int16 sample);
}

#define MDFN_SSFPLAY_COMPILE
#define SSFPLAY_CAPTURE_WRITE(sample, address, value, size) \
  capture_bus_write(sample, address, value, size)
#define SSFPLAY_DSP_TRACE_SAMPLE(mixs, efreg, left, right) \
  trace_dsp_sample(mixs, efreg, left, right)
#define SSFPLAY_SLOT_TRACE_SAMPLE(slot, sample) \
  trace_slot_sample(slot, sample)
#define SS_DBG(a, ...) ((void)0)
#define CDB_GetCDDA(n) ((void)0)
#define SS_SetPhysMemMap(...) ((void)0)
typedef int32 sscpu_timestamp_t;
#include "../mednafen/src/ss/sound.cpp"
#undef SS_SetPhysMemMap
#undef CDB_GetCDDA
#undef SS_DBG
#undef SSFPLAY_DSP_TRACE_SAMPLE
#undef SSFPLAY_SLOT_TRACE_SAMPLE
#undef SSFPLAY_CAPTURE_WRITE
#undef MDFN_SSFPLAY_COMPILE

namespace {

struct CaptureState {
  bool enabled = false;
  std::vector<uint8_t> initial_ram;
  std::vector<ssfplay_capture_event> events;
  ssfplay_capture_stats stats = {};
};

static CaptureState* active_capture = nullptr;

struct DspTraceState {
  std::ofstream out;
  uint64_t sample = 0;
};

static DspTraceState* active_dsp_trace = nullptr;

struct SlotTraceState {
  ssfplay_slot_sample_callback callback = nullptr;
  void* opaque = nullptr;
};

static SlotTraceState* active_slot_trace = nullptr;

static int32_t sign_extend_20(uint32 value) {
  value &= 0xFFFFF;
  return (value & 0x80000) ? static_cast<int32_t>(value | 0xFFF00000)
                           : static_cast<int32_t>(value);
}

static void write_dsp_trace_header(std::ostream& out) {
  out << "sample";
  for (unsigned i = 0; i < 16; ++i) out << ",mixs" << i;
  for (unsigned i = 0; i < 16; ++i) out << ",efreg" << i;
  out << ",left,right\n";
}

static void trace_dsp_sample(const uint32* mixs, const uint16* efreg,
                             int32 left, int32 right) {
  if (!active_dsp_trace || !active_dsp_trace->out)
    return;
  std::ostream& out = active_dsp_trace->out;
  out << active_dsp_trace->sample++;
  for (unsigned i = 0; i < 16; ++i)
    out << ',' << sign_extend_20(mixs[i]);
  for (unsigned i = 0; i < 16; ++i)
    out << ',' << static_cast<int16_t>(efreg[i]);
  out << ',' << left << ',' << right << '\n';
}

static void trace_slot_sample(uint32 slot, int16 sample) {
  if (!active_slot_trace || !active_slot_trace->callback)
    return;
  active_slot_trace->callback(active_slot_trace->opaque, slot, sample);
}

static void append_capture_byte(uint64_t sample, uint32_t address, uint8_t value,
                                bool from_word_write) {
  if (!active_capture || !active_capture->enabled)
    return;

  ssfplay_capture_event event = {};
  event.sample = sample;
  event.value = value;
  event.from_word_write = from_word_write;
  if (address < 0x80000) {
    event.type = SSFPLAY_CAPTURE_RAM_WRITE;
    event.address = address;
    active_capture->stats.ram_writes++;
  } else if (address >= 0x100000) {
    event.type = SSFPLAY_CAPTURE_REGISTER_WRITE;
    event.address = address & 0xFFF;
    active_capture->stats.register_writes++;
  } else {
    return;
  }

  if (!active_capture->events.empty() &&
      active_capture->events.back().sample == sample)
    active_capture->stats.same_sample_collisions++;
  active_capture->events.push_back(event);
}

static void capture_bus_write(uint64_t sample, uint32_t address, uint32_t value,
                              unsigned size) {
  if (!active_capture || !active_capture->enabled)
    return;
  if (size == 1) {
    active_capture->stats.byte_writes++;
    append_capture_byte(sample, address, static_cast<uint8_t>(value), false);
  } else {
    active_capture->stats.word_writes++;
    if (address < 0x80000)
      active_capture->stats.ram_word_writes++;
    else if (address >= 0x100000)
      active_capture->stats.register_word_writes++;
    append_capture_byte(sample, address, static_cast<uint8_t>(value >> 8), true);
    append_capture_byte(sample, address + 1, static_cast<uint8_t>(value), true);
  }
}

class ReadOnlyVFS final : public VirtualFS {
 public:
  ReadOnlyVFS() : VirtualFS('/', "/") {}
  Stream* read_open(const std::string& path) {
    return open(path, MODE_READ, false, true, CanaryType::open);
  }

  Stream* open(const std::string& path, uint32 mode, int, bool throw_on_noent,
               CanaryType) override {
    if (mode != MODE_READ)
      throw MDFN_Error(EACCES, "ssfplay filesystem is read-only");
    try {
      return new FileStream(path, FileStream::MODE_READ);
    } catch (...) {
      if (!throw_on_noent && errno == ENOENT)
        return nullptr;
      throw;
    }
  }
  int mkdir(const std::string&, bool, bool) override { throw MDFN_Error(EACCES, "read-only"); }
  bool unlink(const std::string&, bool, CanaryType) override { throw MDFN_Error(EACCES, "read-only"); }
  void rename(const std::string&, const std::string&, CanaryType) override { throw MDFN_Error(EACCES, "read-only"); }
  bool finfo(const std::string&, FileInfo*, bool) override { throw MDFN_Error(EACCES, "unsupported"); }
  void readdirentries(const std::string&, std::function<bool(const std::string&)>) override { throw MDFN_Error(EACCES, "unsupported"); }
  std::string get_human_path(const std::string& path) override { return path; }
  bool is_absolute_path(const std::string& path) override { return !path.empty() && path[0] == '/'; }
  bool is_driverel_path(const std::string&) override { return false; }
  void check_firop_safe(const std::string& path) override {
    if (path.empty() || is_absolute_path(path) || path == ".." ||
        path.find("../") != std::string::npos || path.find("/..") != std::string::npos ||
        path.find('\\') != std::string::npos)
      throw MDFN_Error(EACCES, "Referenced path is potentially unsafe: %s", path.c_str());
  }
};

static bool active_decoder = false;
static thread_local std::string last_error;

static int64_t parse_time_ms(const std::string& value) {
  if (value.empty())
    return 0;
  std::vector<std::string> parts;
  size_t start = 0;
  for (;;) {
    size_t colon = value.find(':', start);
    parts.push_back(value.substr(start, colon - start));
    if (colon == std::string::npos)
      break;
    start = colon + 1;
  }
  try {
    double seconds = 0;
    if (parts.size() == 1)
      seconds = std::stod(parts[0]);
    else if (parts.size() == 2)
      seconds = std::stod(parts[0]) * 60.0 + std::stod(parts[1]);
    else if (parts.size() == 3)
      seconds = std::stod(parts[0]) * 3600.0 + std::stod(parts[1]) * 60.0 + std::stod(parts[2]);
    else
      return 0;
    return seconds > 0 ? static_cast<int64_t>(seconds * 1000.0 + 0.5) : 0;
  } catch (...) {
    return 0;
  }
}

}

struct ssfplay_decoder {
  ReadOnlyVFS vfs;
  std::unique_ptr<SSFLoader> loader;
  uint32_t rate = 44100;
  uint32_t quality = 10;
  int64_t length_ms = 0;
  int64_t fade_ms = 0;
  uint64_t position = 0;
  uint64_t length_frames = 0;
  uint64_t total_frames = 0;
  std::string metadata[6];
  std::string error;
  std::vector<int16_t> pending;
  size_t pending_offset = 0;
  CaptureState capture;

  void reset_core() {
    MDFN_IEN_SSFPLAY::SOUND_Kill();
    MDFN_IEN_SSFPLAY::SOUND_Init(false);
    MDFN_IEN_SSFPLAY::SOUND_Reset(true);
    for (unsigned i = 0; i < loader->RAM_Data.map_size(); ++i)
      MDFN_IEN_SSFPLAY::SOUND_Write8(i, loader->RAM_Data.map()[i]);
    MDFN_IEN_SSFPLAY::SOUND_Set68KActive(true);
    MDFN_IEN_SSFPLAY::SOUND_SetClockRatio(0x80000000);
    position = 0;
    pending.clear();
    pending_offset = 0;
  }

  void generate() {
    int16_t buffer[2048 * 2];
    MDFN_IEN_SSFPLAY::SOUND_StartFrame(rate, quality);
    const int32 target_timestamp = 588 * 512;
    MDFN_IEN_SSFPLAY::SOUND_Update(target_timestamp);
    const int32 count = MDFN_IEN_SSFPLAY::SOUND_FlushOutput(buffer, 2048, false);
    MDFN_IEN_SSFPLAY::SOUND_AdjustTS(-target_timestamp);
    pending.assign(buffer, buffer + count * 2);
    pending_offset = 0;
  }
};

extern "C" {

void ssfplay_config_init(ssfplay_config* config) {
  if (!config) return;
  config->sample_rate = 44100;
  config->resampler_quality = 10;
  config->length_ms = -1;
  config->fade_ms = -1;
}

ssfplay_result ssfplay_open(const char* path, const ssfplay_config* input, ssfplay_decoder** out) {
  last_error.clear();
  if (!path || !out) return SSFPLAY_ERROR_INVALID_ARGUMENT;
  *out = nullptr;
  if (active_decoder) return SSFPLAY_ERROR_BUSY;
  ssfplay_config config;
  ssfplay_config_init(&config);
  if (input) config = *input;
  if (config.sample_rate < 8000 || config.sample_rate > 192000 ||
      config.resampler_quality > 10 || config.length_ms < -1 || config.fade_ms < -1)
    return SSFPLAY_ERROR_INVALID_ARGUMENT;

  std::unique_ptr<ssfplay_decoder> d(new ssfplay_decoder);
  try {
    std::string dir, base, ext;
    d->vfs.get_file_path_components(path, &dir, &base, &ext);
    std::unique_ptr<Stream> stream(d->vfs.read_open(path));
    if (!SSFLoader::TestMagic(stream.get())) {
      last_error = "File is not an SSF or MiniSSF";
      return SSFPLAY_ERROR_FORMAT;
    }
    d->loader.reset(new SSFLoader(&d->vfs, dir, stream.get()));
    d->rate = config.sample_rate;
    d->quality = config.resampler_quality;
    const char* names[] = {"title", "game", "artist", "copyright", "year", "genre"};
    for (size_t i = 0; i < 6; ++i) d->metadata[i] = d->loader->tags.GetTag(names[i]);
    const int64_t tag_length = parse_time_ms(d->loader->tags.GetTag("length"));
    const int64_t tag_fade = parse_time_ms(d->loader->tags.GetTag("fade"));
    d->length_ms = config.length_ms >= 0 ? config.length_ms : tag_length;
    d->fade_ms = config.fade_ms >= 0 ? config.fade_ms : tag_fade;
    d->length_frames = static_cast<uint64_t>(d->length_ms) * d->rate / 1000;
    d->total_frames = static_cast<uint64_t>(d->length_ms + d->fade_ms) * d->rate / 1000;
    d->reset_core();
    active_decoder = true;
    *out = d.release();
    return SSFPLAY_OK;
  } catch (const std::exception& e) {
    d->error = e.what();
    last_error = e.what();
    MDFN_IEN_SSFPLAY::SOUND_Kill();
    return SSFPLAY_ERROR_IO;
  } catch (...) {
    last_error = "Unknown internal error";
    MDFN_IEN_SSFPLAY::SOUND_Kill();
    return SSFPLAY_ERROR_INTERNAL;
  }
}

void ssfplay_close(ssfplay_decoder* d) {
  if (!d) return;
  if (active_capture == &d->capture) active_capture = nullptr;
  MDFN_IEN_SSFPLAY::SOUND_Kill();
  delete d;
  active_decoder = false;
}

ssfplay_result ssfplay_reset(ssfplay_decoder* d) {
  if (!d) return SSFPLAY_ERROR_INVALID_ARGUMENT;
  try { d->reset_core(); return SSFPLAY_OK; }
  catch (const std::exception& e) { d->error = e.what(); return SSFPLAY_ERROR_INTERNAL; }
}

ssfplay_result ssfplay_render(ssfplay_decoder* d, int16_t* output, size_t requested, size_t* rendered) {
  if (!d || (!output && requested) || !rendered) return SSFPLAY_ERROR_INVALID_ARGUMENT;
  *rendered = 0;
  try {
    while (*rendered < requested && (!d->total_frames || d->position < d->total_frames)) {
      if (d->pending_offset >= d->pending.size()) d->generate();
      size_t available = (d->pending.size() - d->pending_offset) / 2;
      if (!available) break;
      size_t count = std::min(available, requested - *rendered);
      if (d->total_frames) count = std::min<uint64_t>(count, d->total_frames - d->position);
      for (size_t i = 0; i < count; ++i) {
        double gain = 1.0;
        if (d->fade_ms && d->position + i >= d->length_frames)
          gain = double(d->total_frames - (d->position + i)) / double(d->total_frames - d->length_frames);
        output[(*rendered + i) * 2] = static_cast<int16_t>(d->pending[d->pending_offset + i * 2] * gain);
        output[(*rendered + i) * 2 + 1] = static_cast<int16_t>(d->pending[d->pending_offset + i * 2 + 1] * gain);
      }
      d->pending_offset += count * 2;
      d->position += count;
      *rendered += count;
    }
  } catch (const std::exception& e) {
    d->error = e.what();
    last_error = e.what();
    return SSFPLAY_ERROR_INTERNAL;
  } catch (...) {
    d->error = "Unknown internal error";
    last_error = d->error;
    return SSFPLAY_ERROR_INTERNAL;
  }
  return (*rendered == 0 && d->total_frames && d->position >= d->total_frames) ? SSFPLAY_EOF : SSFPLAY_OK;
}

const char* ssfplay_metadata(const ssfplay_decoder* d, ssfplay_metadata_field field) {
  if (!d || field < SSFPLAY_METADATA_TITLE || field > SSFPLAY_METADATA_GENRE) return "";
  return d->metadata[field].c_str();
}
int64_t ssfplay_length_ms(const ssfplay_decoder* d) { return d ? d->length_ms : 0; }
int64_t ssfplay_fade_ms(const ssfplay_decoder* d) { return d ? d->fade_ms : 0; }
uint32_t ssfplay_sample_rate(const ssfplay_decoder* d) { return d ? d->rate : 0; }
const char* ssfplay_error(const ssfplay_decoder* d) { return d ? d->error.c_str() : ""; }
const char* ssfplay_last_error(void) { return last_error.c_str(); }
const char* ssfplay_result_string(ssfplay_result result) {
  switch (result) {
    case SSFPLAY_OK: return "success";
    case SSFPLAY_EOF: return "end of track";
    case SSFPLAY_ERROR_INVALID_ARGUMENT: return "invalid argument";
    case SSFPLAY_ERROR_BUSY: return "another decoder is active";
    case SSFPLAY_ERROR_IO: return "I/O or dependency error";
    case SSFPLAY_ERROR_FORMAT: return "unsupported or malformed SSF";
    default: return "internal error";
  }
}

ssfplay_result ssfplay_capture_begin(ssfplay_decoder* d) {
  if (!d) return SSFPLAY_ERROR_INVALID_ARGUMENT;
  try {
    d->capture = CaptureState();
    d->capture.initial_ram.assign(d->loader->RAM_Data.map(),
                                  d->loader->RAM_Data.map() +
                                      d->loader->RAM_Data.map_size());
    d->reset_core();
    d->capture.enabled = true;
    active_capture = &d->capture;
    return SSFPLAY_OK;
  } catch (const std::exception& e) {
    d->error = e.what();
    return SSFPLAY_ERROR_INTERNAL;
  }
}

void ssfplay_capture_end(ssfplay_decoder* d) {
  if (!d) return;
  d->capture.enabled = false;
  if (active_capture == &d->capture) active_capture = nullptr;
}

const uint8_t* ssfplay_capture_initial_ram(const ssfplay_decoder* d,
                                           size_t* size) {
  if (size) *size = d ? d->capture.initial_ram.size() : 0;
  return d && !d->capture.initial_ram.empty() ? d->capture.initial_ram.data()
                                               : nullptr;
}

const ssfplay_capture_event* ssfplay_capture_events(const ssfplay_decoder* d,
                                                    size_t* count) {
  if (count) *count = d ? d->capture.events.size() : 0;
  return d && !d->capture.events.empty() ? d->capture.events.data() : nullptr;
}

ssfplay_capture_stats ssfplay_capture_get_stats(const ssfplay_decoder* d) {
  return d ? d->capture.stats : ssfplay_capture_stats{};
}

static ssfplay_result replay_internal(
    const uint8_t* ram, size_t ram_size, const ssfplay_capture_event* events,
    size_t event_count, uint64_t sample_count, const char* trace_csv_path,
    SlotTraceState* slot_trace,
    int16_t* output) {
  if (!ram || ram_size > 0x80000 || (!events && event_count) ||
      (!output && sample_count))
    return SSFPLAY_ERROR_INVALID_ARGUMENT;
  try {
    DspTraceState trace;
    if (trace_csv_path && trace_csv_path[0]) {
      trace.out.open(trace_csv_path, std::ios::binary);
      if (!trace.out)
        return SSFPLAY_ERROR_IO;
      write_dsp_trace_header(trace.out);
      active_dsp_trace = &trace;
    }
    active_slot_trace = slot_trace;
    if (active_capture) active_capture->enabled = false;
    active_capture = nullptr;
    MDFN_IEN_SSFPLAY::SOUND_Kill();
    MDFN_IEN_SSFPLAY::SOUND_Init(false);
    MDFN_IEN_SSFPLAY::SOUND_Reset(true);
    for (size_t i = 0; i < ram_size; ++i)
      MDFN_IEN_SSFPLAY::SOUND_Write8(static_cast<uint32>(i), ram[i]);
    MDFN_IEN_SSFPLAY::SOUND_Set68KActive(false);
    MDFN_IEN_SSFPLAY::SOUND_StartFrame(44100, 4);

    size_t event_index = 0;
    uint64_t produced = 0;
    while (produced < sample_count) {
      while (event_index < event_count && events[event_index].sample == produced) {
        const ssfplay_capture_event& event = events[event_index++];
        const uint32 address = event.type == SSFPLAY_CAPTURE_RAM_WRITE
                                   ? event.address
                                   : 0x100000 | event.address;
        MDFN_IEN_SSFPLAY::SOUND_Write8(address, event.value);
      }
      MDFN_IEN_SSFPLAY::RunSCSP();
      ++produced;
      if ((produced & 1023) == 0 || produced == sample_count) {
        const uint32 buffered = MDFN_IEN_SSFPLAY::IBufferCount;
        const int32 count = MDFN_IEN_SSFPLAY::SOUND_FlushOutput(
            output + (produced - buffered) * 2, static_cast<int32>(buffered),
            false);
        if (count != static_cast<int32>(buffered)) {
          active_dsp_trace = nullptr;
          active_slot_trace = nullptr;
          return SSFPLAY_ERROR_INTERNAL;
        }
      }
    }
    active_dsp_trace = nullptr;
    active_slot_trace = nullptr;
    return SSFPLAY_OK;
  } catch (...) {
    active_dsp_trace = nullptr;
    active_slot_trace = nullptr;
    return SSFPLAY_ERROR_INTERNAL;
  }
}

ssfplay_result ssfplay_capture_replay(const uint8_t* ram, size_t ram_size,
                                      const ssfplay_capture_event* events,
                                      size_t event_count, uint64_t sample_count,
                                      int16_t* output) {
  return replay_internal(ram, ram_size, events, event_count, sample_count,
                         nullptr, nullptr, output);
}

ssfplay_result ssfplay_capture_replay_dsp_trace(
    const uint8_t* ram, size_t ram_size, const ssfplay_capture_event* events,
    size_t event_count, uint64_t sample_count, const char* trace_csv_path,
    int16_t* output) {
  return replay_internal(ram, ram_size, events, event_count, sample_count,
                         trace_csv_path, nullptr, output);
}

ssfplay_result ssfplay_capture_replay_slot_trace(
    const uint8_t* ram, size_t ram_size, const ssfplay_capture_event* events,
    size_t event_count, uint64_t sample_count,
    ssfplay_slot_sample_callback slot_callback, void* slot_callback_opaque,
    int16_t* output) {
  SlotTraceState trace;
  trace.callback = slot_callback;
  trace.opaque = slot_callback_opaque;
  return replay_internal(ram, ram_size, events, event_count, sample_count,
                         nullptr, slot_callback ? &trace : nullptr, output);
}

}
