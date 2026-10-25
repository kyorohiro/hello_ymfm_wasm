// Offline golden comparison and callback-allocation audit. No device is opened.
// argv: sample-rate base-clock frames fds0/1
// stdin: frame write HEX_ADDRESS HEX_VALUE | load HEX_OFFSET HEX_BYTES |
// enable CHANNEL 0/1 | mute MASK | clock HZ | reset | stop | stop-channel CHANNEL
// stdout: interleaved float32 stereo.
#include <tetorica/nes.hpp>
#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <new>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
namespace {
  std::atomic<bool> audit {
    false
  };
  std::atomic<uint64_t> allocations {
    0
  },deallocations {
    0
  };
  struct Event {
    uint32_t frame=0;
    std::string op;
    uint32_t a=0,b=0;
    std::vector<uint8_t>bytes;
  };
  uint32_t hex(const std::string&s) {
    size_t end=0;
    auto value=std::stoul(s,&end,16);
    if(end!=s.size()||value>0xffffffffUL)throw std::runtime_error("Invalid hex value");
    return static_cast<uint32_t>(value);
  }
}
void*operator new(std::size_t size) {
  if(audit.load(std::memory_order_relaxed))allocations.fetch_add(1,std::memory_order_relaxed);
  if(void*p=std::malloc(size?size:1))return p;
  throw std::bad_alloc();
}
void*operator new[](std::size_t size) {
  return ::operator new(size);
}
void operator delete(void*p)noexcept {
  if(p&&audit.load(std::memory_order_relaxed))deallocations.fetch_add(1,std::memory_order_relaxed);
  std::free(p);
}
void operator delete[](void*p)noexcept {
  ::operator delete(p);
}
void operator delete(void*p,std::size_t)noexcept {
  ::operator delete(p);
}
void operator delete[](void*p,std::size_t)noexcept {
  ::operator delete(p);
}
namespace {
  void requireContract(bool condition,const char *message) {
    if(!condition)throw std::runtime_error(message);
  }
  struct TestCore {
    void *ptr;
    explicit TestCore(uint32_t rate=48000,double clock=1789773,bool fds=true)
      :ptr(native_nes_create(rate,clock,fds)) {
      requireContract(ptr!=nullptr,"Contract test core creation failed");
    }
    ~TestCore() {native_nes_destroy(ptr);}
    TestCore(const TestCore&)=delete;
    TestCore&operator=(const TestCore&)=delete;
    operator void*()const {return ptr;}
  };
  struct CallbackAudit {
    CallbackAudit() {audit.store(true);}
    ~CallbackAudit() {audit.store(false);}
  };
  NativeNesState applied(void *core) {
    NativeNesState state{};
    native_nes_get_state(core,&state);
    return state;
  }
  void sameState(const NativeNesState &a,const NativeNesState &b,const char *message) {
    requireContract(!std::memcmp(&a,&b,sizeof a),message);
  }
  void render(void *core,unsigned count) {
    for(unsigned i=0;i<count;++i) {
      float l,r;native_nes_sample(core,&l,&r);
      requireContract(std::isfinite(l)&&std::isfinite(r)&&l==r,"NES stereo sample was nonfinite or asymmetric");
    }
  }
  void programApu(void *core,uint8_t mask) {
    native_nes_write(core,0x4015,mask);
    for(uint16_t base:{0x4000,0x4004}) {
      native_nes_write(core,base,0xbf);
      native_nes_write(core,base+2,0xfe);
      native_nes_write(core,base+3,1);
    }
    native_nes_write(core,0x4008,0xff);
    native_nes_write(core,0x400a,0x80);
    native_nes_write(core,0x400b,1);
    native_nes_write(core,0x400c,0x3f);
    native_nes_write(core,0x400e,2);
    native_nes_write(core,0x400f,8);
    uint8_t bytes[64];
    for(unsigned i=0;i<64;++i)bytes[i]=uint8_t(i*37+11);
    requireContract(native_nes_load(core,bytes,0xc000,sizeof bytes)==1,"DMC source upload failed");
    native_nes_write(core,0x4010,0x4f);
    native_nes_write(core,0x4011,64);
    native_nes_write(core,0x4012,0);
    native_nes_write(core,0x4013,3);
    native_nes_write(core,0x4015,mask);
  }
  void programFds(void *core,bool modulated=true) {
    native_nes_write(core,0x4023,2);
    native_nes_write(core,0x4089,128);
    for(unsigned i=0;i<64;++i)native_nes_write(core,0x4040+i,uint8_t(i));
    native_nes_write(core,0x4087,128);
    for(unsigned i=0;i<32;++i)native_nes_write(core,0x4088,uint8_t(i&7));
    native_nes_write(core,0x4084,0x88);
    native_nes_write(core,0x4085,0);
    native_nes_write(core,0x4086,0x40);
    native_nes_write(core,0x4087,modulated?1:128);
    native_nes_write(core,0x4089,0);
    native_nes_write(core,0x4080,0x9f);
    native_nes_write(core,0x4082,0x7b);
    native_nes_write(core,0x4083,3);
  }
  void extendedContractTest() {
    static_assert(sizeof(NativeNesState)==400,"Pinned NES applied-state layout changed");
    static_assert(offsetof(NativeNesState,clock)==384,"Pinned NES clock offset changed");
    for(uint32_t rate:{7999U,384001U,0xffffffffU})
      requireContract(!native_nes_create(rate,1789773,true),"Out-of-range output rate accepted");
    for(double clock:{1599999.,1900001.,std::numeric_limits<double>::infinity(),
                      -std::numeric_limits<double>::infinity(),std::numeric_limits<double>::quiet_NaN()})
      requireContract(!native_nes_create(48000,clock,true),"Nonfinite/out-of-range base clock accepted");
    for(uint32_t rate:{8000U,44100U,48000U,96000U,384000U}) {
      for(double clock:{1600000.,1662607.,1699999.,1700000.,1789773.,1900000.}) {
        TestCore core(rate,clock,false);
        CallbackAudit callback;
        native_nes_write(core,0x400e,2);native_nes_write(core,0x4010,15);
        const auto state=applied(core);
        requireContract(state.base_clock==clock&&state.clock==clock&&state.fds_enabled==0,"Creation changed base clock or FDS mode");
        requireContract(state.periods[3]==(clock<1700000?14U:16U)&&state.dmc_frequency==(clock<1700000?400U:432U),"PAL/NTSC table selection mismatch");
        programApu(core,15);render(core,128);
        requireContract(native_nes_set_clock(core,100000)==1,"Minimum output clock rejected");render(core,16);
        requireContract(native_nes_set_clock(core,100000000)==1,"Maximum output clock rejected");render(core,16);
        const auto changed=applied(core);
        requireContract(changed.base_clock==clock&&changed.clock==100000000&&changed.periods[3]==state.periods[3],"Clock change replaced base timing tables");
      }
    }
    {
      TestCore core,twin,plain(48000,1789773,false);
      CallbackAudit callback;
      programApu(core,3);programApu(twin,3);
      render(core,37);render(twin,37);
      const auto before=applied(core);
      for(uint32_t hz:{0U,99999U,100000001U,0xffffffffU})
        requireContract(!native_nes_set_clock(core,hz),"Invalid output clock accepted");
      for(uint16_t address:{0x3fff,0x4018,0x4022,0x4024,0x403f,0x408b,0xffff})native_nes_write(core,address,255);
      for(uint8_t channel:{uint8_t(5),uint8_t(255)}) {
        native_nes_enable(core,channel,true);native_nes_enable_channel(core,channel,true);
      }
      native_nes_stop_channel(core,255);
      sameState(before,applied(core),"Invalid ports/clocks/channels mutated applied state");
      const auto plainBefore=applied(plain);programFds(plain);
      sameState(plainBefore,applied(plain),"Plain NES accepted FDS writes");
      for(unsigned i=0;i<1024;++i) {
        float l,r,tl,tr;native_nes_sample(core,&l,&r);native_nes_sample(twin,&tl,&tr);
        requireContract(l==tl&&r==tr,"Rejected operation changed audio phase");
      }
      native_nes_write(core,0x4009,0xa5);native_nes_write(core,0x4014,0x5a);
      const auto shadow=applied(core);
      requireContract(shadow.registers[9]==0xa5&&shadow.registers[0x14]==0x5a,"Accepted APU register shadow did not retain authored bytes");
    }
    {
      TestCore core;
      std::array<uint8_t,65536> bytes{};
      for(unsigned i=0;i<bytes.size();++i)bytes[i]=uint8_t(i*29+7);
      CallbackAudit callback;
      requireContract(native_nes_load(core,bytes.data(),0,bytes.size())==1,"64 KiB RAM copy failed");
      const uint8_t first=bytes[0],last=bytes.back();bytes.fill(0);
      requireContract(native_nes_read_memory(core,0)==first&&native_nes_read_memory(core,0xffff)==last,"NES retained caller RAM pointer");
      const uint8_t edge=0x96;
      requireContract(native_nes_load(core,&edge,65535,1)==1&&native_nes_read_memory(core,0xffff)==edge,"Last RAM byte upload failed");
      for(uint32_t offset:{0U,65535U,65536U})requireContract(native_nes_load(core,nullptr,offset,0)==1,"Empty valid RAM upload rejected");
      requireContract(!native_nes_load(core,nullptr,0,1)&&!native_nes_load(core,&edge,65536,1)&&
                      !native_nes_load(core,&edge,65537,0)&&!native_nes_load(core,&edge,0xffffffffU,1)&&
                      !native_nes_load(core,&edge,1,0xffffffffU),"Invalid RAM upload accepted");
      requireContract(native_nes_read_memory(core,0)==first&&native_nes_read_memory(core,0xffff)==edge,"Rejected RAM upload mutated memory");
      native_nes_write(core,0x4010,15);native_nes_write(core,0x4012,255);native_nes_write(core,0x4013,4);native_nes_enable(core,4,true);
      auto state=applied(core);
      requireContract(state.dmc_address==0xffc1&&state.dmc_remaining==64,"DMC start/length register conversion mismatch");
      bool wrapped=false;
      for(unsigned i=0;i<100000&&native_nes_active_mask(core)&16;++i) {
        render(core,1);state=applied(core);
        requireContract(state.dmc_address>=0x8000&&state.dmc_address<=0xffff&&state.dmc_remaining<=64,"DMC address escaped RAM bounds");
        wrapped=wrapped||state.dmc_address==0x8001;
      }
      requireContract(wrapped&&state.dmc_address==0x8001&&state.dmc_remaining==0&&!(native_nes_active_mask(core)&16),"DMC did not wrap $ffff to $8000 or finish");
      native_nes_write(core,0x4010,0x8f);native_nes_write(core,0x4013,0);native_nes_enable(core,4,true);
      requireContract(applied(core).dmc_irq==1,"Final-byte DMA did not raise enabled DMC IRQ");
      native_nes_write(core,0x4010,15);requireContract(applied(core).dmc_irq==0,"DMC IRQ disable did not clear IRQ");
      native_nes_write(core,0x4010,0x4f);native_nes_enable(core,4,true);render(core,4096);
      requireContract(native_nes_active_mask(core)&16,"Looping one-byte DMC exhausted lifetime");
      native_nes_stop(core);
      requireContract(applied(core).dmc_remaining==0&&native_nes_read_memory(core,0xffff)==edge,"Stop retained DMA or cleared sample RAM");
    }
    {
      TestCore core,twin;
      CallbackAudit callback;
      // Register shadows retain writes even when the FDS hardware gate rejects them.
      native_nes_write(core,0x4040,0x7f);
      auto state=applied(core);
      requireContract(state.wave[0]==0&&state.registers[0x40]==0x7f,"FDS wave-write gate/shadow mismatch");
      native_nes_write(core,0x4089,128);native_nes_write(core,0x4040,0xff);
      requireContract(applied(core).wave[0]==0xff,"FDS wave upload lost authored byte");
      native_nes_write(core,0x4087,128);native_nes_write(core,0x4088,0xff);
      requireContract(applied(core).modulation[0]==7&&applied(core).fds_mod_index==2,"FDS modulation write/index mask mismatch");
      native_nes_write(core,0x4087,0);native_nes_write(core,0x4088,1);
      requireContract(applied(core).modulation[1]==0,"Running FDS modulation accepted table write");
      native_nes_write(core,0x4085,0x40);requireContract(applied(core).fds_mod_counter==-64,"FDS signed modulation counter conversion mismatch");
      native_nes_write(core,0x4085,0x7f);requireContract(applied(core).fds_mod_counter==-1,"FDS negative modulation counter conversion mismatch");
      native_nes_reset(core);programFds(core);programFds(twin,false);
      const auto before=applied(core);
      requireContract(before.fds_mod_frequency==320&&before.fds_sweep_gain==8&&before.fds_mod_enabled==1,"FDS modulation controls mismatch");
      double difference=0;
      for(unsigned i=0;i<4096;++i) {
        float l,r,tl,tr;native_nes_sample(core,&l,&r);native_nes_sample(twin,&tl,&tr);
        requireContract(std::isfinite(l)&&std::isfinite(r),"FDS modulation produced nonfinite PCM");difference+=std::abs(l-tl);
      }
      requireContract(difference>0.01&&applied(core).fds_accumulator!=applied(twin).fds_accumulator,"FDS modulation did not change oscillator/audio");
      for(unsigned i=0;i<256;++i) {state=applied(core);native_nes_active_mask(core);native_nes_read_memory(core,uint16_t(i));}
      sameState(state,applied(core),"FDS observation advanced modulation state");
      native_nes_write(core,0x4023,0);state=applied(core);
      native_nes_write(core,0x4082,1);native_nes_write(core,0x4080,128);native_nes_write(core,0x4040,0);
      auto gated=applied(core);
      requireContract(gated.fds_frequency==state.fds_frequency&&gated.fds_gain==state.fds_gain&&gated.wave[0]==state.wave[0]&&gated.registers[0x82]==1,"FDS IO gate/shadow mismatch");
      native_nes_stop(core);gated=applied(core);
      requireContract(gated.fds_active==1&&gated.fds_gain==31&&gated.fds_io==0,"Global Stop bypassed authored FDS IO gate");
      native_nes_stop_channel(core,5);gated=applied(core);
      requireContract(gated.fds_active==0&&gated.fds_gain==31&&gated.fds_io==0&&gated.fds_frequency==891,"FDS individual stop lost patch or failed with IO disabled");
      native_nes_write(core,0x4023,2);native_nes_stop(core);gated=applied(core);
      requireContract(!gated.fds_active&&gated.fds_gain==0&&gated.wave[63]==63&&gated.modulation[31]==7,"Global FDS Stop did not halt/zero gain and retain tables");
    }
    for(unsigned channel=0;channel<6;++channel) {
      TestCore audible,muted;
      CallbackAudit callback;
      const uint8_t bit=uint8_t(1U<<channel);
      for(void *chip:{audible.ptr,muted.ptr}) {
        programApu(chip,channel<5?bit:0);
        if(channel==5)programFds(chip);
      }
      const uint32_t active=native_nes_active_mask(audible);
      requireContract((active&bit)!=0,"Programmed source missing from active mask");
      const auto before=applied(muted);
      native_nes_set_mute(muted,bit);
      auto state=applied(muted);state.mute_mask=before.mute_mask;
      sameState(before,state,"Mute changed source state");
      double difference=0;
      for(unsigned i=0;i<2048;++i) {
        float l,r,ml,mr;native_nes_sample(audible,&l,&r);native_nes_sample(muted,&ml,&mr);
        requireContract(std::isfinite(l)&&std::isfinite(r)&&std::isfinite(ml)&&std::isfinite(mr),"Muted source produced nonfinite PCM");
        difference+=std::abs(l-ml)+std::abs(r-mr);
      }
      state=applied(muted);state.mute_mask=0;
      sameState(applied(audible),state,"Mute paused or changed source evolution");
      requireContract(difference>0.01&&native_nes_active_mask(muted)==native_nes_active_mask(audible),"Source mute failed to affect PCM or changed lifetime");
      native_nes_set_mute(muted,255);requireContract(applied(muted).mute_mask==63,"Mute mask did not clip to six sources");
      native_nes_set_mute(muted,0);native_nes_stop_channel(muted,uint8_t(channel));
      requireContract(!(native_nes_active_mask(muted)&bit),"Source stop left lifetime active");
    }
    for(unsigned channel=0;channel<6;++channel) {
      TestCore core;
      CallbackAudit callback;
      programApu(core,31);programFds(core);
      requireContract(native_nes_active_mask(core)==63,"Six-source gate fixture was not active");
      const auto before=applied(core);
      native_nes_stop_channel(core,uint8_t(channel));
      const auto after=applied(core);
      requireContract(native_nes_active_mask(core)==(63U&~(1U<<channel)),"Individual source gate changed sibling lifetime");
      for(unsigned sibling=0;sibling<4;++sibling)
        requireContract(after.lengths[sibling]==(sibling==channel?0U:before.lengths[sibling]),"Individual source gate changed sibling length");
      requireContract(!std::memcmp(before.wave,after.wave,sizeof before.wave)&&
                      !std::memcmp(before.modulation,after.modulation,sizeof before.modulation)&&
                      native_nes_read_memory(core,0xc000)==11,"Individual source gate lost shared RAM/wave/modulation");
      if(channel!=4)requireContract(after.dmc_address==before.dmc_address&&after.dmc_remaining==before.dmc_remaining&&after.dmc_output==before.dmc_output,"Other source gate disturbed DMC decoder");
      if(channel!=5)requireContract(after.fds_active==before.fds_active&&after.fds_accumulator==before.fds_accumulator,"APU source gate disturbed FDS");
      // Protected $4015 merges retain every selected gate, and do not revive a
      // stopped length counter or restart the protected DMC decoder.
      const uint8_t preserved=uint8_t(after.enable_mask);
      native_nes_write_enable(core,0,255);
      requireContract(applied(core).enable_mask==preserved,"Protected enable merge changed retained gates");
      native_nes_write_enable(core,0,0);
      requireContract(applied(core).enable_mask==0&&(native_nes_active_mask(core)&31)==0,"Unprotected enable merge left APU gates active");
    }
    {
      TestCore core,twin;
      CallbackAudit callback;
      for(void *chip:{core.ptr,twin.ptr}) {
        programApu(chip,31);programFds(chip);native_nes_set_clock(chip,2237216);native_nes_set_mute(chip,37);
        render(chip,193);native_nes_reset(chip);
      }
      const auto reset=applied(core);
      requireContract(reset.clock==2237216&&reset.base_clock==1789773&&reset.mute_mask==37&&reset.fds_enabled==1&&
                      reset.enable_mask==0&&reset.fds_io==1&&!reset.fds_active&&!reset.fds_mod_enabled,"Reset lost retained settings or failed to reset gates");
      for(uint8_t value:reset.registers)requireContract(value==0,"Reset retained register shadow");
      for(uint8_t value:reset.wave)requireContract(value==0,"Reset retained FDS wave");
      for(uint8_t value:reset.modulation)requireContract(value==0,"Reset retained FDS modulation");
      for(unsigned i=0;i<65536;++i)requireContract(native_nes_read_memory(core,uint16_t(i))==0,"Reset retained DMC RAM byte");
      programApu(core,3);programApu(twin,3);programFds(core);programFds(twin);
      for(unsigned i=0;i<2048;++i) {
        auto before=applied(core);native_nes_active_mask(core);native_nes_read_memory(core,uint16_t(i));
        sameState(before,applied(core),"Observation advanced reset/restarted core");
        float l,r,tl,tr;native_nes_sample(core,&l,&r);native_nes_sample(twin,&tl,&tr);
        requireContract(l==tl&&r==tr,"Repeated observation changed clock-resampled PCM");
      }
    }
  }
}
int selfTest() {
  auto require=[](bool condition,const char*message) {
    if(!condition)throw std::runtime_error(message);
  };
  require(!native_nes_create(0,1789773,true),"Invalid sample rate accepted");
  require(!native_nes_create(48000,1500000,true),"Invalid base clock accepted");
  void*core=native_nes_create(48000,1789773,true);
  require(core!=nullptr,"Creation failed");
  std::array<uint8_t,65536>ram {
  };
  for(size_t i=0;i<ram.size();++i)ram[i]=static_cast<uint8_t>(i*37+11);
  require(native_nes_load(core,ram.data(),0,ram.size())==1,"Full RAM upload failed");
  require(native_nes_load(core,ram.data(),65535,2)==0,"RAM overflow accepted");
  require(native_nes_load(core,nullptr,65536,0)==1,"Empty end-of-RAM upload failed");
  require(native_nes_read_memory(core,0xffff)==ram[0xffff],"RAM upload changed byte");
  native_nes_write(core,0x4023,2);
  native_nes_write(core,0x4089,128);
  for(int i=0;i<64;++i)native_nes_write(core,0x4040+i,i);
  native_nes_write(core,0x4087,128);
  for(int i=0;i<32;++i)native_nes_write(core,0x4088,i&7);
  native_nes_write(core,0x4089,2);
  native_nes_write(core,0x4080,128|31);
  native_nes_write(core,0x4082,123);
  native_nes_write(core,0x4083,3);
  NativeNesState state {
  };
  native_nes_get_state(core,&state);
  require(state.wave[63]==63&&state.modulation[31]==7,"FDS memory upload mismatch");
  require(state.fds_frequency==891&&state.fds_gain==31&&state.fds_master==2,"FDS applied controls mismatch");
  native_nes_write(core,0x4023,0);
  native_nes_write(core,0x4082,1);
  native_nes_get_state(core,&state);
  require(state.fds_frequency==891,"FDS IO disable ignored");
  native_nes_write(core,0x4023,2);
  native_nes_write(core,0x4010,79);
  native_nes_write(core,0x4012,0);
  native_nes_write(core,0x4013,2);
  native_nes_enable(core,4,true);
  native_nes_set_mute(core,37);
  require(native_nes_set_clock(core,2237216)==1,"Clock setter failed");
  audit.store(true);
  for(int i=0;i<5000;++i) {
    float l,r;
    native_nes_sample(core,&l,&r);
    require(std::isfinite(l)&&std::isfinite(r),"Nonfinite sample");
  }
  native_nes_stop(core);
  native_nes_get_state(core,&state);
  require(state.enable_mask==0&&state.dmc_remaining==0&&!state.fds_active&&state.fds_gain==0,"Stop left voices active");
  require(state.wave[63]==63&&state.modulation[31]==7&&state.fds_frequency==891,"Stop lost FDS patch");
  require(native_nes_read_memory(core,0xffff)==ram[0xffff],"Stop lost DMC RAM");
  native_nes_reset(core);
  native_nes_get_state(core,&state);
  require(state.wave[63]==0&&state.modulation[31]==0&&native_nes_read_memory(core,0xffff)==0,"Reset retained RAM");
  require(state.mute_mask==37&&state.clock==2237216,"Reset lost output settings");
  audit.store(false);
  void *second=native_nes_create(48000,1662607,false),*twin=native_nes_create(48000,1789773,true);
  require(second&&twin,"Independent core creation failed");
  auto program=[](void *chip) {
    native_nes_write(chip,0x4015,3);
    for(uint16_t base:{0x4000,0x4004}) {
      native_nes_write(chip,base,0xbf);
      native_nes_write(chip,base+2,0xfe);
      native_nes_write(chip,base+3,0x01);
    }
  };
  audit.store(true);
  native_nes_set_clock(core,1789773);native_nes_set_mute(core,0);native_nes_reset(core);
  native_nes_load(core,ram.data(),0,ram.size());native_nes_load(twin,ram.data(),0,ram.size());
  native_nes_load(second,ram.data()+1,0,ram.size()-1);
  program(core);program(twin);program(second);native_nes_set_clock(second,3325214);
  native_nes_write(core,0x4089,128);native_nes_write(core,0x4040,27);native_nes_write(core,0x4089,2);
  native_nes_write(twin,0x4089,128);native_nes_write(twin,0x4040,27);native_nes_write(twin,0x4089,2);
  native_nes_write(second,0x4089,128);native_nes_write(second,0x4040,49);
  NativeNesState before{},after{},other{};native_nes_get_state(core,&before);native_nes_get_state(second,&other);
  require(before.wave[0]==27&&other.wave[0]==0&&before.clock==1789773&&other.clock==3325214&&other.base_clock==1662607,"Independent wave/clock/FDS state changed");
  require(native_nes_read_memory(core,0)==ram[0]&&native_nes_read_memory(second,0)==ram[1],"DMC RAM isolation failed");
  for(unsigned i=0;i<300;++i){native_nes_get_state(core,&after);native_nes_active_mask(core);}
  require(!std::memcmp(&before,&after,sizeof before),"Observation mutated applied state");
  for(unsigned i=0;i<8192;++i){float l,r,tl,tr;native_nes_sample(core,&l,&r);native_nes_sample(twin,&tl,&tr);require(l==tl&&r==tr,"Observation changed phase or PCM");}
  native_nes_get_state(core,&before);native_nes_stop_channel(core,0);native_nes_get_state(core,&after);
  require((native_nes_active_mask(core)&3)==2&&after.enable_mask==2,"Individual APU stop changed other channel");
  require(!std::memcmp(before.registers,after.registers,0x15)&&after.wave[0]==27,"Individual APU stop lost patch or wave");
  native_nes_write(core,0x4080,151);native_nes_write(core,0x4083,1);
  native_nes_write(core,0x4087,128);native_nes_write(core,0x4088,7);native_nes_get_state(core,&before);
  require(native_nes_active_mask(core)&32,"FDS active mask missing");
  native_nes_write(core,0x4023,0);native_nes_stop_channel(core,5);native_nes_get_state(core,&after);
  require(!(native_nes_active_mask(core)&32)&&after.fds_gain==23&&after.wave[0]==27&&after.modulation[0]==7&&after.enable_mask==2&&after.fds_io==0&&after.registers[0x23]==0,"Individual FDS stop lost patch or sibling/IO");
  native_nes_write(core,0x4011,97);native_nes_stop_channel(core,4);native_nes_get_state(core,&after);
  require(after.dmc_output==0&&after.registers[0x11]==97&&after.enable_mask==2,"DMC stop retained DAC output or changed authored level/sibling");
  native_nes_stop_channel(core,255);native_nes_get_state(core,&state);require(!std::memcmp(&state,&after,sizeof state),"Invalid stop channel mutated core");
  native_nes_stop(core);native_nes_write(core,0x4010,15);native_nes_write(core,0x4012,0);native_nes_write(core,0x4013,0);native_nes_enable(core,4,true);
  require(native_nes_active_mask(core)&16,"DMC active lifetime missing last prefetched byte");
  for(unsigned i=0;i<4096;++i){float l,r;native_nes_sample(core,&l,&r);}
  require(!(native_nes_active_mask(core)&16),"Completed DMC remained held");
  require(!native_nes_set_clock(core,99999)&&!native_nes_set_clock(core,100000001),"Clock bounds accepted");
  require(native_nes_core_size()>=65536&&native_nes_core_size()<131072,"Core reservation must include one64KiB RAM and bounded fixed state");
  audit.store(false);
  void *dmcCore=native_nes_create(48000,1789773,false),*dmcTwin=native_nes_create(48000,1789773,false);
  require(dmcCore&&dmcTwin,"DMC gate-isolation core allocation failed");
  const uint8_t finalByte=0xff;
  audit.store(true);
  for(void *chip:{dmcCore,dmcTwin}) {
    native_nes_load(chip,&finalByte,0xc000,1);native_nes_write(chip,0x4010,15);native_nes_write(chip,0x4011,64);native_nes_write(chip,0x4012,0);native_nes_write(chip,0x4013,0);native_nes_enable(chip,4,true);
  }
  native_nes_get_state(dmcCore,&before);
  require(before.dmc_remaining==0&&(native_nes_active_mask(dmcCore)&16),"DMC final-byte fixture was not prefetched");
  native_nes_write_enable(dmcCore,0,16);native_nes_write_enable(dmcCore,16,16);
  native_nes_enable_channel(dmcCore,0,true);native_nes_stop_channel(dmcCore,0);native_nes_enable_channel(dmcCore,1,false);
  native_nes_get_state(dmcCore,&after);
  require(after.dmc_remaining==0&&after.dmc_address==before.dmc_address&&after.dmc_output==before.dmc_output&&(native_nes_active_mask(dmcCore)&16),"Protected enable mask refilled or truncated the prefetched DMC byte");
  for(unsigned i=0;i<2048;++i) {
    float l,r,tl,tr;native_nes_sample(dmcCore,&l,&r);native_nes_sample(dmcTwin,&tl,&tr);
    require(l==tl&&r==tr&&native_nes_active_mask(dmcCore)==native_nes_active_mask(dmcTwin),"Other gates changed DMC final-byte PCM or lifetime");
  }
  require(!(native_nes_active_mask(dmcCore)&16),"Protected mask restarted a completed DMC sample");
  audit.store(false);
  native_nes_destroy(dmcCore);native_nes_destroy(dmcTwin);
  require(allocations.load()==0&&deallocations.load()==0,"Audio callback allocated or freed memory");
  native_nes_destroy(core);native_nes_destroy(second);native_nes_destroy(twin);
  extendedContractTest();
  require(allocations.load()==0&&deallocations.load()==0,"Extended SDK callback contract allocated or freed memory");
  std::cerr<<"{\"extendedSdkContracts\":true,\"ratesAndBaseClockBounds\":true,\"palNtscTables\":true,\"copiedRamAndDmcWrap\":true,\"fdsModulationAndIoGates\":true,\"allSixMutesAdvanceSources\":true,\"independentInstances\":true,\"dmcRamIsolation\":true,\"fdsOffRejectsExpansionWrites\":true,\"readOnlyObservation\":true,\"stopPreservesRamWaveClock\":true,\"resetClearsMemoryPreservesClockMute\":true,\"individualChannelStop\":true,\"fdsIoDisabledStop\":true,\"dmcStopSilencesDacRetainsAuthoredLevel\":true,\"finiteDmcLifetime\":true,\"protectedDmcFinalBytePreservesPcmAndLifetime\":true,\"clockBounds\":true,\"coreHeapBytes\":"<<native_nes_core_size()<<",\"renderAllocations\":0,\"renderFrees\":0}\n";
  return 0;
}
int memoryCopyBenchmark() {
  constexpr unsigned trials=10000,maximum=16;
  std::array<void*,maximum> cores{};
  std::array<uint8_t,65536> bytes{};
  for(size_t i=0;i<bytes.size();++i)bytes[i]=uint8_t(i*37+19);
  for(auto &core:cores) {
    core=native_nes_create(48000,1789773,true);
    if(!core)throw std::runtime_error("Benchmark core allocation failed");
  }
  // Preallocate every sample and core before measuring. Timings include the
  // validated C ABI memcpy call, but exclude coverage/command/rack bookkeeping.
  std::vector<double> timings(trials);
  std::cout<<"{\"deviceOpened\":false,\"trials\":"<<trials<<",\"warmCache\":true,\"cases\":[";
  for(unsigned count:{1U,16U}) {
    for(unsigned warmup=0;warmup<200;++warmup)for(unsigned i=0;i<count;++i)native_nes_load(cores[i],bytes.data(),0,bytes.size());
    audit.store(true);
    for(unsigned trial=0;trial<trials;++trial) {
      const auto begin=std::chrono::steady_clock::now();
      for(unsigned i=0;i<count;++i)native_nes_load(cores[i],bytes.data(),0,bytes.size());
      timings[trial]=std::chrono::duration<double,std::micro>(std::chrono::steady_clock::now()-begin).count();
    }
    audit.store(false);
    std::sort(timings.begin(),timings.end());
    if(count!=1)std::cout<<',';
    std::cout<<"{\"instances\":"<<count<<",\"bytes\":"<<count*bytes.size()<<",\"medianMicroseconds\":"<<timings[trials/2]<<",\"p99Microseconds\":"<<timings[trials*99/100]<<",\"maximumMicroseconds\":"<<timings.back()<<'}';
  }
  std::cout<<"],\"renderAllocations\":"<<allocations.load()<<",\"renderFrees\":"<<deallocations.load()<<"}\n";
  for(auto core:cores)native_nes_destroy(core);
  if(allocations.load()||deallocations.load())throw std::runtime_error("Memory copy benchmark allocated or freed during application");
  return 0;
}
int main(int argc,char**argv) {
  void*core=nullptr;
  try {
    if(argc==2&&std::string(argv[1])=="--self-test")return selfTest();
    if(argc==2&&std::string(argv[1])=="--memory-copy-benchmark")return memoryCopyBenchmark();
    if(argc!=5)throw std::runtime_error("Usage: fixture sample-rate base-clock frames fds0/1");
    uint32_t rate=std::stoul(argv[1]),frames=std::stoul(argv[3]);
    double clock=std::stod(argv[2]);
    bool fds=std::stoul(argv[4])!=0;
    if(!frames||frames>16*1024*1024)throw std::runtime_error("Invalid frames");
    core=native_nes_create(rate,clock,fds);
    if(!core)throw std::runtime_error("Native NES creation failed");
    std::vector<Event>events;
    for(std::string line;std::getline(std::cin,line);) {
      if(line.empty())continue;
      std::istringstream in(line);
      Event event;
      if(!(in>>event.frame>>event.op)||event.frame>=frames)throw std::runtime_error("Invalid event");
      if(event.op=="write") {
        std::string a,b;
        if(!(in>>a>>b))throw std::runtime_error("Invalid write");
        event.a=hex(a);
        event.b=hex(b);
        if(event.a>65535||event.b>255)throw std::runtime_error("Write outside range");
      } else if(event.op=="load") {
        std::string a,data;
        if(!(in>>a>>data)||data.size()%2)throw std::runtime_error("Invalid RAM upload");
        event.a=hex(a);
        for(size_t i=0;i<data.size();i+=2) {
          auto byte=hex(data.substr(i,2));
          if(byte>255)throw std::runtime_error("Invalid RAM byte");
          event.bytes.push_back(byte);
        }
        if(event.a>65536||event.bytes.size()>65536-event.a)throw std::runtime_error("RAM outside range");
      } else if(event.op=="enable") {
        if(!(in>>event.a>>event.b)||event.a>4||event.b>1)throw std::runtime_error("Invalid enable");
      } else if(event.op=="stop-channel") {
        if(!(in>>event.a)||event.a>5)throw std::runtime_error("Invalid stop channel");
      } else if(event.op=="mute") {
        if(!(in>>event.a)||event.a>63)throw std::runtime_error("Invalid mask");
      } else if(event.op=="clock") {
        if(!(in>>event.a)||event.a<100000||event.a>100000000)throw std::runtime_error("Invalid clock");
      } else if(event.op!="reset"&&event.op!="stop")throw std::runtime_error("Unknown event");
      events.push_back(std::move(event));
    }
    std::stable_sort(events.begin(),events.end(),[](const Event&a,const Event&b) {
      return a.frame<b.frame;
    });
    std::vector<float>pcm(static_cast<size_t>(frames)*2);
    size_t next=0;
    audit.store(true);
    for(uint32_t frame=0;frame<frames;++frame) {
      while(next<events.size()&&events[next].frame==frame) {
        const auto&e=events[next++];
        if(e.op=="write")native_nes_write(core,e.a,e.b);
        else if(e.op=="load") {
          if(!native_nes_load(core,e.bytes.data(),e.a,e.bytes.size()))throw std::runtime_error("RAM upload failed");
        } else if(e.op=="enable")native_nes_enable(core,e.a,e.b!=0);
        else if(e.op=="mute")native_nes_set_mute(core,e.a);
        else if(e.op=="clock")native_nes_set_clock(core,e.a);
        else if(e.op=="reset")native_nes_reset(core);
        else if(e.op=="stop")native_nes_stop(core);
        else if(e.op=="stop-channel")native_nes_stop_channel(core,e.a);
      }
      native_nes_sample(core,&pcm[frame*2],&pcm[frame*2+1]);
    }
    audit.store(false);
    if(allocations.load()||deallocations.load())throw std::runtime_error("Audio callback allocated or freed memory");
    native_nes_destroy(core);
    core=nullptr;
    std::cout.write(reinterpret_cast<const char*>(pcm.data()),pcm.size()*sizeof(float));
    if(!std::cout)throw std::runtime_error("PCM output failed");
    return 0;
  } catch(const std::exception&error) {
    audit.store(false);
    if(core)native_nes_destroy(core);
    std::cerr<<error.what()<<'\n';
    return 1;
  }
}
