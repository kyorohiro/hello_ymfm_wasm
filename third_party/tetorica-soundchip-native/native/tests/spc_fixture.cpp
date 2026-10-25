// SPDX-License-Identifier: LGPL-2.1-or-later
// Device-free fixture. All Core/file/event/capture storage is prepared before
// the simulated callback; superseded Cores are destroyed afterward on control.
#include <tetorica/spc.hpp>
#include <algorithm>
#include <cassert>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <new>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
static bool measured=false;static uint64_t allocations=0,frees=0;
void *operator new(std::size_t n){if(measured)++allocations;if(void*p=std::malloc(n?n:1))return p;throw std::bad_alloc();}
void *operator new[](std::size_t n){return ::operator new(n);}
void operator delete(void*p)noexcept{if(measured&&p)++frees;std::free(p);}
void operator delete[](void*p)noexcept{::operator delete(p);}
void operator delete(void*p,std::size_t)noexcept{::operator delete(p);}
void operator delete[](void*p,std::size_t)noexcept{::operator delete(p);}
static void require(bool ok,const char* text){if(!ok)throw std::runtime_error(text);}
static std::vector<uint8_t> file(const std::string& name){std::ifstream in(name,std::ios::binary);require(bool(in),"Cannot open SPC fixture");return std::vector<uint8_t>(std::istreambuf_iterator<char>(in),{});}
static void* prepared(uint32_t rate,const std::vector<uint8_t>& bytes,uint32_t frames=0,uint32_t mute=0){
  void*p=native_spc_create(rate);require(p,"SPC allocation failed");require(native_spc_set_mute_mask(p,mute),"Mute rejected");require(native_spc_load_control(p,bytes.data(),bytes.size()),"SPC load failed");
  while(frames){const uint32_t count=std::min(frames,16000u);require(native_spc_seek_control(p,count),"SPC seek failed");frames-=count;}return p;
}
static uint32_t hash(const uint8_t*p,size_t n){uint32_t h=2166136261u;for(size_t i=0;i<n;++i)h=(h^p[i])*16777619u;return h;}
static std::vector<uint8_t> synthetic(){
  std::vector<uint8_t>b(0x10200);const char signature[]="SNES-SPC700 Sound File Data v0.30";std::copy(signature,signature+sizeof(signature)-1,b.begin());
  b[0x21]=b[0x22]=0x1a;b[0x23]=0x1b;b[0x24]=30;b[0x26]=2;b[0x2b]=0xef;
  const uint8_t program[10]={0x8f,0,0xf2,0xe8,0x20,0xc4,0xf3,0xbc,0x2f,0xfb};std::copy(program,program+10,b.begin()+0x300);
  auto*ram=b.data()+0x100,*dsp=b.data()+0x10100;ram[0x1001]=ram[0x1003]=0x20;
  const uint8_t wave[9]={0xc3,0x13,0x57,0x75,0x31,0xfd,0xb9,0x9b,0xdf};std::copy(wave,wave+9,ram+0x2000);
  dsp[0]=64;dsp[1]=48;dsp[3]=16;dsp[7]=127;dsp[0x0c]=dsp[0x1c]=127;dsp[0x4c]=1;dsp[0x5d]=0x10;dsp[0x6c]=0x20;return b;
}
// SDK contract checks use the authored synthetic program, independent of the
// optional user SPC accepted by the original command-line parity fixture.
struct CoreHandle {
  void *p;
  explicit CoreHandle(void *value) : p(value) {require(p,"SPC test allocation failed");}
  ~CoreHandle(){native_spc_destroy(p);}
  CoreHandle(const CoreHandle&)=delete;
  CoreHandle& operator=(const CoreHandle&)=delete;
};
static NativeSpcState get_state(void *p){NativeSpcState s{};native_spc_get_state(p,&s);return s;}
static bool same_position(const NativeSpcState&a,const NativeSpcState&b){return a.native_frames==b.native_frames&&a.base_native_frames==b.base_native_frames&&a.output_frames==b.output_frames&&a.playback_native_frames==b.playback_native_frames;}
static bool matching_samples(void *a,void *b,uint32_t frames){bool same=true;for(uint32_t i=0;i<frames;++i){float l,r,x,y;native_spc_sample(a,&l,&r);native_spc_sample(b,&x,&y);same=same&&l==x&&r==y;}return same;}
static bool silent_samples(void*p,uint32_t frames){bool silent=true;for(uint32_t i=0;i<frames;++i){float l=9,r=9;native_spc_sample(p,&l,&r);silent=silent&&l==0&&r==0;}return silent;}
static void extended_contracts(){
  static_assert(sizeof(NativeSpcEvent)==16,"Native SPC event ABI changed");
  const auto bytes=synthetic();
  require(!native_spc_create(0)&&!native_spc_create(7999)&&!native_spc_create(384001),"Invalid rate accepted");
  for(uint32_t rate:{8000u,32000u,384000u}){CoreHandle p(native_spc_create(rate));require(get_state(p.p).sample_rate==rate,"Valid rate changed");}
  native_spc_destroy(nullptr);
  require(!native_spc_load_control(nullptr,bytes.data(),bytes.size())&&!native_spc_seek_control(nullptr,0)&&!native_spc_set_playing(nullptr,0)&&!native_spc_set_mute_mask(nullptr,0)&&!native_spc_observe(nullptr,1,16),"Null control accepted");
  require(native_spc_error(nullptr),"Null error diagnostic absent");
  {
    CoreHandle p(native_spc_create(48000));
    auto s=get_state(p.p);require(!s.loaded&&!s.playing&&!s.failed&&!s.native_frames&&!s.output_frames,"Initial state changed");
    std::vector<uint8_t> snapshot(0x10200);
    require(!native_spc_snapshot(p.p,snapshot.data(),snapshot.size()),"Unloaded snapshot accepted");
    measured=true;require(silent_samples(p.p,10),"Unloaded core sounded");measured=false;
    require(!native_spc_set_playing(p.p,1)&&native_spc_error(p.p)&&get_state(p.p).failed,"Unloaded play did not fail");
    require(native_spc_set_mute_mask(p.p,255),"Initial mute rejected");
    require(native_spc_load_control(p.p,bytes.data(),bytes.size()),"Failed core did not recover on load");
    s=get_state(p.p);require(s.loaded&&!s.playing&&!s.failed&&s.mute_mask==255&&!s.native_frames&&!s.output_frames,"Reload did not reset state/retain mute");
    require(!native_spc_set_mute_mask(p.p,256)&&get_state(p.p).mute_mask==255,"Invalid mute changed mask");
    require(!native_spc_load_control(p.p,nullptr,bytes.size())&&native_spc_error(p.p),"Null input accepted");
    require(native_spc_load_control(p.p,bytes.data(),bytes.size()),"Null-load recovery failed");
    require(!native_spc_load_control(p.p,bytes.data(),0x1017f)&&native_spc_error(p.p),"Short SPC accepted");
    require(native_spc_load_control(p.p,bytes.data(),bytes.size()),"Short-load recovery failed");
    require(!native_spc_load_control(p.p,bytes.data(),16u*1024u*1024u+1u),"Oversize SPC accepted");
    require(native_spc_load_control(p.p,bytes.data(),0x10180),"Minimum SPC size rejected");
    for(size_t offset:{size_t(0),size_t(0x21),size_t(0x22),size_t(0x23)}){
      auto bad=bytes;bad[offset]=0;
      require(!native_spc_load_control(p.p,bad.data(),bad.size())&&get_state(p.p).failed,"Malformed header accepted");
      const auto before=get_state(p.p);measured=true;require(silent_samples(p.p,100),"Failed player sounded");measured=false;
      require(same_position(before,get_state(p.p))&&!native_spc_set_playing(p.p,1),"Failed player advanced/resumed");
      require(native_spc_load_control(p.p,bytes.data(),bytes.size())&&!native_spc_error(p.p),"Valid reload did not clear error");
    }
    auto v=bytes;v[0x23]=0x1a;require(native_spc_load_control(p.p,v.data(),v.size()),"Tagged SPC header rejected");
  }
  {
    auto mutable_file=bytes;
    CoreHandle a(prepared(48000,mutable_file)),b(prepared(48000,bytes));
    std::fill(mutable_file.begin(),mutable_file.end(),0xff);
    native_spc_set_playing(a.p,1);native_spc_set_playing(b.p,1);
    measured=true;require(matching_samples(a.p,b.p,2048),"SPC retained caller file storage");
    native_spc_set_playing(a.p,0);const auto paused=get_state(a.p);require(silent_samples(a.p,301),"Pause sounded");
    require(same_position(paused,get_state(a.p)),"Pause advanced state");native_spc_set_playing(a.p,1);
    require(matching_samples(a.p,b.p,2048),"Pause/resume changed cached samples");measured=false;
  }
  {
    CoreHandle a(prepared(48000,bytes)),b(prepared(48000,bytes));
    native_spc_set_playing(a.p,1);native_spc_set_playing(b.p,1);
    measured=true;require(matching_samples(a.p,b.p,97),"Mute setup differed");
    const auto before=get_state(a.p);require(before.native_frames==128&&before.output_frames==97,"Source lookahead changed");
    require(native_spc_set_mute_mask(a.p,255)&&matching_samples(a.p,b.p,32),"Mute incorrectly discarded buffered PCM");
    silent_samples(a.p,1024);require(silent_samples(a.p,256),"Full mute did not silence future rendering");
    require(native_spc_set_mute_mask(a.p,0),"Unmute failed");bool audible=false;
    for(uint32_t i=0;i<1024;++i){float l,r;native_spc_sample(a.p,&l,&r);audible=audible||l!=0||r!=0;}
    require(audible&&get_state(b.p).mute_mask==0,"Unmute/independent mute failed");measured=false;
  }
  {
    // Seek is incremental source CPU execution, not absolute playback time.
    CoreHandle a(prepared(48000,bytes)),b(prepared(48000,bytes));
    require(native_spc_seek_control(a.p,16000),"Maximum seek rejected");
    for(int i=0;i<4;++i)require(native_spc_seek_control(b.p,4000),"Incremental seek rejected");
    auto sa=get_state(a.p),sb=get_state(b.p);require(sa.native_frames==16000&&sa.base_native_frames==16000&&sa.output_frames==0&&sa.playback_native_frames==16000&&same_position(sa,sb),"Seek counters are not native-frame increments");
    std::vector<uint8_t> snap_a(0x10200),snap_b(0x10200);native_spc_snapshot(a.p,snap_a.data(),snap_a.size());native_spc_snapshot(b.p,snap_b.data(),snap_b.size());require(snap_a==snap_b,"Chunked seek changed CPU state");
    native_spc_set_playing(a.p,1);native_spc_set_playing(b.p,1);measured=true;require(matching_samples(a.p,b.p,2048),"Chunked seek changed samples");measured=false;
    require(!native_spc_seek_control(a.p,0)&&get_state(a.p).failed,"Playing seek accepted");
  }
  for(uint32_t advance:{0u,17u}){
    CoreHandle a(prepared(48000,bytes)),b(prepared(48000,bytes));
    native_spc_set_playing(a.p,1);float l,r;measured=true;native_spc_sample(a.p,&l,&r);native_spc_set_playing(a.p,0);measured=false;
    require(get_state(a.p).native_frames==128,"First sample no longer prefetches source block");
    require(native_spc_seek_control(a.p,advance)&&native_spc_seek_control(b.p,128+advance),"Prefetched seek failed");
    const auto s=get_state(a.p);require(s.native_frames==128+advance&&s.base_native_frames==advance&&!s.output_frames&&s.playback_native_frames==advance,"Seek incorrectly rewound to playback position");
    native_spc_set_playing(a.p,1);native_spc_set_playing(b.p,1);measured=true;require(matching_samples(a.p,b.p,1024),"Seek did not start from current prefetched CPU position");measured=false;
  }
  {
    CoreHandle p(prepared(48000,bytes));require(!native_spc_seek_control(p.p,16001)&&get_state(p.p).failed,"Oversize seek accepted");
    require(native_spc_load_control(p.p,bytes.data(),bytes.size()),"Seek failure reload failed");
    require(native_spc_observe(p.p,1,16)&&!native_spc_seek_control(p.p,1)&&get_state(p.p).failed,"Observed seek accepted");
  }
  {
    CoreHandle p(prepared(48000,bytes));
    std::vector<uint8_t> guarded(0x10202,0xa5),retained(0x10200),again(0x10200);
    require(!native_spc_snapshot(nullptr,guarded.data(),0x10200)&&!native_spc_snapshot(p.p,nullptr,0x10200)&&!native_spc_snapshot(p.p,guarded.data(),0x101ff),"Invalid snapshot accepted");
    require(std::all_of(guarded.begin(),guarded.end(),[](uint8_t x){return x==0xa5;}),"Rejected snapshot wrote storage");
    require(native_spc_snapshot(p.p,guarded.data()+1,0x10200)&&guarded.front()==0xa5&&guarded.back()==0xa5,"Snapshot exceeded workspace");
    native_spc_snapshot(p.p,retained.data(),retained.size());const auto retained_hash=hash(retained.data(),retained.size());
    native_spc_set_playing(p.p,1);measured=true;
    require(native_spc_observe(p.p,1,16),"Minimum observer capacity rejected");const auto*storage=native_spc_event_data(p.p);
    require(!native_spc_observe(p.p,1,15)&&!native_spc_observe(p.p,1,8193),"Invalid observer capacity accepted");
    silent_samples(p.p,8192);require(native_spc_event_data(p.p)==storage&&native_spc_event_count(p.p)==16,"Observer storage/count not bounded");
    bool ordered=true;for(uint32_t i=0;i<16;++i){ordered=ordered&&storage[i].reg<128&&storage[i].value<256&&(!i||storage[i].clock>=storage[i-1].clock);}require(ordered,"Observer order/fields invalid");
    native_spc_events_clear(p.p);require(!native_spc_event_count(p.p),"Observer clear failed");
    const auto lost=native_spc_overflow_take(p.p);require(lost>0&&!native_spc_overflow_take(p.p),"Observer clear/overflow counters conflated");
    silent_samples(p.p,256);require(native_spc_event_count(p.p)>0,"Observer did not refill");
    require(native_spc_observe(p.p,0,8192)&&!native_spc_event_count(p.p)&&!native_spc_overflow_take(p.p),"Observer disable did not clear queue");
    silent_samples(p.p,256);require(!native_spc_event_count(p.p),"Disabled observer recorded events");
    require(native_spc_observe(p.p,1,8192),"Maximum observer capacity rejected");
    uint8_t regs[128]{};native_spc_read_dsp_registers(p.p,regs);native_spc_snapshot(p.p,again.data(),again.size());
    require(std::equal(regs,regs+128,again.data()+0x10100),"DSP register/snapshot observations disagree");
    measured=false;
    require(hash(retained.data(),retained.size())==retained_hash,"Snapshot retained core-owned storage");
    require(native_spc_set_mute_mask(p.p,127)&&native_spc_load_control(p.p,bytes.data(),bytes.size()),"Reload while observed failed");
    const auto s=get_state(p.p);require(s.loaded&&!s.playing&&!s.failed&&s.mute_mask==127&&!s.native_frames&&!s.base_native_frames&&!s.output_frames&&!native_spc_event_count(p.p)&&!native_spc_overflow_take(p.p),"Reload did not reset observer/counters");
    native_spc_set_playing(p.p,1);measured=true;silent_samples(p.p,256);require(!native_spc_event_count(p.p),"Reload retained observer");measured=false;
  }
  {
    std::vector<uint8_t> retained(0x10200);uint32_t original_hash=0;
    {CoreHandle p(prepared(48000,bytes));require(native_spc_snapshot(p.p,retained.data(),retained.size()),"Lifetime snapshot failed");original_hash=hash(retained.data(),retained.size());}
    require(hash(retained.data(),retained.size())==original_hash,"Copied snapshot expired on core destruction");
  }
  require(!allocations&&!frees,"Extended callback allocation/free");
}

static int self_test(const std::vector<uint8_t>& bytes){
  extended_contracts();
  static_assert(sizeof(NativeSpcState)==56,"Native SPC state ABI changed");
  void*a=prepared(48000,bytes),*b=prepared(48000,bytes),*reference=prepared(48000,bytes);
  std::vector<uint8_t> before(0x10200),after(0x10200),scratch(0x10200);
  native_spc_snapshot(b,before.data(),before.size());native_spc_set_playing(a,1);native_spc_set_playing(reference,1);native_spc_observe(a,1,16);
  bool exact=true,read_pure=true;NativeSpcState state{},paused{};
  measured=true;
  for(uint32_t i=0;i<8192;++i){
    native_spc_get_state(a,&state);if(i%127==0)native_spc_snapshot(a,scratch.data(),scratch.size());
    float l,r,x,y;native_spc_sample(a,&l,&r);native_spc_sample(reference,&x,&y);exact=exact&&l==x&&r==y;
  }
  native_spc_snapshot(b,after.data(),after.size());const bool isolated=before==after;
  native_spc_get_state(a,&state);native_spc_snapshot(a,before.data(),before.size());
  for(uint32_t i=0;i<1000;++i){native_spc_get_state(a,&paused);native_spc_snapshot(a,after.data(),after.size());}
  read_pure=before==after&&std::memcmp(&state,&paused,sizeof state)==0;
  native_spc_set_playing(a,0);native_spc_get_state(a,&state);
  for(uint32_t i=0;i<1024;++i){float l,r;native_spc_sample(a,&l,&r);require(l==0&&r==0,"Paused SPC sounded");}
  native_spc_get_state(a,&paused);const bool pause=state.native_frames==paused.native_frames&&state.output_frames==paused.output_frames;
  const uint32_t events=native_spc_event_count(a),lost=native_spc_overflow_take(a);native_spc_events_clear(a);const bool bounded=events<=16&&native_spc_event_count(a)==0&&native_spc_overflow_take(a)==0;
  native_spc_observe(a,0,2048);native_spc_set_mute_mask(a,255);native_spc_get_state(b,&state);const bool mute=state.mute_mask==0;
  measured=false;native_spc_destroy(a);native_spc_destroy(b);native_spc_destroy(reference);
  std::cout<<"{\"coreHeapBytes\":"<<native_spc_core_size()<<",\"stateBytes\":"<<sizeof(NativeSpcState)<<",\"independentInstances\":"<<(isolated?"true":"false")<<",\"snapshotPure\":"<<(read_pure&&exact?"true":"false")<<",\"pauseFreezesPosition\":"<<(pause?"true":"false")<<",\"independentMute\":"<<(mute?"true":"false")<<",\"boundedObserver\":"<<(bounded?"true":"false")<<",\"observerEvents\":"<<events<<",\"observerOverflow\":"<<lost<<",\"extendedContracts\":true,\"renderAllocations\":"<<allocations<<",\"renderFrees\":"<<frees<<"}\n";
  return isolated&&read_pure&&exact&&pause&&bounded&&mute&&!allocations&&!frees?0:3;
}
struct Event{uint32_t frame=0,a=0,b=0;std::string op;void*core=nullptr;std::vector<uint8_t> snapshot;NativeSpcState state{};};
int main(int argc,char**argv){std::vector<void*> cores;try{
  if(argc==2&&std::string(argv[1])=="--self-test")return self_test(synthetic());
  if(argc==3&&std::string(argv[1])=="--self-test")return self_test(file(argv[2]));
  require(argc==3,"Usage: fixture output-rate frames; timeline on stdin");
  const uint32_t rate=std::strtoul(argv[1],nullptr,10),frames=std::strtoul(argv[2],nullptr,10);require(frames&&frames<=10000000,"Bad frame count");
  std::vector<Event> events;
  for(std::string line;std::getline(std::cin,line);){if(line.empty())continue;Event e;std::istringstream in(line);require(bool(in>>e.frame>>e.op)&&e.frame<frames,"Bad event frame");
    if(e.op=="install"){std::string path;uint32_t skip,mute,playing;require(bool(in>>path>>skip>>mute>>playing),"Bad prepared Core");e.core=prepared(rate,file(path),skip,mute);native_spc_set_playing(e.core,playing);cores.push_back(e.core);}
    else if(e.op=="mute")require(bool(in>>e.a),"Missing mute");
    else if(e.op=="observe")require(bool(in>>e.a>>e.b),"Missing observer options");
    else if(e.op=="read")e.snapshot.resize(0x10200);
    else require(e.op=="play"||e.op=="pause","Unknown fixture event");events.push_back(std::move(e));
  }
  std::stable_sort(events.begin(),events.end(),[](const Event&a,const Event&b){return a.frame<b.frame;});
  void*current=native_spc_create(rate);require(current,"Core create failed");cores.push_back(current);
  std::vector<float> pcm(size_t(frames)*2);std::vector<NativeSpcEvent> observed(size_t(frames)*64+8192);size_t count=0,next=0;uint64_t lost=0;
  measured=true;
  for(uint32_t frame=0;frame<frames;++frame){
    while(next<events.size()&&events[next].frame==frame){auto&e=events[next++];
      if(e.op=="install")current=e.core;
      else if(e.op=="mute")require(native_spc_set_mute_mask(current,e.a),"Mute failed");
      else if(e.op=="play")require(native_spc_set_playing(current,1),"Play failed");
      else if(e.op=="pause")require(native_spc_set_playing(current,0),"Pause failed");
      else if(e.op=="observe")require(native_spc_observe(current,e.a,e.b),"Observe failed");
      else if(e.op=="read"){native_spc_get_state(current,&e.state);require(native_spc_snapshot(current,e.snapshot.data(),e.snapshot.size()),"Snapshot failed");}
    }
    native_spc_sample(current,&pcm[frame*2],&pcm[frame*2+1]);
    const auto n=native_spc_event_count(current);require(count+n<=observed.size(),"Fixture observer exhausted");
    std::copy_n(native_spc_event_data(current),n,observed.begin()+count);count+=n;lost+=native_spc_overflow_take(current);native_spc_events_clear(current);
  }
  measured=false;for(void*p:cores)native_spc_destroy(p);cores.clear();require(!allocations&&!frees,"Callback allocation/free");
  std::cerr<<"{\"renderAllocations\":"<<allocations<<",\"renderFrees\":"<<frees<<",\"overflow\":"<<lost<<",\"reads\":[";bool comma=false;
  for(const auto&e:events)if(e.op=="read"){
    if(comma)std::cerr<<",";comma=true;
    const auto&s=e.state;std::cerr<<"{\"frame\":"<<e.frame<<",\"nativeFrames\":"<<s.native_frames<<",\"baseNativeFrames\":"<<s.base_native_frames<<",\"outputFrames\":"<<s.output_frames<<",\"muteMask\":"<<s.mute_mask<<",\"playing\":"<<s.playing<<",\"ramHash\":"<<hash(e.snapshot.data()+0x100,65536)<<",\"dsp\":[";
    for(uint32_t i=0;i<128;++i){if(i)std::cerr<<",";std::cerr<<unsigned(e.snapshot[0x10100+i]);}std::cerr<<"]}";
  }
  std::cerr<<"],\"events\":[";for(size_t i=0;i<count;++i){if(i)std::cerr<<",";std::cerr<<observed[i].clock<<","<<observed[i].reg<<","<<observed[i].value;}std::cerr<<"]}\n";
  require(std::fwrite(pcm.data(),sizeof(float),pcm.size(),stdout)==pcm.size(),"PCM output failed");return 0;
}catch(const std::exception&e){measured=false;for(void*p:cores)native_spc_destroy(p);std::cerr<<e.what()<<"\n";return 1;}}
