// SPDX-License-Identifier: LGPL-2.1-or-later
// Accurate S-DSP, shared with web/spc.js; no SPC700 CPU or ROM.
#include "native_genesis_snes.h"
#include "SPC_DSP.h"
#include <algorithm>
#include <array>
#include <cstring>
#include <new>
namespace {
struct Core {
  SPC_DSP dsp;
  std::array<uint8_t,65536> ram{};
  uint32_t rate, phase=0;
  uint64_t frames=0, kon_frame=UINT64_MAX, output_frames=0;
  uint8_t pending_kon=0;
  bool primed=false;
  float previous[2]{}, next[2]{};
  const uint8_t *timeline_ram=nullptr, *timeline_dsp=nullptr;
  const uint32_t* events=nullptr;
  uint32_t event_count=0, event_index=0, duration=0, clock=0, position=0;
  bool playing=false;
  explicit Core(uint32_t r):rate(r) {dsp.init(ram.data());dsp.reset();}
  void resampler_reset(){phase=0;primed=false;output_frames=0;}
  void clear_timeline(){timeline_ram=timeline_dsp=nullptr;events=nullptr;event_count=duration=clock=position=0;playing=false;}
  void restart_timeline(){
    std::memcpy(ram.data(),timeline_ram,ram.size());dsp.load(timeline_dsp);
    event_index=clock=position=0;frames=0;pending_kon=0;kon_frame=UINT64_MAX;resampler_reset();
  }
  void timeline_events(){
    while(event_index<event_count&&events[event_index*4]<=clock){
      const auto* e=events+event_index++*4;
      if(e[1])ram[e[2]]=static_cast<uint8_t>(e[3]);else dsp.write(e[2],e[3]);
    }
  }
  void pull(float out[2]){
    short pcm[2]{};
    if(timeline_ram){
      if(position>=duration/32){out[0]=out[1]=0;return;}
      if(position<4){++position;frames=position;out[0]=out[1]=0;return;}
      dsp.set_output(pcm,2);const uint32_t end=clock+32;
      while(clock<end){timeline_events();const uint32_t next_clock=event_index<event_count?std::min(end,events[event_index*4]):end;dsp.run(next_clock-clock);clock=next_clock;}
      timeline_events();frames=++position;
    }else{dsp.set_output(pcm,2);dsp.run(32);++frames;}
    out[0]=pcm[0]*(1.0f/32768.0f);out[1]=pcm[1]*(1.0f/32768.0f);
  }
  void sample(float* left,float* right){
    if(timeline_ram&&!playing){*left=*right=0;return;}
    if(!primed){pull(previous);pull(next);primed=true;}
    const double fraction=static_cast<double>(phase)/rate;
    *left=static_cast<float>(static_cast<double>(previous[0])+(static_cast<double>(next[0])-previous[0])*fraction);
    *right=static_cast<float>(static_cast<double>(previous[1])+(static_cast<double>(next[1])-previous[1])*fraction);
    phase+=32000;
    while(phase>=rate){phase-=rate;previous[0]=next[0];previous[1]=next[1];pull(next);}
    ++output_frames;
    if(timeline_ram&&output_frames*32000>=static_cast<uint64_t>(duration/32)*rate)playing=false;
  }
  void write(uint8_t reg,uint8_t value){dsp.write(reg,value);if(reg==0x4c){pending_kon=value;kon_frame=frames;}}
  void key_on(uint8_t ch){
    if(ch>7)return;dsp.write(0x5c,dsp.read(0x5c)&~(1<<ch));
    if(kon_frame!=frames){pending_kon=0;kon_frame=frames;}pending_kon|=1<<ch;dsp.write(0x4c,pending_kon);
  }
  void key_off(uint8_t ch){
    if(ch>7)return;pending_kon&=~(1<<ch);if(kon_frame==frames)dsp.write(0x4c,pending_kon);dsp.write(0x5c,dsp.read(0x5c)|(1<<ch));
  }
  void stop(){
    // Match SnesInstrumentProcessor.stopVoices, retaining RAM/authored settings.
    std::array<uint8_t,128> registers{};for(int i=0;i<128;++i)registers[i]=dsp.read(i);
    clear_timeline();dsp.reset();
    for(int i=0;i<128;++i)if(i!=0x4c&&i!=0x5c&&(i&15)!=8&&(i&15)!=9)dsp.write(i,registers[i]);
    dsp.write(0x4c,0);dsp.write(0x5c,255);frames=0;pending_kon=0;kon_frame=UINT64_MAX;resampler_reset();
  }
};
}
extern "C" {
void* native_snes_create(uint32_t rate){if(rate<8000||rate>384000)return nullptr;return new(std::nothrow)Core(rate);}
uint32_t native_snes_core_size(void){return sizeof(Core);}
void native_snes_destroy(void* p){delete static_cast<Core*>(p);}
void native_snes_reset(void* p){auto& c=*static_cast<Core*>(p);c.clear_timeline();c.ram.fill(0);c.dsp.reset();c.frames=0;c.pending_kon=0;c.kon_frame=UINT64_MAX;c.resampler_reset();}
void native_snes_stop(void* p){static_cast<Core*>(p)->stop();}
void native_snes_write(void* p,uint8_t reg,uint8_t value){if(reg<128)static_cast<Core*>(p)->write(reg,value);}
void native_snes_write_protected(void* p,uint8_t reg,uint8_t value,uint8_t mask){auto& c=*static_cast<Core*>(p);if(reg==0x4c){value=(value&~mask)|((c.kon_frame==c.frames?c.pending_kon:0)&mask);}else if(reg==0x5c){value=(value&~mask)|(c.dsp.read(reg)&mask);}if(reg<128)c.write(reg,value);}
void native_snes_key_on(void* p,uint8_t ch){static_cast<Core*>(p)->key_on(ch);}
void native_snes_key_off(void* p,uint8_t ch){static_cast<Core*>(p)->key_off(ch);}
int native_snes_load(void* p,const uint8_t* data,uint32_t address,uint32_t size){if(!p||(!data&&size)||address>65536||size>65536-address)return 0;std::memcpy(static_cast<Core*>(p)->ram.data()+address,data,size);return 1;}
void native_snes_sample(void* p,float* left,float* right){static_cast<Core*>(p)->sample(left,right);}
void native_snes_get_state(void* p,NativeSnesState* out){auto& c=*static_cast<Core*>(p);for(int i=0;i<128;++i)out->registers[i]=c.dsp.read(i);out->native_frames=c.frames;out->timeline_loaded=c.timeline_ram!=nullptr;out->timeline_playing=c.playing;out->timeline_position=c.position;out->timeline_total=c.duration/32;}
void native_snes_get_ram(void* p,uint8_t* out){std::memcpy(out,static_cast<Core*>(p)->ram.data(),65536);}
const uint8_t* native_snes_ram_data(const void* p){return static_cast<const Core*>(p)->ram.data();}
uint8_t native_snes_read_memory(void* p,uint16_t address){return static_cast<Core*>(p)->ram[address];}
void native_snes_prepare_timeline(void* p,const uint8_t* ram,const uint8_t* dsp,const uint32_t* events,uint32_t count,uint32_t duration){auto& c=*static_cast<Core*>(p);c.timeline_ram=ram;c.timeline_dsp=dsp;c.events=events;c.event_count=count;c.duration=duration;c.playing=false;c.restart_timeline();}
void native_snes_play_timeline(void* p){auto& c=*static_cast<Core*>(p);if(c.timeline_ram){c.restart_timeline();c.playing=true;}}
void native_snes_stop_timeline(void* p){auto& c=*static_cast<Core*>(p);c.playing=false;c.resampler_reset();}
}
