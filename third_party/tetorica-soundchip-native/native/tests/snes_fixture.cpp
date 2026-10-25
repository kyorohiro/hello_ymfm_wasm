// Offline PCM fixture and callback new/delete audit. No output device is opened.
#include "tetorica/snes.hpp"
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <new>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
namespace {
std::atomic<bool> audit{false};
std::atomic<unsigned> allocations{0},deallocations{0};
struct Event {uint32_t frame=0,a=0,b=0;std::string op;std::vector<uint8_t> bytes,registers;std::vector<uint32_t> words;};
uint32_t hex(const std::string& text){return static_cast<uint32_t>(std::stoul(text,nullptr,16));}
std::vector<uint8_t> bytes(const std::string& text){if(text.size()%2)throw std::runtime_error("Invalid hex bytes");std::vector<uint8_t> out(text.size()/2);for(size_t i=0;i<out.size();++i)out[i]=hex(text.substr(i*2,2));return out;}
void require(bool ok,const char*message){if(!ok)throw std::runtime_error(message);}
}
void* operator new(std::size_t n){if(audit.load())++allocations;if(void* p=std::malloc(n?n:1))return p;throw std::bad_alloc();}
void* operator new[](std::size_t n){return ::operator new(n);}
void operator delete(void* p)noexcept{if(p&&audit.load())++deallocations;std::free(p);}
void operator delete[](void* p)noexcept{::operator delete(p);}
void operator delete(void* p,std::size_t)noexcept{::operator delete(p);}
void operator delete[](void* p,std::size_t)noexcept{::operator delete(p);}
// Standalone public-ABI checks supplement the imported PCM/event fixture.
void standalone_contract_test(){
  require(!native_snes_create(7999),"Rate below 8 kHz accepted");
  for(uint32_t rate:{8000u,32000u,44100u,96000u,384000u}){
    void* chip=native_snes_create(rate);require(chip,"Boundary output rate rejected");
    float l=1,r=1;native_snes_sample(chip,&l,&r);
    require(l==0&&r==0,"New DSP did not start silent");native_snes_destroy(chip);
  }
  native_snes_destroy(nullptr);
  void* chip=native_snes_create(32000);require(chip,"Standalone creation failed");
  std::vector<uint8_t> copy(65536),timeline_ram(65536),timeline_dsp(128);
  const uint8_t wave[9]={0xb3,0x12,0x34,0x56,0x78,0x9a,0xbc,0xde,0xf0};
  std::copy(wave,wave+9,timeline_ram.begin()+0x400);
  timeline_ram[1]=timeline_ram[3]=4;
  timeline_dsp[0x6c]=0x20;timeline_dsp[0x0c]=timeline_dsp[0x1c]=127;
  timeline_dsp[0]=100;timeline_dsp[1]=73;timeline_dsp[3]=16;timeline_dsp[7]=127;
  const std::vector<uint8_t> initial_ram=timeline_ram,initial_dsp=timeline_dsp;
  const std::vector<uint32_t> events{0,0,0x4c,1,64,1,0x401,0x7f};
  float first[256]{};
  uint8_t directory[4]={0,4,0,4},upload[9];std::copy(wave,wave+9,upload);
  const uint8_t* view=native_snes_ram_data(chip);NativeSnesState before{},after{};
  audit=true;
  require(native_snes_load(chip,upload,0x400,9),"Copied RAM load failed");
  std::fill(upload,upload+9,0);
  require(std::memcmp(view+0x400,wave,9)==0,"RAM load retained caller buffer");
  const uint8_t edge=0x5a;
  require(native_snes_load(chip,&edge,65535,1)&&native_snes_read_memory(chip,65535)==edge,"Last RAM byte inaccessible");
  require(native_snes_load(chip,&edge,65536,0),"Empty end-of-RAM span rejected");
  require(!native_snes_load(chip,nullptr,0,1)&&!native_snes_load(nullptr,&edge,0,1)&&
          !native_snes_load(chip,&edge,65535,2)&&!native_snes_load(chip,&edge,65537,0)&&
          !native_snes_load(chip,&edge,1,UINT32_MAX),"Invalid RAM span accepted");
  require(native_snes_read_memory(chip,65535)==edge&&std::memcmp(view+0x400,wave,9)==0,"Rejected load changed RAM");
  require(native_snes_load(chip,directory,0,4),"Sample directory load failed");
  require(native_snes_read_memory(chip,0)==0&&native_snes_read_memory(chip,1)==4,"RAM boundary read differs");
  native_snes_write(chip,0x6c,0x20);native_snes_write(chip,0x0c,50);native_snes_write(chip,0x1c,47);
  // SPC_DSP resets to a hardware-like nonzero register image; author every
  // participating voice/global control instead of relying on power-on values.
  for(uint8_t reg:{0x2c,0x3c,0x2d,0x3d,0x4d,0x0d,0x5d})native_snes_write(chip,reg,0);
  for(uint8_t ch=0;ch<8;++ch){
    const uint8_t base=ch*16;native_snes_write(chip,base,50);native_snes_write(chip,base+1,47);
    native_snes_write(chip,base+2,0);native_snes_write(chip,base+3,16);
    native_snes_write(chip,base+4,0);native_snes_write(chip,base+5,0);native_snes_write(chip,base+6,0);native_snes_write(chip,base+7,127);
    native_snes_key_on(chip,ch);
  }
  native_snes_get_state(chip,&before);
  require(before.registers[0x4c]==255&&before.registers[0x5c]==0,"Same-frame eight-voice KON was lost");
  native_snes_write(chip,128,1);native_snes_write(chip,255,1);
  native_snes_key_on(chip,8);native_snes_key_on(chip,255);native_snes_key_off(chip,8);native_snes_key_off(chip,255);
  native_snes_get_state(chip,&after);require(std::memcmp(&before,&after,sizeof before)==0,"Invalid register/channel changed state");
  double energy=0;
  for(int i=0;i<2048;++i){float l,r;native_snes_sample(chip,&l,&r);require(std::isfinite(l)&&std::isfinite(r),"Eight-voice output nonfinite");energy+=std::abs(l)+std::abs(r);}
  native_snes_get_state(chip,&after);require(energy>1,"BRR voice test was silent");
  for(int ch=0;ch<8;++ch)require(after.registers[ch*16+8]>0,"One of eight voice envelopes did not advance");
  native_snes_stop(chip);native_snes_get_state(chip,&after);
  require(native_snes_ram_data(chip)==view&&std::memcmp(view+0x400,wave,9)==0&&after.registers[7]==127&&
          after.registers[0x0c]==50&&after.registers[0x4c]==0&&after.registers[0x5c]==255,"Stop lost memory/patch or retained a gate");
  for(int i=0;i<512;++i){float l=1,r=1;native_snes_sample(chip,&l,&r);require(l==0&&r==0,"Stop retained buffered voice output");}
  native_snes_reset(chip);native_snes_get_ram(chip,copy.data());native_snes_get_state(chip,&after);
  require(native_snes_ram_data(chip)==view&&std::all_of(copy.begin(),copy.end(),[](uint8_t x){return x==0;})&&
          after.registers[0x6c]==0xe0&&!after.native_frames&&!after.timeline_loaded,"Reset failed to clear RAM/DSP/timeline");
  native_snes_key_on(chip,0);native_snes_key_on(chip,7);
  native_snes_write_protected(chip,0x4c,0x42,0x81);native_snes_write_protected(chip,0x5c,0xff,0x81);
  native_snes_get_state(chip,&after);require(after.registers[0x4c]==0xc3&&after.registers[0x5c]==0x7e,"Protected KON/KOFF discarded a reserved voice");
  native_snes_prepare_timeline(chip,timeline_ram.data(),timeline_dsp.data(),events.data(),events.size()/4,128*32);
  native_snes_get_state(chip,&after);require(after.timeline_loaded&&!after.timeline_playing&&!after.timeline_position&&after.timeline_total==128,"Prepared timeline state differs");
  native_snes_stop_timeline(chip);native_snes_get_state(chip,&before);
  for(int i=0;i<17;++i){float l,r;native_snes_sample(chip,&l,&r);require(l==0&&r==0,"Prepared/paused timeline sounded");}
  native_snes_get_state(chip,&after);require(std::memcmp(&before,&after,sizeof before)==0,"Paused timeline advanced");
  require(native_snes_load(chip,&edge,0x400,1)&&view[0x400]==edge,"Core RAM edit failed");
  native_snes_play_timeline(chip);require(view[0x400]==wave[0],"Timeline restart did not restore borrowed initial RAM");
  for(int i=0;i<128;++i)native_snes_sample(chip,&first[i*2],&first[i*2+1]);
  native_snes_get_state(chip,&after);require(after.timeline_loaded&&!after.timeline_playing&&after.timeline_position==128&&view[0x401]==0x7f,"Timeline completion/event state differs");
  native_snes_play_timeline(chip);
  for(int i=0;i<128;++i){float l,r;native_snes_sample(chip,&l,&r);require(l==first[i*2]&&r==first[i*2+1],"Borrowed timeline restart changed PCM");}
  require(timeline_ram==initial_ram&&timeline_dsp==initial_dsp&&events[7]==0x7f,"Timeline mutated caller-owned arrays");
  native_snes_stop(chip);native_snes_get_state(chip,&after);require(!after.timeline_loaded&&!after.timeline_playing&&!after.timeline_position,"Stop retained timeline ownership");
  native_snes_play_timeline(chip);native_snes_get_state(chip,&after);require(!after.timeline_loaded&&!after.timeline_playing,"Detached timeline restarted");
  native_snes_prepare_timeline(chip,timeline_ram.data(),timeline_dsp.data(),nullptr,0,32);
  native_snes_reset(chip);native_snes_get_state(chip,&after);require(!after.timeline_loaded&&!after.timeline_playing,"Reset retained borrowed timeline");
  audit=false;native_snes_destroy(chip);
}
int self_test(){
  standalone_contract_test();
  require(!native_snes_create(0),"Invalid output rate accepted");
  require(!native_snes_create(384001),"Output rate above Native limit accepted");
  auto* high_rate=native_snes_create(384000);require(high_rate,"384 kHz output rate rejected");native_snes_destroy(high_rate);
  auto* c=native_snes_create(48000);require(c,"Creation failed");
  const uint8_t wave[9]={0xb3,0x12,0x34,0x56,0x78,0x9a,0xbc,0xde,0xf0};
  uint8_t directory[4]={0,4,0,4};require(native_snes_load(c,wave,0x400,9),"Upload failed");require(native_snes_load(c,directory,0,4),"Directory failed");require(!native_snes_load(c,wave,65535,9),"Overflow accepted");
  const uint8_t* ram_view=native_snes_ram_data(c);require(ram_view&&ram_view[0x400]==0xb3,"Borrowed RAM view differs from loaded memory");
  native_snes_write(c,0x6c,0x20);native_snes_write(c,0x0c,127);native_snes_write(c,0x1c,127);native_snes_write(c,0x5d,0);native_snes_write(c,0,100);native_snes_write(c,1,100);native_snes_write(c,3,0x10);native_snes_write(c,7,127);
  audit=true;native_snes_key_on(c,0);
  for(int i=0;i<4096;++i){float l,r;native_snes_sample(c,&l,&r);require(std::isfinite(l)&&std::isfinite(r),"Nonfinite output");}
  NativeSnesState state{};native_snes_get_state(c,&state);require(state.native_frames>2000,"DSP did not advance");native_snes_stop(c);native_snes_get_state(c,&state);require(state.registers[0x5c]==255&&state.registers[0x4c]==0,"Stop left gates open");require(native_snes_read_memory(c,0x400)==0xb3&&state.registers[7]==127,"Stop lost BRR/patch");require(native_snes_ram_data(c)==ram_view&&ram_view[0x400]==0xb3,"Stop invalidated the borrowed RAM allocation");native_snes_reset(c);require(native_snes_read_memory(c,0x400)==0,"Reset retained RAM");require(native_snes_ram_data(c)==ram_view&&ram_view[0x400]==0,"Reset invalidated the borrowed RAM allocation");audit=false;
  require(!allocations&&!deallocations,"Callback allocated or freed memory");native_snes_destroy(c);std::cerr<<"Native SNES rate/RAM-copy/bounds/eight-voice/protected-gates/Stop/reset/borrowed-timeline/callback allocation checks passed\n";return 0;
}
int extra_self_test(){
  static_assert(sizeof(NativeSnesState)==152,"Native S-DSP state ABI changed");
  auto* a=native_snes_create(48000);auto* b=native_snes_create(48000);auto* reference=native_snes_create(48000);require(a&&b&&reference,"Independent creation failed");
  const uint8_t wave[18]={0xb0,0x12,0x34,0x56,0x78,0x76,0x54,0x32,0x10,0xb3,0xfe,0xdc,0xba,0x98,0x9a,0xbc,0xde,0xf0};
  uint8_t directory[4]={0,4,0,4};
  for(void* p:{a,reference}){
    native_snes_load(p,wave,0x400,sizeof wave);native_snes_load(p,directory,0,4);
    native_snes_write(p,0x6c,0x20);native_snes_write(p,0x0c,127);native_snes_write(p,0x1c,127);
    native_snes_write(p,0,100);native_snes_write(p,1,73);native_snes_write(p,3,0x10);native_snes_write(p,7,127);native_snes_key_on(p,0);
  }
  std::vector<uint8_t> timeline_ram(65536),timeline_dsp(128),other_ram(65536),copy(65536);
  std::vector<uint32_t> events{0,0,0x5c,0,0,0,0x4c,1,1701,0,2,0x80,3333,1,0x402,0xff};
  std::copy(wave,wave+sizeof wave,timeline_ram.begin()+0x400);std::copy(directory,directory+4,timeline_ram.begin());
  timeline_dsp[0x6c]=0x20;timeline_dsp[0x0c]=timeline_dsp[0x1c]=127;timeline_dsp[0]=timeline_dsp[1]=100;timeline_dsp[3]=16;timeline_dsp[7]=127;
  other_ram=timeline_ram;
  const uint8_t* a_ram=native_snes_ram_data(a);const uint8_t* b_ram=native_snes_ram_data(b);
  NativeSnesState before{},after{};native_snes_get_state(b,&before);
  bool exact=true,isolated=true,read_pure=true,protected_gates=true;
  audit=true;
  for(uint32_t frame=0;frame<8192;++frame){
    NativeSnesState state{};native_snes_get_state(a,&state);native_snes_read_memory(a,0x400+(frame%18));
    if(frame%127==0)native_snes_get_ram(a,copy.data());
    float l,r,x,y;native_snes_sample(a,&l,&r);native_snes_sample(reference,&x,&y);exact=exact&&l==x&&r==y;
  }
  native_snes_get_state(b,&after);isolated=isolated&&std::memcmp(&before,&after,sizeof before)==0&&b_ram[0x400]==0;
  native_snes_get_state(a,&before);for(int i=0;i<1000;++i)native_snes_get_state(a,&after);read_pure=std::memcmp(&before,&after,sizeof before)==0;
  native_snes_stop(a);native_snes_get_state(a,&after);const bool stopped=a_ram==native_snes_ram_data(a)&&a_ram[0x400]==wave[0]&&after.registers[7]==127&&after.registers[0x4c]==0&&after.registers[0x5c]==255;
  native_snes_prepare_timeline(b,timeline_ram.data(),timeline_dsp.data(),events.data(),events.size()/4,4096*32);native_snes_play_timeline(b);
  for(int i=0;i<128;++i){float l,r;native_snes_sample(b,&l,&r);}
  native_snes_get_state(b,&before);native_snes_reset(a);native_snes_get_state(b,&after);
  const bool timeline_isolated=std::memcmp(&before,&after,sizeof before)==0&&after.timeline_loaded&&after.timeline_playing&&after.timeline_position>4&&timeline_ram==other_ram;
  const bool reset=a_ram==native_snes_ram_data(a)&&a_ram[0x400]==0;
  native_snes_key_on(a,0);native_snes_write_protected(a,0x4c,2,1);native_snes_write_protected(a,0x5c,255,1);native_snes_get_state(a,&after);protected_gates=after.registers[0x4c]==3&&after.registers[0x5c]==254;
  native_snes_stop_timeline(b);native_snes_get_state(b,&before);for(int i=0;i<64;++i){float l,r;native_snes_sample(b,&l,&r);require(l==0&&r==0,"Paused timeline sounded");}native_snes_get_state(b,&after);
  const bool pause_pure=before.timeline_loaded&&!after.timeline_playing&&before.timeline_position==after.timeline_position;
  audit=false;native_snes_destroy(a);native_snes_destroy(b);native_snes_destroy(reference);
  std::cout<<"{\"stateBytes\":"<<sizeof(NativeSnesState)<<",\"coreHeapBytes\":"<<native_snes_core_size()<<",\"independentInstances\":"<<(isolated?"true":"false")<<",\"readPure\":"<<(read_pure&&exact?"true":"false")<<",\"timelineIndependent\":"<<(timeline_isolated?"true":"false")<<",\"pausedTimelineDoesNotAdvance\":"<<(pause_pure?"true":"false")<<",\"protectedGates\":"<<(protected_gates?"true":"false")<<",\"stopRetainsRamAndPatch\":"<<(stopped?"true":"false")<<",\"resetClearsRam\":"<<(reset?"true":"false")<<",\"renderAllocations\":"<<allocations<<",\"renderFrees\":"<<deallocations<<"}\n";
  return isolated&&read_pure&&exact&&timeline_isolated&&pause_pure&&protected_gates&&stopped&&reset&&!allocations&&!deallocations?0:2;
}
int main(int argc,char**argv){void* c=nullptr;try{
  if(argc==2&&std::string(argv[1])=="--self-test")return self_test();
  if(argc==2&&std::string(argv[1])=="--self-test-extra")return extra_self_test();
  require(argc==3,"Usage: fixture output-rate frames");const uint32_t rate=std::stoul(argv[1]),frames=std::stoul(argv[2]);require(frames&&frames<16000000,"Invalid frame count");
  std::vector<Event> events;for(std::string line;std::getline(std::cin,line);){if(line.empty())continue;Event e;std::istringstream in(line);require(bool(in>>e.frame>>e.op)&&e.frame<frames,"Invalid event");std::string a,b;
    if(e.op=="write"){require(bool(in>>a>>b),"Invalid write");e.a=hex(a);e.b=hex(b);require(e.a<128&&e.b<256,"Register/value overflow");}
    else if(e.op=="load"){require(bool(in>>a>>b),"Invalid upload");e.a=hex(a);e.bytes=bytes(b);require(e.a<=65536&&e.bytes.size()<=65536-e.a,"RAM overflow");}
    else if(e.op=="key-on"||e.op=="key-off"){require(bool(in>>e.a)&&e.a<8,"Invalid channel");}
    else if(e.op=="timeline"){std::string ram,dsp;require(bool(in>>e.a>>ram>>dsp),"Invalid timeline");e.bytes=bytes(ram);e.registers=bytes(dsp);require(e.bytes.size()==65536&&e.registers.size()==128&&e.a>=32&&e.a%32==0,"Invalid timeline state");while(in>>a)e.words.push_back(hex(a));require(e.words.size()%4==0,"Invalid timeline events");}
    else require(e.op=="reset"||e.op=="stop"||e.op=="play-timeline"||e.op=="stop-timeline"||e.op=="read","Unknown event");events.push_back(std::move(e));}
  std::stable_sort(events.begin(),events.end(),[](const Event&a,const Event&b){return a.frame<b.frame;});std::vector<float> pcm(frames*2);c=native_snes_create(rate);require(c,"Creation failed");size_t index=0;audit=true;
  for(uint32_t frame=0;frame<frames;++frame){while(index<events.size()&&events[index].frame==frame){const auto& e=events[index++];if(e.op=="write")native_snes_write(c,e.a,e.b);else if(e.op=="load")native_snes_load(c,e.bytes.data(),e.a,e.bytes.size());else if(e.op=="key-on")native_snes_key_on(c,e.a);else if(e.op=="key-off")native_snes_key_off(c,e.a);else if(e.op=="reset")native_snes_reset(c);else if(e.op=="stop")native_snes_stop(c);else if(e.op=="timeline")native_snes_prepare_timeline(c,e.bytes.data(),e.registers.data(),e.words.data(),e.words.size()/4,e.a);else if(e.op=="play-timeline")native_snes_play_timeline(c);else if(e.op=="stop-timeline")native_snes_stop_timeline(c);else if(e.op=="read"){NativeSnesState state{};native_snes_get_state(c,&state);native_snes_read_memory(c,0x400);}}native_snes_sample(c,&pcm[frame*2],&pcm[frame*2+1]);}
  audit=false;require(!allocations&&!deallocations,"Callback allocated or freed memory");native_snes_destroy(c);c=nullptr;std::cout.write(reinterpret_cast<const char*>(pcm.data()),pcm.size()*sizeof(float));return std::cout?0:1;
}catch(const std::exception& e){audit=false;if(c)native_snes_destroy(c);std::cerr<<e.what()<<'\n';return 1;}}
