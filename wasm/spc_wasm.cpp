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
    p->dsp->set_output(p->pcm.data(), frames * 2);
    p->dsp->run(frames * SNES_SPC::clocks_per_sample);
  } else {
    const char* e = p->cpu->play(frames * 2, p->pcm.data());
    if (e) { p->error = e; return 0; }
  }
  for (int i = 0; i < frames; ++i) {
    p->left[i] = p->pcm[i * 2] * (1.0f / 32768.0f);
    p->right[i] = p->pcm[i * 2 + 1] * (1.0f / 32768.0f);
  }
  p->frames += frames;
  p->error.clear();
  return 1;
}
float* spc_left_ptr(Player* p) { return p ? p->left.data() : nullptr; }
float* spc_right_ptr(Player* p) { return p ? p->right.data() : nullptr; }
double spc_native_frames(Player* p) { return p ? static_cast<double>(p->frames) : 0; }
void spc_set_mute_mask(Player* p, int mask) {
  if (!p) return;
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
}
