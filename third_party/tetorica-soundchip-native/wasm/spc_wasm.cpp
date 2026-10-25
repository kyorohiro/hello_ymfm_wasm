// Tetorica bridge for the accurate snes_spc 0.9.0 core. See third_party/snes-spc.
#include "SNES_SPC.h"
#include "SPC_DSP.h"
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

namespace {
constexpr int block_frames = 1024;
constexpr int max_file_bytes = 16 * 1024 * 1024;
constexpr uint32_t max_trace_events = 1000000;
constexpr uint32_t max_trace_clocks = 600 * 1024000;
struct TraceEvent { uint32_t clock, kind, address, value; };
struct ObservedDspWrite { uint32_t clock_low, clock_high, address, value; };
static_assert(sizeof(TraceEvent) == 16, "Trace records have four uint32 words");
struct Player {
  explicit Player(bool dsp_only) : dsp_only(dsp_only) {
    if (dsp_only) { dsp.reset(new SPC_DSP); dsp->init(ram.data()); }
    else { cpu.reset(new SNES_SPC); const char* e = cpu->init(); if (e) error = e; }
  }
  bool dsp_only;
  std::unique_ptr<SNES_SPC> cpu;
  std::unique_ptr<SPC_DSP> dsp;
  std::array<unsigned char, 65536> ram{};
  std::vector<unsigned char> original;
  std::array<short, block_frames * 2> pcm{};
  std::array<float, block_frames> left{}, right{};
  std::array<unsigned char, SNES_SPC::spc_file_size> snapshot{};
  uint64_t frames = 0;
  int mute_mask = 0;
  std::string error;
  bool tracing = false, trace_failed = false, timeline_loaded = false;
  bool read_tracking = false, read_failed = false, filter_ram = false;
  std::vector<unsigned char> ram_read_mask, trace_ram_filter;
  bool observing_dsp = false;
  std::vector<ObservedDspWrite> observed_dsp;
  uint32_t observed_count = 0, observed_lost = 0;
  std::array<unsigned char, 128> observed_registers{};
  static void observe(void* user, unsigned long long clock, int, int address, int value) {
    auto& p = *static_cast<Player*>(user);
    if (p.observed_count >= p.observed_dsp.size()) {if (p.observed_lost != UINT32_MAX) ++p.observed_lost; return;}
    p.observed_dsp[p.observed_count++] = {static_cast<uint32_t>(clock), static_cast<uint32_t>(clock >> 32),
      static_cast<uint32_t>(address), static_cast<uint32_t>(value)};
  }
  std::string trace_error;
  uint32_t trace_limit = 0;
  std::array<unsigned char, 65536 + 128> trace_initial{};
  std::vector<TraceEvent> trace_events;
  std::vector<uint32_t> ram_stamp, ram_event;
  std::array<unsigned char, 65536 + 128> timeline_initial{};
  std::vector<TraceEvent> timeline_events;
  uint32_t timeline_duration = 0, timeline_clock = 0, timeline_event = 0, timeline_position = 0;
  static void record(void* user, unsigned long long clock, int kind, int address, int value) {
    auto& p = *static_cast<Player*>(user);
    if (!p.tracing || p.trace_failed) return;
    // Omit CPU working RAM before it consumes any event budget. The mask was
    // discovered by an identical full pass, so future directory/BRR/echo reads
    // are retained too, even if they have not occurred yet in this second pass.
    if (kind == 1 && p.filter_ram && !p.trace_ram_filter[address]) return;
    if (clock > max_trace_clocks) {p.trace_failed = true; p.trace_error = "SPC trace limit exceeded; choose a shorter capture duration"; return;}
    const uint32_t time = static_cast<uint32_t>(clock);
    // Between DSP advances it cannot observe intermediate RAM values. Keep the
    // latest value at each address at that clock, without dropping DSP writes.
    if (kind == 1 && p.ram_stamp[address] == time) {
      p.trace_events[p.ram_event[address]].value = value; return;
    }
    if (p.trace_events.size() >= p.trace_limit) {p.trace_failed = true; p.trace_error = "SPC trace limit exceeded; choose a shorter capture duration"; return;}
    if (kind == 1) {p.ram_stamp[address] = time; p.ram_event[address] = p.trace_events.size();}
    p.trace_events.push_back({time, static_cast<uint32_t>(kind), static_cast<uint32_t>(address), static_cast<uint32_t>(value)});
  }
  void restart_timeline() {
    std::copy(timeline_initial.begin(), timeline_initial.begin() + 65536, ram.begin());
    dsp->load(timeline_initial.data() + 65536); dsp->set_output_mute_mask(mute_mask);
    timeline_clock = timeline_event = timeline_position = 0; frames = 0;
  }
  void apply_timeline_events() {
    while (timeline_event < timeline_events.size() && timeline_events[timeline_event].clock <= timeline_clock) {
      const auto& e = timeline_events[timeline_event++];
      if (e.kind == 0) dsp->write(e.address, e.value);
      else ram[e.address] = e.value;
    }
  }
  void render_timeline(int count) {
    // SNES_SPC::reset_buf starts with four stereo frames of silence. Preserve
    // that upstream output FIFO rather than moving captured event timestamps.
    const uint32_t total = timeline_duration / 32;
    int written = 0;
    while (written < count && timeline_position < 4 && timeline_position < total) {
      ++timeline_position; ++written;
    }
    const int generate = std::min<uint32_t>(count - written, total - timeline_position);
    if (generate > 0) {
      dsp->set_output(pcm.data() + written * 2, generate * 2);
      const uint32_t end = timeline_clock + generate * 32;
      while (timeline_clock < end) {
        apply_timeline_events();
        const uint32_t next = timeline_event < timeline_events.size()
          ? std::min(end, timeline_events[timeline_event].clock) : end;
        dsp->run(next - timeline_clock); timeline_clock = next;
      }
      apply_timeline_events(); timeline_position += generate;
    }
    frames = timeline_position;
  }
  bool load(const unsigned char* data, int size) {
    if (dsp_only) { error = "This is a DSP-only instance"; return false; }
    if (!data || size < SNES_SPC::spc_min_file_size || size > max_file_bytes) {
      error = "Invalid SPC file size"; return false;
    }
    if (std::memcmp(data, "SNES-SPC700 Sound File Data ", 27) || data[0x21] != 0x1a ||
        data[0x22] != 0x1a || (data[0x23] != 0x1a && data[0x23] != 0x1b)) {
      error = "Invalid SPC header"; return false;
    }
    std::unique_ptr<SNES_SPC> next(new SNES_SPC);
    const char* e = next->init();
    if (!e) e = next->load_spc(data, size);
    if (e) { error = e; return false; }
    next->set_output_mute_mask(mute_mask);
    // Keep original bytes only after validation; failed loads leave playback intact.
    if (data != original.data()) original.assign(data, data + size);
    cpu.swap(next);
    tracing = trace_failed = read_tracking = observing_dsp = false; trace_events.clear(); ram_read_mask.clear();
    observed_count = observed_lost = 0;
    frames = 0;
    error.clear();
    return true;
  }
};
static_assert(sizeof(short) == 2, "The SPC core requires 16-bit samples");
}

extern "C" {
void* spc_create(int dsp_only) {
  std::unique_ptr<Player> p(new Player(dsp_only != 0));
  if (!p->error.empty()) return nullptr;
  return p.release();
}
void spc_destroy(Player* p) { delete p; }
const char* spc_error(Player* p) { return p ? p->error.c_str() : "Invalid SPC handle"; }
int spc_load(Player* p, const unsigned char* data, int size) { return p && p->load(data, size); }
int spc_restart(Player* p) {
  if (!p) return 0;
  if (p->dsp_only) {
    p->timeline_loaded = false; p->timeline_events.clear();
    p->ram.fill(0); p->dsp->reset(); p->dsp->set_output_mute_mask(p->mute_mask);
    p->frames = 0; p->error.clear(); return 1;
  }
  if (p->original.empty()) { p->error = "Load an SPC file before restarting"; return 0; }
  return p->load(p->original.data(), static_cast<int>(p->original.size()));
}
int spc_render(Player* p, int frames) {
  if (!p || frames < 0 || frames > block_frames) return 0;
  if (!p->dsp_only && p->original.empty()) { p->error = "Load an SPC file before rendering"; return 0; }
  if (!frames) return 1;
  std::fill(p->pcm.begin(), p->pcm.begin() + frames * 2, 0);
  if (p->dsp_only) {
    if (p->timeline_loaded) p->render_timeline(frames);
    else {
      p->dsp->set_output(p->pcm.data(), frames * 2);
      p->dsp->run(frames * SNES_SPC::clocks_per_sample);
    }
  } else {
    const char* e = p->cpu->play(frames * 2, p->pcm.data());
    if (e) { p->error = e; return 0; }
  }
  for (int i = 0; i < frames; ++i) {
    p->left[i] = p->pcm[i * 2] * (1.0f / 32768.0f);
    p->right[i] = p->pcm[i * 2 + 1] * (1.0f / 32768.0f);
  }
  if (!p->timeline_loaded) p->frames += frames;
  if (p->tracing && (p->trace_failed || p->frames * 32 > max_trace_clocks)) {
    p->trace_failed = true;
    if (p->trace_error.empty()) p->trace_error = "SPC trace limit exceeded; choose a shorter capture duration";
    p->error = p->trace_error; return 0;
  }
  p->error.clear();
  return 1;
}
float* spc_left_ptr(Player* p) { return p ? p->left.data() : nullptr; }
float* spc_right_ptr(Player* p) { return p ? p->right.data() : nullptr; }
double spc_native_frames(Player* p) { return p ? static_cast<double>(p->frames) : 0; }
void spc_set_mute_mask(Player* p, int mask) {
  if (!p) return;
  if (p->tracing && p->mute_mask != (mask & 255)) {
    p->trace_failed = true; p->trace_error = "SPC tracing requires unchanged, unmuted output; start a fresh unmuted capture";
  }
  if (p->read_tracking && p->mute_mask != (mask & 255)) p->read_failed = true;
  p->mute_mask = mask & 255;
  if (p->dsp_only) p->dsp->set_output_mute_mask(p->mute_mask);
  else p->cpu->set_output_mute_mask(p->mute_mask);
}
unsigned char* spc_snapshot_ptr(Player* p) {
  if (!p) return nullptr;
  if (p->dsp_only) {
    std::copy(p->ram.begin(), p->ram.end(), p->snapshot.begin() + 0x100);
    for (int i = 0; i < 128; ++i) p->snapshot[0x10100 + i] = p->dsp->read(i);
  } else p->cpu->save_spc(p->snapshot.data());
  return p->snapshot.data();
}
int spc_load_ram(Player* p, const unsigned char* data, int size, int offset) {
  if (!p || !p->dsp_only || !data || size < 0 || offset < 0 || offset > 65536 - size) return 0;
  std::memcpy(p->ram.data() + offset, data, size); return 1;
}
void spc_write_dsp(Player* p, int reg, int value) {
  if (p && p->dsp_only && reg >= 0 && reg < 128) p->dsp->write(reg, value & 255);
}
int spc_read_dsp(Player* p, int reg) {
  return p && p->dsp_only && reg >= 0 && reg < 128 ? p->dsp->read(reg) : -1;
}
int spc_trace_begin(Player* p, int limit, const unsigned char* mask, int mask_size) {
  if (!p || p->dsp_only || p->original.empty() || p->frames || p->mute_mask || p->read_tracking || limit < 1 || limit > static_cast<int>(max_trace_events)) {
    if (p) p->error = "Trace requires a freshly loaded, unmuted SPC and maxEvents from 1 to 1000000";
    return 0;
  }
  if (mask_size != 0 && (!mask || mask_size != 65536)) {p->error = "DSP RAM read mask must contain 65536 bytes"; return 0;}
  p->filter_ram = mask_size != 0;
  if (p->filter_ram) p->trace_ram_filter.assign(mask, mask + 65536); else p->trace_ram_filter.clear();
  p->tracing = true; p->trace_failed = false; p->trace_limit = limit;
  p->trace_error.clear();
  p->trace_events.clear(); p->trace_events.reserve(std::min(limit, 4096));
  p->ram_stamp.assign(65536, UINT32_MAX); p->ram_event.resize(65536);
  p->cpu->copy_tetorica_trace_initial(p->trace_initial.data(), p->trace_initial.data() + 65536);
  p->cpu->set_tetorica_trace(Player::record, p); p->error.clear(); return 1;
}
int spc_trace_finish(Player* p) {
  if (!p || !p->tracing) {if (p) p->error = "No SPC trace is active"; return 0;}
  p->tracing = false; p->cpu->set_tetorica_trace(nullptr, nullptr);
  if (p->trace_failed) {p->error = p->trace_error; return 0;}
  if (!p->frames) {p->error = "SPC trace requires at least one rendered native frame"; return 0;}
  p->error.clear(); return 1;
}
unsigned char* spc_trace_initial_ptr(Player* p) {return p ? p->trace_initial.data() : nullptr;}
TraceEvent* spc_trace_events_ptr(Player* p) {return p ? p->trace_events.data() : nullptr;}
int spc_trace_event_count(Player* p) {return p ? p->trace_events.size() : 0;}
int spc_ram_read_begin(Player* p) {
  if (!p || p->dsp_only || p->original.empty() || p->frames || p->mute_mask || p->tracing || p->read_tracking) {
    if (p) p->error = "DSP RAM discovery requires a freshly loaded, unmuted SPC without an active trace";
    return 0;
  }
  p->ram_read_mask.assign(65536, 0); p->read_tracking = true; p->read_failed = false;
  p->cpu->set_tetorica_ram_read_mask(p->ram_read_mask.data()); p->error.clear(); return 1;
}
int spc_ram_read_finish(Player* p) {
  if (!p || !p->read_tracking) {if (p) p->error = "No DSP RAM discovery is active"; return 0;}
  p->read_tracking = false; p->cpu->set_tetorica_ram_read_mask(nullptr);
  if (!p->frames) {p->error = "DSP RAM discovery requires at least one rendered native frame"; return 0;}
  if (p->mute_mask || p->read_failed) {p->error = "DSP RAM discovery requires unchanged, unmuted output"; return 0;}
  p->error.clear(); return 1;
}
unsigned char* spc_ram_read_mask_ptr(Player* p) {return p && !p->ram_read_mask.empty() ? p->ram_read_mask.data() : nullptr;}
int spc_observer_begin(Player* p, int capacity) {
  if (!p || p->dsp_only || p->original.empty() || capacity < 16 || capacity > 8192) {
    if (p) p->error = "DSP observation requires a loaded SPC and capacity from 16 to 8192"; return 0;
  }
  p->observed_dsp.resize(capacity); p->observed_count = p->observed_lost = 0; p->observing_dsp = true;
  p->cpu->set_tetorica_dsp_observer(Player::observe, p, p->frames * 32); p->error.clear(); return 1;
}
void spc_observer_stop(Player* p) {
  if (!p || p->dsp_only) return;
  p->cpu->set_tetorica_dsp_observer(nullptr, nullptr, 0); p->observing_dsp = false;
  p->observed_count = p->observed_lost = 0;
}
ObservedDspWrite* spc_observer_ptr(Player* p) {return p && !p->observed_dsp.empty() ? p->observed_dsp.data() : nullptr;}
int spc_observer_drain(Player* p) {if (!p) return 0; const int count = p->observed_count; p->observed_count = 0; return count;}
double spc_observer_lost(Player* p) {if (!p) return 0; const uint32_t lost = p->observed_lost; p->observed_lost = 0; return lost;}
unsigned char* spc_observer_registers_ptr(Player* p) {
  if (!p || p->dsp_only) return nullptr;
  p->cpu->copy_tetorica_dsp_registers(p->observed_registers.data()); return p->observed_registers.data();
}
int spc_load_timeline(Player* p, const unsigned char* initial, const TraceEvent* events, int count, int duration) {
  if (!p || !p->dsp_only || !initial || count < 0 || count > static_cast<int>(max_trace_events) ||
      (count && !events) || duration < 32 || duration > static_cast<int>(max_trace_clocks) || duration % 32) {
    if (p) p->error = "Invalid SNES timeline dimensions"; return 0;
  }
  uint32_t previous = 0;
  for (int i = 0; i < count; ++i) {
    const auto& e = events[i];
    if (e.clock < previous || e.clock > static_cast<uint32_t>(duration) || e.kind > 1 || e.value > 255 ||
        e.address > (e.kind ? 65535u : 127u)) {p->error = "Invalid SNES timeline event"; return 0;}
    previous = e.clock;
  }
  std::copy(initial, initial + 65536 + 128, p->timeline_initial.begin());
  if (count) p->timeline_events.assign(events, events + count); else p->timeline_events.clear();
  p->timeline_duration = duration; p->timeline_loaded = true; p->restart_timeline(); p->error.clear(); return 1;
}
int spc_restart_timeline(Player* p) {
  if (!p || !p->timeline_loaded) {if (p) p->error = "Load a SNES timeline before restarting"; return 0;}
  p->restart_timeline(); p->error.clear(); return 1;
}
int spc_timeline_total_frames(Player* p) {return p && p->timeline_loaded ? p->timeline_duration / 32 : 0;}
}
