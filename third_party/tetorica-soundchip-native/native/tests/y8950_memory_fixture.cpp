// Device-free primary/independent Y8950 page-memory and PCM fixture.
#include <tetorica/opl.hpp>
#include <tetorica/y8950.hpp>
#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <new>
#include <sstream>
#include <string>
#include <vector>
static bool audit=false;static size_t allocations=0,frees=0;
void*operator new(std::size_t n){if(audit)++allocations;if(void*p=std::malloc(n?n:1))return p;throw std::bad_alloc();}
void*operator new[](std::size_t n){return ::operator new(n);}void operator delete(void*p)noexcept{if(audit&&p)++frees;std::free(p);}void operator delete[](void*p)noexcept{::operator delete(p);}void operator delete(void*p,std::size_t)noexcept{::operator delete(p);}void operator delete[](void*p,std::size_t)noexcept{::operator delete(p);}
struct Event{uint32_t frame=0,a=0,b=0;std::string op;std::vector<uint8_t>data;};
struct Chip{
 bool extra;void*p;uint32_t size=0,clock=3579545;std::vector<uint8_t>ram;
 explicit Chip(bool additional,uint32_t rate):extra(additional),p(extra?native_extra_opl_create(rate,3):native_opl_create(rate,3)),ram(2097152,0){assert(p);for(uint32_t i=0;i<512;++i)page(i,ram.data()+i*4096);}
 ~Chip(){if(extra)native_extra_opl_destroy(p);else native_opl_destroy(p);}
 void page(uint32_t i,uint8_t*data){if(extra)native_extra_opl_memory_page(p,i,data);else native_opl_memory_page(p,i,data);}
 void length(){if(extra)native_extra_opl_memory_length(p,size);else native_opl_memory_length(p,size);}
 void length(uint32_t bytes){if(extra)native_extra_opl_memory_length(p,bytes);else native_opl_memory_length(p,bytes);}
 uint64_t revision()const{return extra?native_extra_opl_memory_revision(p):native_opl_memory_revision(p);}
 uint64_t upload_revision()const{return extra?native_extra_opl_memory_upload_revision(p):native_opl_memory_upload_revision(p);}
 void write(uint16_t r,uint8_t v){if(extra)native_extra_opl_write(p,r,v);else native_opl_write(p,r,v);}
 void cancel(){if(extra)native_extra_opl_cancel_adpcm(p);else native_opl_cancel_adpcm(p);}
 void reset(){if(extra)native_extra_opl_reset(p);else native_opl_reset(p);}
 void stop(){if(extra)native_extra_opl_stop(p);else native_opl_stop(p);}
 void off_fm(uint8_t channel){if(extra)native_extra_opl_key_off_fm(p,channel);else native_opl_key_off(p,channel);}
 void snapshot(){if(extra){NativeExtraOplState state{};native_extra_opl_get_state(p,&state);}else{NativeOplState state{};native_opl_get_state(p,&state);}}
 void apply(const Event&e){
  if(e.op=="write")write(e.a,e.b);
  else if(e.op=="load"){assert(e.a<=ram.size()&&e.data.size()<=ram.size()-e.a);write(7,1);std::memcpy(ram.data()+e.a,e.data.data(),e.data.size());size=std::max(size,uint32_t(e.a+e.data.size()));length();}
  else if(e.op=="clear"){write(7,1);std::fill(ram.begin(),ram.end(),0);size=0;length();}
  else if(e.op=="clock"){assert(extra?native_extra_opl_set_clock(p,e.a):native_opl_set_clock(p,e.a));clock=e.a;}
  else if(e.op=="reset"){if(extra)native_extra_opl_reset(p);else native_opl_reset(p);}
  else if(e.op=="stop"){if(extra)native_extra_opl_stop(p);else native_opl_stop(p);}
  else if(e.op=="audition-adpcm"){if(extra)native_extra_opl_source_audition_key_on(p,23);else native_opl_audition_key_on(p,23);}
  else if(e.op=="off-adpcm"){if(extra)native_extra_opl_key_off_fm(p,23);else native_opl_key_off(p,23);}
  else std::abort();
 }
 void sample(float*o){if(extra)native_extra_opl_sample(p,o,o+1);else native_opl_sample(p,o,o+1);o[2]=extra?native_extra_opl_read_status(p):native_opl_read_status(p);o[3]=extra?native_extra_opl_get_irq(p):native_opl_get_irq(p);for(int i=0;i<4;++i)o[4+i]=extra?native_extra_opl_read(p,i):native_opl_read(p,i);o[8]=float(size);o[9]=float(clock);}
};

static void region(Chip &chip,uint32_t start,uint32_t end){
 assert(start<end&&end<=2097152&&!(start%32)&&!(end%32));
 chip.write(7,1);chip.write(8,2);
 const uint32_t first=start/32,last=end/32-1;
 chip.write(9,uint8_t(first));chip.write(10,uint8_t(first>>8));
 chip.write(11,uint8_t(last));chip.write(12,uint8_t(last>>8));
}
static void start(Chip &chip,uint32_t first=0,uint32_t last=4096){
 region(chip,first,last);chip.write(16,0xff);chip.write(17,0xff);
 chip.write(18,220);chip.write(7,0xb0);
}
static void record(Chip &chip,uint32_t address,uint8_t value){
 region(chip,address,address+64);chip.write(7,0x60);chip.write(15,value);
}
static void fm(Chip &chip,uint8_t channel=5){
 static constexpr uint8_t slots[9]={0,1,2,8,9,10,16,17,18};
 for(uint8_t slot:{slots[channel],uint8_t(slots[channel]+3)}){
  chip.write(0x20+slot,0x21);chip.write(0x40+slot,12);
  chip.write(0x60+slot,0xf0);chip.write(0x80+slot,15);
 }
 chip.write(0xc0+channel,1);chip.write(0xa0+channel,182);chip.write(0xb0+channel,0x31);
}
static float mono(Chip &chip){
 float values[10]{};chip.sample(values);
 for(float value:values)assert(std::isfinite(value));
 assert(values[0]==values[1]);return values[0];
}
static double advance(Chip &chip,uint32_t frames){
 double energy=0;while(frames--)energy+=std::abs(mono(chip));return energy;
}
static void equal_pcm(Chip &a,Chip &b,uint32_t frames,bool audible=false){
 double energy=0;while(frames--){const float x=mono(a),y=mono(b);assert(x==y);energy+=std::abs(y);}
 if(audible)assert(energy>.01);
}
static void memory_contract(bool extra){
 // All writable pages and replacement storage belong to this fixture. The
 // chip must neither allocate nor release any page during callback operations.
 std::array<uint8_t,4096> replacement{},outside{};
 Chip chip(extra,48000);std::fill(chip.ram.begin(),chip.ram.end(),0x55);
 assert(chip.revision()==0&&chip.upload_revision()==0);
 audit=true;
 chip.size=2097152;chip.length();assert(chip.revision()==1&&chip.upload_revision()==1);
 chip.page(512,outside.data());chip.length(2097153);
 assert(chip.revision()==1&&chip.upload_revision()==1);
 record(chip,2097088,0x73); // Last 4 KiB page, last two 32-byte blocks.
 assert(chip.ram[2097088]==0x73&&chip.ram[2097089]==0x55);
 assert(chip.revision()==2&&chip.upload_revision()==1);
 for(uint8_t byte:outside)assert(byte==0);

 chip.page(1,replacement.data());record(chip,4096,0x42);
 assert(replacement[0]==0x42&&replacement[1]==0&&chip.ram[4096]==0x55);
 assert(chip.revision()==3&&chip.upload_revision()==1);
 chip.page(1,nullptr);record(chip,4096,0x37);
 assert(chip.revision()==3&&replacement[0]==0x42);
 chip.page(1,replacement.data());chip.size=4096;chip.length();
 const auto revision=chip.revision();assert(revision==4&&chip.upload_revision()==revision);
 record(chip,4096,0x29);assert(replacement[0]==0x42&&chip.revision()==revision);
 chip.length(2097153);record(chip,4096,0x28); // Rejected length must not expand RAM.
 assert(replacement[0]==0x42&&chip.revision()==revision);
 chip.size=8192;chip.length();record(chip,4096,0x61);
 assert(replacement[0]==0x61&&chip.revision()==revision+2&&chip.upload_revision()==revision+1);
 chip.page(1,chip.ram.data()+4096);
 const auto retained=chip.revision(),uploaded=chip.upload_revision();
 chip.stop();chip.reset();assert(chip.revision()==retained&&chip.upload_revision()==uploaded);
 assert(chip.ram[2097088]==0x73&&replacement[0]==0x61);
 audit=false;assert(!allocations&&!frees);
 // Chip::~Chip destroys the core before its RAM vector; later normal vector
 // and replacement-array destruction exposes an erroneous ownership transfer.
}
static void unmapped_and_length_reads(bool extra){
 Chip sparse(extra,48000),zero(extra,48000);
 std::fill(sparse.ram.begin()+4096,sparse.ram.begin()+8192,0xff);
 sparse.page(1,nullptr);sparse.size=zero.size=8192;
 audit=true;sparse.length();zero.length();start(sparse,4096,8192);start(zero,4096,8192);
 equal_pcm(sparse,zero,2048);
 // A mapped page beyond the declared byte length must also read as zero.
 sparse.reset();zero.reset();sparse.page(1,sparse.ram.data()+4096);
 sparse.size=zero.size=4096;sparse.length();zero.length();
 start(sparse,4096,8192);start(zero,4096,8192);equal_pcm(sparse,zero,2048);
 audit=false;assert(!allocations&&!frees);
}
static void lifetime_clear_and_observation(bool extra){
 Chip observed(extra,48000),reference(extra,48000);
 for(Chip *chip:{&observed,&reference}){
  for(uint32_t i=0;i<8192;++i)chip->ram[i]=(i%4<2)?0x77:0xff;
  chip->size=8192;
 }
 audit=true;
 for(Chip *chip:{&observed,&reference}){chip->length();fm(*chip);start(*chip);}
 double energy=0;
 for(unsigned i=0;i<2048;++i){
  observed.snapshot();assert(observed.revision()==1&&observed.upload_revision()==1);
  const float x=mono(observed),y=mono(reference);assert(x==y);energy+=std::abs(x);
 }
 assert(energy>.1);
 for(Chip *chip:{&observed,&reference}){
  chip->stop();assert(advance(*chip,128)==0);chip->reset();
  assert(chip->ram[0]==0x77&&chip->ram[4096]==0x77&&chip->revision()==1);
  fm(*chip);start(*chip);
 }
 equal_pcm(observed,reference,2048,true);
 // Clear/replace is a host operation: reset ADPCM first, edit existing pages,
 // then publish the new length. FM continues identically to an ADPCM cancel.
 observed.cancel();reference.cancel();
 std::fill(observed.ram.begin(),observed.ram.end(),0);observed.size=0;observed.length();
 assert(observed.revision()==2&&observed.upload_revision()==2);
 equal_pcm(observed,reference,1024,true);
 std::fill(observed.ram.begin(),observed.ram.begin()+4096,0x77);
 observed.size=4096;observed.length();assert(observed.revision()==3);
 observed.reset();start(observed);assert(advance(observed,1024)>.1);
 audit=false;assert(!allocations&&!frees);
}
static void cancellation_and_hold(bool extra){
 Chip mixed(extra,96000),fm_only(extra,96000);
 std::fill(mixed.ram.begin(),mixed.ram.begin()+4096,0x77);mixed.size=4096;
 audit=true;mixed.length();fm(mixed);fm(fm_only);start(mixed);
 advance(mixed,1703);advance(fm_only,1703);
 assert(extra?native_extra_opl_set_clock(mixed.p,100000):native_opl_set_clock(mixed.p,100000));
 assert(extra?native_extra_opl_set_clock(fm_only.p,100000):native_opl_set_clock(fm_only.p,100000));
 advance(mixed,37);advance(fm_only,37);mixed.cancel();equal_pcm(mixed,fm_only,1000,true);
 // At a slow clock, ordinary ADPCM gate-off retains the previous DAC sample
 // until a chip interval, whereas explicit cancellation immediately restores FM.
 mixed.reset();fm_only.reset();start(mixed);fm(mixed);fm(fm_only);
 advance(mixed,1000);advance(fm_only,1000);
 const float held=mono(mixed);mono(fm_only);
 if(extra)native_extra_opl_key_off_fm(mixed.p,23);else native_opl_key_off(mixed.p,23);
 const float ordinary=mono(mixed),without_adpcm=mono(fm_only);
 assert(ordinary==held&&std::abs(ordinary-without_adpcm)>1e-5);
 mixed.cancel();equal_pcm(mixed,fm_only,1000,true);
 mixed.stop();fm_only.stop();assert(advance(mixed,128)==0&&advance(fm_only,128)==0);
 audit=false;assert(!allocations&&!frees);
}
static int self_test(){
 for(bool extra:{false,true}){
  memory_contract(extra);unmapped_and_length_reads(extra);
  lifetime_clear_and_observation(extra);cancellation_and_hold(extra);
 }
 std::puts("Y8950 primary/extra: caller-owned 4 KiB pages/2 MiB bounds, writable CPU RAM, revisions, sparse zero reads, replace/clear, retained Stop/reset memory, observed PCM and independent ADPCM/FM cancellation; callback allocations0/frees0");
 return 0;
}
int main(int argc,char**argv){if(argc==2&&std::string(argv[1])=="--self-test")return self_test();if(argc!=4)return 2;const bool extra=std::string(argv[1])=="extra";const auto rate=std::stoul(argv[2]),frames=std::stoul(argv[3]);if(frames>1000000)return 2;std::vector<Event>events;std::string line;
 while(std::getline(std::cin,line)){Event e;std::istringstream in(line);if(!(in>>e.frame>>e.op))continue;if(e.op=="write")in>>e.a>>e.b;else if(e.op=="clock")in>>e.a;else if(e.op=="load"){std::string hex;in>>e.a>>hex;assert(hex.size()%2==0);for(size_t i=0;i<hex.size();i+=2)e.data.push_back(uint8_t(std::stoul(hex.substr(i,2),nullptr,16)));}events.push_back(std::move(e));}
 std::stable_sort(events.begin(),events.end(),[](const Event&a,const Event&b){return a.frame<b.frame;});Chip chip(extra,rate);std::vector<float>out(frames*10);size_t next=0;audit=true;for(uint32_t frame=0;frame<frames;++frame){while(next<events.size()&&events[next].frame==frame)chip.apply(events[next++]);chip.sample(out.data()+frame*10);}audit=false;assert(allocations==0&&frees==0);return std::fwrite(out.data(),sizeof(float),out.size(),stdout)==out.size()?0:4;}
