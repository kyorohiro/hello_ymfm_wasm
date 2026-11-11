// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
// A synchronous PSF1 machine adapter over the BSD-licensed Play! HLE core.
#include <algorithm>
#include <cstring>
#include <memory>
#include <string>
#include <vector>
#include "iop/Iop_SubSystem.h"
#include "psx/PsxBios.h"
#include "MemoryUtils.h"
#include "BasicBlock.h"
#include "Jitter_CodeGen_Wasm.h"

extern "C" uint32 LWL_Proxy(uint32, uint32, CMIPS*);
extern "C" uint32 LWR_Proxy(uint32, uint32, CMIPS*);
extern "C" void SWL_Proxy(uint32, uint32, CMIPS*);
extern "C" void SWR_Proxy(uint32, uint32, CMIPS*);

struct PsfPlayer {
  std::unique_ptr<Iop::CSubSystem> machine;
  uint64_t clocks = 0;
  uint64_t nextFrame = 0;
  uint32_t refresh = 60;
  int64_t cpuDebt = 0;
  int16_t samples[128] = {};
  uint32_t readFrame = 64;
};
static std::string lastError;
static void registerFunctions() {
  static bool ready = false;
  if (ready) return;
  using R = Jitter::CWasmFunctionRegistry;
  R::RegisterFunction(reinterpret_cast<uintptr_t>(&EmptyBlockHandler), "_EmptyBlockHandler", "vi");
  R::RegisterFunction(reinterpret_cast<uintptr_t>(&MemoryUtils_GetByteProxy), "_MemoryUtils_GetByteProxy", "iii");
  R::RegisterFunction(reinterpret_cast<uintptr_t>(&MemoryUtils_GetHalfProxy), "_MemoryUtils_GetHalfProxy", "iii");
  R::RegisterFunction(reinterpret_cast<uintptr_t>(&MemoryUtils_GetWordProxy), "_MemoryUtils_GetWordProxy", "iii");
  R::RegisterFunction(reinterpret_cast<uintptr_t>(&MemoryUtils_SetByteProxy), "_MemoryUtils_SetByteProxy", "viii");
  R::RegisterFunction(reinterpret_cast<uintptr_t>(&MemoryUtils_SetHalfProxy), "_MemoryUtils_SetHalfProxy", "viii");
  R::RegisterFunction(reinterpret_cast<uintptr_t>(&MemoryUtils_SetWordProxy), "_MemoryUtils_SetWordProxy", "viii");
  R::RegisterFunction(reinterpret_cast<uintptr_t>(&LWL_Proxy), "_LWL_Proxy", "iiii");
  R::RegisterFunction(reinterpret_cast<uintptr_t>(&LWR_Proxy), "_LWR_Proxy", "iiii");
  R::RegisterFunction(reinterpret_cast<uintptr_t>(&SWL_Proxy), "_SWL_Proxy", "viii");
  R::RegisterFunction(reinterpret_cast<uintptr_t>(&SWR_Proxy), "_SWR_Proxy", "viii");
  ready = true;
}
extern "C" const char* psf_last_error() { return lastError.c_str(); }
extern "C" PsfPlayer* psf_create(const uint8_t* ram, const uint8_t* coverage, uint32_t pc, uint32_t gp, uint32_t sp, uint32_t refresh) {
  lastError.clear();
  try {
    registerFunctions();
    auto player = std::make_unique<PsfPlayer>();
    player->machine = std::make_unique<Iop::CSubSystem>(false);
    player->machine->Reset();
    player->machine->m_bios->CountTicks(0);
    auto bios = dynamic_cast<CPsxBios*>(player->machine->m_bios.get());
    bios->Reset();
    for (uint32_t i=0;i<0x200000;i++) if (coverage[i]) player->machine->m_ram[i]=ram[i];
    auto& cpu=player->machine->m_cpu;
    cpu.m_State.nPC=pc&0x1fffffff;
    cpu.m_State.nGPR[CMIPS::GP].nD0=static_cast<int32_t>(gp);
    cpu.m_State.nGPR[CMIPS::SP].nD0=static_cast<int32_t>(sp ? sp : 0x801fff00);
    cpu.m_State.nGPR[CMIPS::FP].nD0=cpu.m_State.nGPR[CMIPS::SP].nD0;
    player->refresh=refresh==50?50:60;
    player->nextFrame=33868800/player->refresh;
    player->machine->m_spuCore0.SetDestinationSamplingRate(44100);
    return player.release();
  } catch (const std::exception& error) { lastError=error.what(); return nullptr; }
}
extern "C" int psf_render(PsfPlayer* player, float* output, uint32_t frames) {
  if (!player || !output || frames>44100) return -1;
  lastError.clear();
  try {
    for(uint32_t at=0;at<frames;) {
      if(player->readFrame==64) {
        player->cpuDebt += 64*768; // 33,868,800 Hz / 44,100 Hz, exactly.
        uint32_t calls=0;
        while (player->cpuDebt>0) {
          int ticks=player->machine->ExecuteCpu(static_cast<int>(std::min<int64_t>(500,player->cpuDebt)));
          if(ticks<=0 || ++calls>65536) throw std::runtime_error("PSF CPU did not advance within its render budget.");
          player->machine->CountTicks(ticks);
          player->cpuDebt-=ticks;
          player->clocks+=ticks;
          while(player->clocks>=player->nextFrame) {
            player->machine->NotifyVBlankStart();
            player->machine->NotifyVBlankEnd();
            player->nextFrame+=33868800/player->refresh;
          }
        }
        player->machine->m_spuCore0.Render(player->samples,128);
        player->readFrame=0;
      }
      const uint32_t count=std::min<uint32_t>(64-player->readFrame,frames-at);
      for(uint32_t n=0;n<count*2;n++) output[at*2+n]=player->samples[player->readFrame*2+n]/32768.0f;
      player->readFrame+=count;
      at+=count;
    }
    return frames;
  } catch (const std::exception& error) { lastError=error.what(); return -1; }
}
extern "C" void psf_destroy(PsfPlayer* player) { delete player; }
