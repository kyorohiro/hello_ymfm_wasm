// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
// Play! supplies the PS1 CPU/HLE; the fixed Tetorica MAME port supplies all SPU audio.
#include <algorithm>
#include <array>
#include <cstring>
#include <functional>
#include <stdexcept>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>
#include "iop/Iop_SubSystem.h"
#include "psx/PsxBios.h"
#include "MemoryUtils.h"
#include "BasicBlock.h"
#include "Jitter_CodeGen_Wasm.h"
#include "spu.h"

extern "C" uint32 LWL_Proxy(uint32, uint32, CMIPS*);
extern "C" uint32 LWR_Proxy(uint32, uint32, CMIPS*);
extern "C" void SWL_Proxy(uint32, uint32, CMIPS*);
extern "C" void SWR_Proxy(uint32, uint32, CMIPS*);

namespace {
constexpr uint32_t cpuRamSize = 0x200000;
constexpr uint32_t spuRamSize = 0x80000;
constexpr uint32_t spuRegisterBase = 0x1f801c00;
constexpr uint32_t cyclesPerSample = 768; // 33,868,800 / 44,100, exactly.
struct BusEvent { uint32_t frame, kind, address, value; };
static_assert(sizeof(BusEvent) == 16, "Diagnostic trace ABI");

// Only the CPU bus wiring is added here. Gaussian interpolation, decoding,
// envelopes, mixing, PMON, Noise and reverb remain in the unchanged fixed core.
class PsfSpu final : public spu_device {
  // A build-only, read-only callback in generate_voice fills this optional
  // per-instance sink. The SDK source and its normal mixer remain unchanged.
  std::array<int32_t,48> dryVoiceFrame{};
  std::array<int32_t,48>* dryVoiceSink=nullptr;
public:
  std::function<void(uint32_t,uint32_t,uint32_t)> transferEvent;
  uint32_t transferAddress() const { return taddr >> 2; } // standard RAM mode
  uint32_t activeMask() const { return m_voice_active & 0xffffff; }
  bool irqPending() { return (read(0x1ae/2) & 0x40) != 0; }
  void captureVoice(unsigned int channel,unsigned int frame,int sample,int left,int right) noexcept {
    if(!dryVoiceSink || channel>=24 || frame!=0)return;
    // The isolated voice enters an empty int16 bus. In particular, the
    // (-32768 * -32768) corner saturates 32768 to 32767 like the real mixer.
    (*dryVoiceSink)[channel*2]=std::clamp((sample*left)>>15,-32768,32767);
    (*dryVoiceSink)[channel*2+1]=std::clamp((sample*right)>>15,-32768,32767);
  }
  void renderFrame(float* full,float* stems) {
    if(!stems){spu_device::render(full,full+1,1);return;}
    dryVoiceFrame.fill(0);
    struct SinkGuard {
      std::array<int32_t,48>*& sink;
      SinkGuard(std::array<int32_t,48>*& value,std::array<int32_t,48>& frame):sink(value){sink=&frame;}
      ~SinkGuard(){sink=nullptr;}
    } guard(dryVoiceSink,dryVoiceFrame);
    // Always generate the ordinary full mix, capture RAM, PMON, shared Noise,
    // envelopes and reverb, even when the caller listens to just one dry stem.
    spu_device::render(full,full+1,1);
    const bool enabled=(spureg.ctrl&0xc000)==0xc000;
    for(unsigned int channel=0;channel<24;channel++)for(unsigned int side=0;side<2;side++)
      stems[channel*2+side]=enabled ? float(dryVoiceFrame[channel*2+side])*float(spureg.mvolx[side])/1073741824.0f : 0.0f;
  }
  void transferIrq(uint32_t address) {
    if ((spureg.ctrl & 0x40) && address == uint32_t(spureg.irq_addr)*8)
      spureg.status |= 0x40;
  }
  void flushPio() {
    if ((spureg.ctrl&0x30)!=0x10) return;
    // The standalone core has no CPU-side FIFO timer. Drain at a full FIFO,
    // transfer-mode change, or the next 44.1-kHz boundary, never drop words.
    uint32_t address = transferAddress();
    for (uint32_t i=0; i<m_fifo_ptr; ++i, address=(address+2)&(spuRamSize-1)) {
      transferIrq(address);
      if (transferEvent) transferEvent(2,address,m_fifo[i]);
    }
    if (m_fifo_ptr) write_fifo();
  }
  uint16_t readBus(uint32_t offset) {
    // The data port has no documented CPU manual-read operation. Preserve the
    // fixed core's register readback instead of inventing a RAM read/cursor
    // advance; hardware RAM readback is provided by DMA4 below.
    return read(offset/2);
  }
  void writeBus(uint32_t offset,uint16_t value) {
    if (offset==0x1aa || offset==0x1ac || offset==0x1a6) flushPio();
    if (offset==0x1aa && (value&0x30)==0x10 && m_fifo_ptr) {
      // Drain words queued while stopped under the newly selected PIO/IRQ
      // mode. Keep the old control value for the core's register edge logic.
      const auto old=spureg.ctrl;
      spureg.ctrl=value;
      flushPio();
      spureg.ctrl=old;
    }
    if (offset==0x1a8 && m_fifo_ptr==m_fifo.size())
      throw std::runtime_error("PSF SPU data FIFO filled while manual transfer was stopped.");
    write(offset/2,value);
    if (offset==0x1a8 && m_fifo_ptr==m_fifo.size()) flushPio();
  }
  void dmaWord(uint32_t& value,bool toSpu) {
    const uint32_t address=transferAddress();
    transferIrq(address);
    transferIrq((address+2)&(spuRamSize-1));
    if (toSpu) {
      if (transferEvent) {
        transferEvent(2,address,value&0xffff);
        transferEvent(2,(address+2)&(spuRamSize-1),value>>16);
      }
      dma_write(&value,0,1);
    } else {
      dma_read(&value,0,1);
      if (transferEvent) {
        transferEvent(3,address,value&0xffff);
        transferEvent(3,(address+2)&(spuRamSize-1),value>>16);
      }
    }
  }
};
}

// Only the temporary build overlay calls this. One native sample is rendered
// at a time, so generate_voice's local frame index is always zero. No global
// selected channel, native register, decoder history or sample RAM is written.
extern "C" void psf_spu_voice_tap(const void* instance,unsigned int channel,unsigned int frame,
  int sample,int left,int right) noexcept {
  auto* core=static_cast<PsfSpu*>(static_cast<spu_device*>(const_cast<void*>(instance)));
  core->captureVoice(channel,frame,sample,left,right);
}

struct PsfPlayer {
  // Destroy machine first: its bus/IRQ callbacks refer to this SPU.
  PsfSpu spu;
  std::unique_ptr<Iop::CSubSystem> machine;
  uint64_t clocks=0, nextFrame=0;
  uint32_t refresh=60, renderedFrames=0;
  uint32_t keyGateMask=0;
  int64_t cpuDebt=0;
  std::string failure;
  uint32_t traceLimit=0;
  bool traceOverflow=false;
  std::vector<BusEvent> trace;

  void event(uint32_t kind,uint32_t address,uint32_t value) {
    if (!traceLimit) return;
    if (trace.size()==traceLimit) { traceOverflow=true; return; }
    trace.push_back({renderedFrames,kind,address,value});
  }
  void syncIrq() {
    if (spu.irqPending()) machine->m_intc.AssertLine(Iop::CIntc::LINE_SPU2);
    // I_STAT is latched independently: clearing SPUSTAT deasserts the source,
    // while the CPU still acknowledges I_STAT through its own register.
  }
  void write16(uint32_t offset,uint16_t value) {
    const bool volume=(offset<0x180 && (offset&15)<4) || offset==0x180 || offset==0x182;
    const bool sampleAddress=offset<0x180 && ((offset&15)==6 || (offset&15)==14);
    const char* unsupported = volume && (value&0x8000) ? "volume sweeps" :
      offset==0x1ac && (value&14)!=4 ? "nonstandard SPU RAM-control modes" :
      sampleAddress && (value&1) ? "ADPCM start/repeat addresses aligned to eight instead of sixteen bytes" : nullptr;
    if (unsupported) {
      char context[96];
      std::snprintf(context,sizeof(context)," (SPU +0x%03x = 0x%04x)",offset,unsigned(value));
      throw std::runtime_error(std::string("PSF fixed SPU does not support ")+unsupported+context+".");
    }
    event(1,offset,value);
    spu.writeBus(offset,value);
    if (offset==0x188 || offset==0x18a)
      keyGateMask|=(uint32_t(value)<<(offset==0x18a ? 16 : 0))&0xffffff;
    else if (offset==0x18c || offset==0x18e)
      keyGateMask&=~((uint32_t(value)<<(offset==0x18e ? 16 : 0))&0xffffff);
    syncIrq();
  }
  uint32_t readBus(uint32_t address,uint32_t width) {
    uint32_t offset=address-spuRegisterBase;
    if (width==1) {
      const uint32_t value=spu.readBus(offset&~1u);
      syncIrq();
      return (value>>((offset&1)*8))&255;
    }
    uint32_t value=spu.readBus(offset);
    if (width==4) value|=uint32_t(spu.readBus(offset+2))<<16;
    syncIrq();
    return value;
  }
  void writeBus(uint32_t address,uint32_t value,uint32_t width) {
    const uint32_t offset=address-spuRegisterBase;
    if (width==1) {
      // The PS1 SPU is a 16-bit bus: odd SB stores are ignored; even SB
      // stores drive the source CPU register's low sixteen bits, not a byte
      // read/modify/write. MemoryUtils preserves that source value for us.
      if (!(offset&1)) write16(offset,uint16_t(value));
    } else {
      write16(offset,uint16_t(value));
      if (width==4) write16(offset+2,uint16_t(value>>16));
    }
  }
  uint32_t dma(uint8_t* buffer,uint32_t blockSize,uint32_t blockAmount,uint32_t direction) {
    const uint32_t chcr=machine->m_dmac.ReadRegister(0x1f8010c8);
    if (((chcr>>9)&3)!=1 || (chcr&2))
      throw std::runtime_error("PSF DMA4 supports incrementing request-mode transfers only.");
    const uint32_t mode=spu.read(0x1aa/2)&0x30;
    if (!mode) return 0; // DMA can resume after the driver enables the transfer.
    if ((direction==1 && mode!=0x20) || (direction==0 && mode!=0x30) || (blockSize&3))
      throw std::runtime_error("PSF DMA4 direction/transfer mode is unsupported or inconsistent.");
    // Retain Play!'s bounded DMA progression; several game drivers depend on
    // executing between large transfers. CountTicks resumes remaining blocks.
    blockAmount=std::min<uint32_t>(blockAmount,direction==1 ? 0x100 : 0x10);
    spu.flushPio();
    // Play! supplies a raw RAM pointer; keep PS1's 2-MiB mirror wrapping even
    // when a DMA block crosses the end of physical CPU RAM.
    uint32_t address=uint32_t(reinterpret_cast<uintptr_t>(buffer)-reinterpret_cast<uintptr_t>(machine->m_ram))&(cpuRamSize-1);
    const uint64_t bytes=uint64_t(blockSize)*blockAmount;
    if (bytes>cpuRamSize*8u) throw std::runtime_error("PSF DMA4 transfer exceeds its bounded render budget.");
    for (uint64_t pos=0;pos<bytes;pos+=4,address=(address+4)&(cpuRamSize-1)) {
      uint32_t value=0;
      if (direction==1) for (uint32_t n=0;n<4;++n) value|=uint32_t(machine->m_ram[(address+n)&(cpuRamSize-1)])<<(n*8);
      spu.dmaWord(value,direction==1);
      if (direction==0) for (uint32_t n=0;n<4;++n) machine->m_ram[(address+n)&(cpuRamSize-1)]=uint8_t(value>>(n*8));
    }
    syncIrq();
    return blockAmount;
  }
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
extern "C" uint32_t psf_abi_version() { return 4; }
extern "C" uint32_t psf_spu_model() { return 1; } // fixed MAME-derived Tetorica SPU
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
    auto* p=player.get();
    p->spu.reset(true);
    p->spu.transferEvent=[p](uint32_t kind,uint32_t address,uint32_t value) { p->event(kind,address,value); };
    p->machine->m_cpu.m_pMemoryMap->SetSpuBusCallbacks(
      [p](uint32_t address,uint32_t width) { return p->readBus(address,width); },
      [p](uint32_t address,uint32_t value,uint32_t width) { p->writeBus(address,value,width); });
    p->machine->m_externalSpuIrqPending=[p]() { return p->spu.irqPending(); };
    p->machine->m_dmac.SetReceiveFunction(Iop::CDmac::CHANNEL_SPU0,
      [p](uint8_t* buffer,uint32_t size,uint32_t count,uint32_t direction) { return p->dma(buffer,size,count,direction); });
    return player.release();
  } catch (const std::exception& error) { lastError=error.what(); return nullptr; }
}
static int renderPsf(PsfPlayer* player,float* output,float* stems,uint32_t frames) {
  if (!player || !output || frames>44100) {lastError="Invalid PSF render buffers or size.";return -1;}
  if(stems) {
    const auto fullAt=reinterpret_cast<uintptr_t>(output),stemAt=reinterpret_cast<uintptr_t>(stems);
    const uintptr_t fullBytes=uintptr_t(frames)*2*sizeof(float),stemBytes=uintptr_t(frames)*48*sizeof(float);
    if(fullAt<stemAt+stemBytes && stemAt<fullAt+fullBytes) {lastError="PSF full mix and stem buffers must not overlap.";return -1;}
  }
  lastError.clear();
  try {
    if (!player->failure.empty()) throw std::runtime_error(player->failure);
    for (uint32_t at=0;at<frames;++at) {
      player->cpuDebt+=cyclesPerSample;
      uint32_t calls=0;
      while (player->cpuDebt>0) {
        const int ticks=player->machine->ExecuteCpu(static_cast<int>(std::min<int64_t>(500,player->cpuDebt)));
        if (ticks<=0 || ++calls>65536) throw std::runtime_error("PSF CPU did not advance within its render budget.");
        player->machine->CountTicks(ticks);
        player->cpuDebt-=ticks;
        player->clocks+=ticks;
        while (player->clocks>=player->nextFrame) {
          player->machine->NotifyVBlankStart();
          player->machine->NotifyVBlankEnd();
          player->nextFrame+=33868800/player->refresh;
        }
      }
      player->spu.flushPio();
      player->spu.renderFrame(output+at*2,stems ? stems+at*48 : nullptr);
      ++player->renderedFrames;
      player->syncIrq();
    }
    return frames;
  } catch (const std::exception& error) {
    player->failure=lastError=error.what();
    return -1;
  }
}
extern "C" int psf_render(PsfPlayer* player,float* output,uint32_t frames) {
  return renderPsf(player,output,nullptr,frames);
}
extern "C" int psf_render_stems(PsfPlayer* player,float* output,float* stems,uint32_t frames) {
  if(!stems){lastError="PSF stem output buffer is required.";return -1;}
  return renderPsf(player,output,stems,frames);
}
// Private, read-only numerical diagnostics. No additional audio path is exposed.
extern "C" uint32_t psf_spu_read(PsfPlayer* p,uint32_t offset) {
  return p && offset<=0x3fe && !(offset&1) ? p->spu.read(offset/2) : 0xffffffffu;
}
extern "C" uint32_t psf_spu_frames(PsfPlayer* p) { return p ? p->renderedFrames : 0; }
extern "C" uint32_t psf_spu_key_gates(PsfPlayer* p) { return p ? p->keyGateMask : 0; }
extern "C" uint32_t psf_spu_active_mask(PsfPlayer* p) { return p ? p->spu.activeMask() : 0; }
extern "C" int psf_spu_read_ram(PsfPlayer* p,uint32_t address,uint8_t* out,uint32_t length) {
  if (!p || !out || address>spuRamSize || length>spuRamSize-address) return 0;
  p->spu.read_ram(address,out,length); return 1;
}
extern "C" int psf_cpu_read_ram(PsfPlayer* p,uint32_t address,uint8_t* out,uint32_t length) {
  if (!p || !out || address>cpuRamSize || length>cpuRamSize-address) return 0;
  std::memcpy(out,p->machine->m_ram+address,length); return 1;
}
extern "C" int psf_trace_start(PsfPlayer* p,uint32_t maxEvents) {
  if (!p || maxEvents>262144) return 0;
  try { p->trace.clear(); p->trace.reserve(maxEvents); p->traceLimit=maxEvents; p->traceOverflow=false; return 1; }
  catch (...) { return 0; }
}
extern "C" uint32_t psf_trace_count(PsfPlayer* p) { return p ? p->trace.size() : 0; }
extern "C" int psf_trace_read(PsfPlayer* p,uint32_t index,BusEvent* out) {
  if (!p || !out || index>=p->trace.size()) return 0;
  *out=p->trace[index]; return 1;
}
extern "C" int psf_trace_overflow(PsfPlayer* p) { return p && p->traceOverflow ? 1 : 0; }
extern "C" void psf_destroy(PsfPlayer* player) { delete player; }
