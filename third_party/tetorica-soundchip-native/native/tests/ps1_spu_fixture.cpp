// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro
// Test transport plus independent specification vectors; no duplicate decoder or renderer.
#include <tetorica/ps1_spu.h>
#include "../examples/ps1_spu_pattern.hpp"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <new>
#include <vector>

namespace {
thread_local bool track_allocations=false;
thread_local unsigned allocations=0,frees=0;
void *allocate(std::size_t n) {
    if(track_allocations)++allocations;
    if(void *p=std::malloc(n?n:1))return p;
    throw std::bad_alloc();
}
void release(void *p) noexcept {if(track_allocations&&p)++frees;std::free(p);}
}
void *operator new(std::size_t n){return allocate(n);}
void *operator new[](std::size_t n){return allocate(n);}
void operator delete(void *p) noexcept {release(p);}
void operator delete[](void *p) noexcept {release(p);}
void operator delete(void *p,std::size_t) noexcept {release(p);}
void operator delete[](void *p,std::size_t) noexcept {release(p);}

static uint32_t read_u32()
{
    uint32_t value=0;
    for (unsigned shift=0;shift<32;shift+=8) {
        const int byte=std::getchar();if (byte==EOF)std::exit(2);
        value|=uint32_t(byte)<<shift;
    }
    return value;
}
static void write_u32(uint32_t value)
{
    for(unsigned shift=0;shift<32;shift+=8)std::putchar((value>>shift)&255);
}
static void write_float(float value)
{
    static_assert(sizeof(float)==4,"32-bit IEEE float output required");
    uint32_t bits;std::memcpy(&bits,&value,sizeof bits);write_u32(bits);
}
#define CHECK(condition) do { if (!(condition)) { std::fprintf(stderr,"check failed at line %d: %s\n",__LINE__,#condition);return 1; } } while(0)
static int live_editor_selftest()
{
    // This SDK's own tests exercise the opt-in editor API, without a browser
    // host or an application copy of the emulation algorithm.
    ps1_pattern::Chip edited,reference;
    for (auto *chip:{&edited,&reference}) {
        ps1_pattern::configure(*chip);ps1_pattern::voice(*chip,0);
        CHECK(ps1_spu_audition_key(chip->value,0,1));
        ps1_pattern::render(*chip,1009,127);
        chip->write(8,0x7f0f);
    }
    const uint32_t before=ps1_spu_read(edited.value,12);
    CHECK(before>0);CHECK(ps1_spu_refresh_envelope(edited.value,0));
    CHECK(ps1_spu_read(edited.value,12)==before);
    const auto a=ps1_pattern::render(edited,513,1),b=ps1_pattern::render(reference,513,127);
    CHECK(a.left==b.left&&a.right==b.right); // AR edits preserve held phase/level.
    CHECK(ps1_spu_audition_key(edited.value,0,0));
    const auto released=ps1_pattern::render(edited,257,7);
    CHECK(ps1_pattern::peak(std::vector<float>(released.left.begin()+20,released.left.begin()+70))>0);
    CHECK(std::all_of(released.left.begin()+200,released.left.end(),[](float v){return v==0;}));
    CHECK(ps1_spu_read(edited.value,10)==0x1fc0); // No authored RR rewrite.
    CHECK(ps1_spu_audition_key(reference.value,0,1));
    ps1_pattern::render(reference,13);
    CHECK(ps1_spu_audition_key(reference.value,0,0)); // Cancels deferred KON.
    CHECK(ps1_pattern::peak(ps1_pattern::render(reference,513).left)>0);
    CHECK(ps1_pattern::peak(ps1_pattern::render(reference,257).left)==0);
    return 0;
}
static bool same_audio(const ps1_pattern::Audio& a,const ps1_pattern::Audio& b)
{
    return a.left==b.left&&a.right==b.right;
}
static double tail_peak(const std::vector<float>& values,unsigned from)
{
    return ps1_pattern::peak(std::vector<float>(values.begin()+from,values.end()));
}
static std::array<uint8_t,64> predictive_wave()
{
    // Original 112-frame sine from the BSD Web encoder. Predictor 2 carries
    // nonzero ADPCM history across the loop, independently of its flag byte.
    return {{38,6,68,85,85,102,117,118,102,119,119,118,103,103,87,102,
        38,0,70,70,69,52,36,35,18,17,0,224,224,222,222,220,
        38,0,188,188,171,171,170,154,154,169,153,169,153,170,169,155,
        38,3,172,187,204,204,237,221,255,14,240,2,33,34,51,67}};
}
static int repeat_flags_selftest()
{
    // Address zero is a valid raw register address, not an absent-marker
    // sentinel. Capture will overwrite this reserved region during render;
    // only test the initial LSAX transfer before the first packet ends.
    for(unsigned flags:{4u,6u}) {
        ps1_pattern::Chip chip;ps1_pattern::configure(chip);
        auto bytes=predictive_wave();bytes[1]=uint8_t(flags);
        CHECK(ps1_spu_load_ram(chip.value,0,bytes.data(),bytes.size()));
        ps1_pattern::voice(chip,0);chip.write(6,0);ps1_pattern::key(chip,0,true);
        ps1_pattern::render(chip,8,1);CHECK(ps1_spu_read(chip.value,14)==0);
    }
    // PSX-SPX: Loop Start (4) independently sets LSAX; Repeat (2) matters
    // only on END. Thus 4/6 markers and 0/2 repeat targets have identical PCM.
    // References differ only in these semantically inert bits, never in data.
    for(bool marker:{false,true})for(unsigned packet:{0u,1u})
        for(unsigned pitch:{0x1000u,0x1234u,0x3fffu}) {
        ps1_pattern::Chip edited,reference;
        auto bytes=predictive_wave(),expected=bytes;
        bytes[1]=expected[1]=0;
        bytes[packet*16+1]=marker?4:0;
        expected[packet*16+1]=marker?6:2;
        for(auto *chip:{&edited,&reference}) {
            ps1_pattern::configure(*chip);
            const auto& source=chip==&edited?bytes:expected;
            CHECK(ps1_spu_load_ram(chip->value,ps1_pattern::address,source.data(),source.size()));
            ps1_pattern::voice(*chip,23,pitch);
            chip->write(23*16+14,(ps1_pattern::address+packet*16)/8);
            ps1_pattern::key(*chip,23,true);
        }
        const auto a=ps1_pattern::render(edited,16385,1),b=ps1_pattern::render(reference,16385,257);
        CHECK(same_audio(a,b)&&tail_peak(a.left,16000)>.01);
        CHECK(ps1_spu_read(edited.value,23*16+14)==(ps1_pattern::address+packet*16)/8);
        std::array<uint8_t,64> retained{};
        CHECK(ps1_spu_read_ram(edited.value,ps1_pattern::address,retained.data(),retained.size()));
        CHECK(retained==bytes); // Rendering must not repair or re-encode flags.
    }
    // A marker in an END+Mute sample must not turn it into a looping sample.
    for(unsigned pitch:{0x800u,0x3fffu}) {
        ps1_pattern::Chip marked,unmarked;
        for(auto *chip:{&marked,&unmarked}) {
            auto bytes=predictive_wave();bytes[1]=chip==&marked?4:0;bytes[49]=1;
            ps1_pattern::configure(*chip);
            CHECK(ps1_spu_load_ram(chip->value,ps1_pattern::address,bytes.data(),bytes.size()));
            ps1_pattern::voice(*chip,0,pitch);ps1_pattern::key(*chip,0,true);
        }
        const auto a=ps1_pattern::render(marked,4097,7),b=ps1_pattern::render(unmarked,4097,127);
        CHECK(same_audio(a,b)&&ps1_pattern::peak(a.left)>.01&&tail_peak(a.left,1024)==0);
        CHECK(ps1_spu_read(marked.value,0x19c)&1);
    }
    // Repeat can target an ordinary packet in a separately decoded cache.
    for(unsigned pitch:{0x1234u,0x3fffu}) {
        ps1_pattern::Chip edited,reference;
        constexpr unsigned target=ps1_pattern::address+0x100;
        for(auto *chip:{&edited,&reference}) {
            auto bytes=predictive_wave();bytes[1]=0;
            ps1_pattern::configure(*chip);
            CHECK(ps1_spu_load_ram(chip->value,ps1_pattern::address,bytes.data(),bytes.size()));
            bytes[1]=chip==&edited?0:2;
            CHECK(ps1_spu_load_ram(chip->value,target,bytes.data(),bytes.size()));
            ps1_pattern::voice(*chip,0,pitch);chip->write(14,target/8);ps1_pattern::key(*chip,0,true);
        }
        const auto a=ps1_pattern::render(edited,16385,7),b=ps1_pattern::render(reference,16385,257);
        CHECK(same_audio(a,b)&&tail_peak(a.left,16000)>.01);
    }
    // In-place cache refresh must reread both the independent marker and the
    // END Repeat bit, including END3 -> END1 -> END3 at an unchanged address.
    ps1_pattern::Chip updated,reference;
    for(auto *chip:{&updated,&reference}) {
        ps1_pattern::configure(*chip);ps1_pattern::voice(*chip,0,0x1234);ps1_pattern::key(*chip,0,true);
    }
    CHECK(same_audio(ps1_pattern::render(updated,1009),ps1_pattern::render(reference,1009)));
    for(unsigned end:{3u,1u,3u}) {
        for(auto *chip:{&updated,&reference}) {
            auto bytes=ps1_pattern::wave();bytes[1]=chip==&updated?4:6;bytes[49]=uint8_t(end);
            CHECK(ps1_spu_load_ram(chip->value,ps1_pattern::address,bytes.data(),bytes.size()));
        }
        const auto a=ps1_pattern::render(updated,1025,1),b=ps1_pattern::render(reference,1025,127);
        CHECK(same_audio(a,b));
        CHECK(end==1?tail_peak(a.left,512)==0:tail_peak(a.left,512)>.01);
        if(end==1)for(auto *chip:{&updated,&reference})ps1_pattern::key(*chip,0,true);
    }
    return 0;
}
static int full_ram_repeat_selftest()
{
    // The application-visible sample capacity remains 512 KiB minus capture
    // RAM. A marker near RAM's upper edge stresses history, END lookahead and
    // high-pitch overshoot without reserving or rewriting an extra packet.
    constexpr unsigned address=0x1000,bytes_count=0x80000-address;
    constexpr unsigned decoded_frames=bytes_count/16*28;
    std::vector<uint8_t> bytes(bytes_count,0),expected;
    for(unsigned packet=0;packet<bytes_count;packet+=16) {
        bytes[packet]=4;
        for(unsigned n=2;n<16;++n)bytes[packet+n]=uint8_t(0x21+(n%5)*0x11);
    }
    bytes[bytes_count-31]=4;bytes[bytes_count-15]=3;expected=bytes;expected[bytes_count-31]=6;
    ps1_pattern::Chip edited,reference;
    for(auto *chip:{&edited,&reference}) {
        ps1_pattern::configure(*chip);
        const auto& source=chip==&edited?bytes:expected;
        CHECK(ps1_spu_load_ram(chip->value,address,source.data(),source.size()));
        for(unsigned v=0;v<24;++v) {
            ps1_pattern::voice(*chip,v,0x3fff,0,0);
            chip->write(v*16+6,address/8);chip->write(v*16+14,(address+bytes_count-32)/8);
            ps1_pattern::key(*chip,v,true);
        }
        ps1_pattern::render(*chip,(decoded_frames*4096u+0x3ffe)/0x3fff+257);
        chip->write(0x18c,0xffff);chip->write(0x18e,0xff);ps1_pattern::render(*chip,257);
        for(unsigned v=0;v<24;++v) {
            chip->write(v*16,0x100);chip->write(v*16+2,0x80);
            chip->write(v*16+4,v%2?0x3fff:0x1234);
        }
    }
    std::array<float,257> a{},ar{},b{},br{};
    bool ok=true,equal=true,nonzero=false;
    allocations=frees=0;track_allocations=true;
    for(auto *chip:{&edited,&reference}) {
        ok=ps1_spu_write(chip->value,0x188,0xffff)&&ok;
        ok=ps1_spu_write(chip->value,0x18a,0xff)&&ok;
    }
    // Continue through the original END again, for both pitch groups.
    for(unsigned block=0;block<3200;++block) {
        ok=ps1_spu_render(edited.value,a.data(),ar.data(),a.size())&&ok;
        for(unsigned at=0;at<b.size();) {
            const unsigned n=std::min<unsigned>(7,b.size()-at);
            ok=ps1_spu_render(reference.value,b.data()+at,br.data()+at,n)&&ok;at+=n;
        }
        equal=equal&&a==b&&ar==br;
        for(float value:a)nonzero=nonzero||value!=0;
    }
    track_allocations=false;CHECK(ok&&equal&&nonzero&&allocations==0&&frees==0);
    std::vector<uint8_t> retained(bytes_count);
    CHECK(ps1_spu_read_ram(edited.value,address,retained.data(),retained.size()));CHECK(retained==bytes);
    return 0;
}
static int clear_reverb_selftest()
{
    CHECK(!ps1_spu_clear_reverb(nullptr));
    ps1_pattern::Chip cleared,reference,dry;
    for(auto *chip:{&cleared,&reference,&dry}) {
        ps1_pattern::configure(*chip);ps1_pattern::voice(*chip,0,0x1234,0x1800,0);
        ps1_pattern::voice(*chip,23,0x0d35,0,0x1000);
        ps1_pattern::room(*chip);chip->write(0x198,chip==&dry?0:1);
        ps1_pattern::key(*chip,0,true);ps1_pattern::key(*chip,23,true);
        ps1_pattern::render(*chip,8192);
    }
    std::array<uint32_t,512> registers{};
    for(unsigned i=0;i<registers.size();++i)registers[i]=ps1_spu_read(cleared.value,i*2);
    std::array<uint8_t,64> before{},after{};
    CHECK(ps1_spu_read_ram(cleared.value,ps1_pattern::address,before.data(),before.size()));
    allocations=frees=0;track_allocations=true;
    const bool ok=ps1_spu_clear_reverb(cleared.value)!=0;
    track_allocations=false;CHECK(ok&&allocations==0&&frees==0);
    for(unsigned i=0;i<registers.size();++i)CHECK(ps1_spu_read(cleared.value,i*2)==registers[i]);
    CHECK(ps1_spu_read_ram(cleared.value,ps1_pattern::address,after.data(),after.size()));
    CHECK(before==after);
    const auto a=ps1_pattern::render(cleared,257,1),b=ps1_pattern::render(reference,257,127),c=ps1_pattern::render(dry,257);
    CHECK(a.right==b.right&&a.right==c.right); //Foreign voice phase/level never changes.
    CHECK(a.left==c.left&&a.left!=b.left); //New delayed signal has not arrived yet.
    for(auto *chip:{&cleared,&reference}) {
        ps1_pattern::render(*chip,8192);ps1_pattern::key(*chip,0,false);ps1_pattern::key(*chip,23,false);
        ps1_pattern::render(*chip,2048);
    }
    CHECK(ps1_spu_clear_reverb(cleared.value));
    CHECK(ps1_pattern::peak(ps1_pattern::render(cleared,8193).left)==0);
    CHECK(ps1_pattern::peak(ps1_pattern::render(reference,8193).left)>0.00001);
    //Clearing preserves already-primed sample/loop caches for the next KON.
    std::array<float,1024> left{},right{};allocations=frees=0;track_allocations=true;
    const bool restarted=ps1_spu_write(cleared.value,0x188,1)&&
        ps1_spu_render(cleared.value,left.data(),right.data(),left.size());
    track_allocations=false;CHECK(restarted&&allocations==0&&frees==0);
    CHECK(*std::max_element(left.begin(),left.end())>0);
    return 0;
}
static int deferred_release_selftest()
{
    // No refresh call means ADSR changes stay deferred through both raw KOFF
    // and the smoothed manual Off path. Test Attack, Decay and held Sustain
    // independently, including the upper voice bank and a foreign right voice.
    struct Phase { unsigned adsr1; int direction; };
    constexpr Phase phases[]={{0x30a3,1},{0x00a3,-1},{0x000f,0}};
    constexpr unsigned channel=23,base=channel*16;
    for(const auto phase:phases)for(const bool manual:{false,true})for(const unsigned initial:{0u,31u}) {
        const unsigned deferred=initial==31?0:31;
        ps1_pattern::Chip edited,reference;
        for(auto *chip:{&edited,&reference}) {
            ps1_pattern::configure(*chip);ps1_pattern::voice(*chip,channel,0x1234,0x1800,0);
            ps1_pattern::voice(*chip,7,0x0d35,0,0x1000);ps1_pattern::key(*chip,7,true);
            chip->write(base+8,phase.adsr1);chip->write(base+10,0x1fc0|initial);
            if(manual)CHECK(ps1_spu_audition_key(chip->value,channel,1));
            else ps1_pattern::key(*chip,channel,true);
        }
        CHECK(same_audio(ps1_pattern::render(edited,1009,127),ps1_pattern::render(reference,1009,1)));
        const auto held=ps1_spu_read(edited.value,base+12);CHECK(held>0);
        CHECK(same_audio(ps1_pattern::render(edited,73,1),ps1_pattern::render(reference,73,31)));
        const auto later=ps1_spu_read(edited.value,base+12);
        CHECK(phase.direction>0?later>held:phase.direction<0?later<held:later==held);
        edited.write(base+10,0x1fc0|deferred);
        CHECK(same_audio(ps1_pattern::render(edited,31),ps1_pattern::render(reference,31)));
        const auto before_off=ps1_spu_read(edited.value,base+12);
        for(auto *chip:{&edited,&reference}) {
            if(manual)CHECK(ps1_spu_audition_key(chip->value,channel,0));
            else ps1_pattern::key(*chip,channel,false);
        }
        CHECK(ps1_spu_read(edited.value,base+12)==before_off);
        const auto tail=ps1_pattern::render(edited,257,7);
        CHECK(same_audio(tail,ps1_pattern::render(reference,257,127)));
        CHECK(initial==31?tail_peak(tail.left,200)>0:tail_peak(tail.left,200)==0);
        if(manual&&initial==0)CHECK(tail_peak(std::vector<float>(tail.left.begin(),tail.left.begin()+70),20)>0);
        CHECK(ps1_spu_read(edited.value,base+10)==(0x1fc0|deferred));
        // Repeated manual Off and raw Off must not reread the deferred words,
        // including when a manual-release floor was present on this voice.
        edited.write(base+10,0x1fc0|deferred); // Same authored value, still deferred.
        for(auto *chip:{&edited,&reference}) {
            if(manual)CHECK(ps1_spu_audition_key(chip->value,channel,0));
            else ps1_pattern::key(*chip,channel,false);
        }
        CHECK(same_audio(ps1_pattern::render(edited,67),ps1_pattern::render(reference,67)));
        for(auto *chip:{&edited,&reference})ps1_pattern::key(*chip,channel,false);
        CHECK(same_audio(ps1_pattern::render(edited,257,1),ps1_pattern::render(reference,257,127)));
        // The next actual KON, including a ramped restart, latches the new RR.
        reference.write(base+10,0x1fc0|deferred);
        for(auto *chip:{&edited,&reference}) {
            if(manual)CHECK(ps1_spu_audition_key(chip->value,channel,1));
            else ps1_pattern::key(*chip,channel,true);
        }
        CHECK(same_audio(ps1_pattern::render(edited,1009),ps1_pattern::render(reference,1009)));
        for(auto *chip:{&edited,&reference}) {
            if(manual)CHECK(ps1_spu_audition_key(chip->value,channel,0));
            else ps1_pattern::key(*chip,channel,false);
        }
        const auto next=ps1_pattern::render(edited,257);
        CHECK(same_audio(next,ps1_pattern::render(reference,257)));
        CHECK(deferred==31?tail_peak(next.left,200)>0:tail_peak(next.left,200)==0);
    }
    // Explicit refresh still changes a live infinite release without a restart
    // or level jump; the floor affects only the effective release, not its
    // latched RR. A foreign voice's sample phase/output remains bit-identical.
    for(const bool raw_second_off:{false,true}) {
        ps1_pattern::Chip edited,reference;
        for(auto *chip:{&edited,&reference}) {
            ps1_pattern::configure(*chip);ps1_pattern::voice(*chip,channel,0x1234,0x1800,0);
            ps1_pattern::voice(*chip,7,0x0d35,0,0x1000);ps1_pattern::key(*chip,7,true);
            chip->write(base+10,0x1fdf);CHECK(ps1_spu_audition_key(chip->value,channel,1));
            ps1_pattern::render(*chip,1009);CHECK(ps1_spu_audition_key(chip->value,channel,0));
            ps1_pattern::render(*chip,257);
        }
        edited.write(base+10,0x1fc0);
        for(auto *chip:{&edited,&reference}) {
            if(raw_second_off)ps1_pattern::key(*chip,channel,false);
            else CHECK(ps1_spu_audition_key(chip->value,channel,0));
        }
        CHECK(same_audio(ps1_pattern::render(edited,67),ps1_pattern::render(reference,67)));
        const auto before=ps1_spu_read(edited.value,base+12);CHECK(before>0);
        CHECK(ps1_spu_refresh_envelope(edited.value,channel));
        CHECK(ps1_spu_read(edited.value,base+12)==before);
        const auto a=ps1_pattern::render(edited,257),b=ps1_pattern::render(reference,257);
        CHECK(a.right==b.right);CHECK(a.left.front()==b.left.front());
        CHECK(tail_peak(a.left,200)==0&&tail_peak(b.left,200)>0);
    }
    // A long release remains long; the manual ramp is a minimum duration,
    // not a forced fixed-duration envelope or a reason to read new registers.
    ps1_pattern::Chip edited,reference;
    for(auto *chip:{&edited,&reference}) {
        ps1_pattern::configure(*chip);ps1_pattern::voice(*chip,0);
        chip->write(10,0x1fca);CHECK(ps1_spu_audition_key(chip->value,0,1));
        ps1_pattern::render(*chip,1009);
    }
    edited.write(10,0x1fc0);
    for(auto *chip:{&edited,&reference})CHECK(ps1_spu_audition_key(chip->value,0,0));
    const auto long_tail=ps1_pattern::render(edited,257);
    CHECK(same_audio(long_tail,ps1_pattern::render(reference,257)));
    CHECK(tail_peak(long_tail.left,200)>0);
    CHECK(same_audio(ps1_pattern::render(edited,4097),ps1_pattern::render(reference,4097)));
    CHECK(ps1_pattern::peak(ps1_pattern::render(edited,257).left)==0);
    return 0;
}
// Independent PSX-SPX coefficient rows, in oldest..new order. No core table
// access: catch ordering, signed per-product rounding and high-pitch history.
static int gaussian_selftest()
{
    constexpr int coefficients[3][4]={{0x12c7,0x59b3,0x1307,-1},
        {0x019c,0x3def,0x3e4c,0x01a8},{-1,0x1307,0x59b3,0x12c7}};
    for (unsigned pitch:{0x800u,0x1000u,0x3fffu}) {
        ps1_pattern::Chip chip;
        ps1_pattern::configure(chip);
        uint8_t bytes[16]={4,3};
        for (unsigned n=0;n<28;++n) bytes[2+n/2]|=uint8_t((int(n%16)-8)&15)<<((n&1)*4);
        CHECK(ps1_spu_load_ram(chip.value,ps1_pattern::address,bytes,16));
        ps1_pattern::voice(chip,0,pitch,0x3fff,0x3fff);ps1_pattern::key(chip,0,true);
        const auto audio=ps1_pattern::render(chip,8192,17);
        unsigned checked=0;
        for(unsigned t=256;t<audio.left.size();++t) {
            const unsigned position=t*pitch,i=(position>>4)&255;
            if (i!=0 && i!=128 && i!=255) continue;
            const int *row=coefficients[i==0?0:i==128?1:2];
            int sum=0;
            for(int k=0;k<4;++k) {
                const int n=int(position>>12)-3+k;
                const int sample=n<0?0:((n%28)%16-8)*256;
                sum+=int(std::floor(double(row[k])*sample/32768));
            }
            const int voice=(sum*32766)>>15;
            const float expected=float(float(voice*32766)/1073741824.0f);
            CHECK(audio.left[t]==expected);CHECK(audio.right[t]==expected);++checked;
        }
        CHECK(checked>16);
        // KON clears old interpolation history even when sample RAM is retained.
        ps1_pattern::key(chip,0,true);
        const auto restart=ps1_pattern::render(chip,64,1);
        CHECK(std::equal(restart.left.begin(),restart.left.end(),audio.left.begin()));
    }
    return 0;
}
static int headroom_selftest()
{
    ps1_pattern::Chip legacy, precise, split;
    for(auto *chip:{&legacy,&precise,&split}) {
        ps1_pattern::configure(*chip);
        auto bytes=ps1_pattern::wave();for(unsigned block=0;block<4;block++)bytes[block*16]=0;
        CHECK(ps1_spu_load_ram(chip->value,ps1_pattern::address,bytes.data(),bytes.size()));
        ps1_pattern::voice(*chip,0,0x1234,0x3000,0x7000);
    }
    CHECK(!ps1_spu_set_mix_headroom(nullptr,4));CHECK(!ps1_spu_set_mix_headroom(precise.value,0));
    CHECK(!ps1_spu_set_mix_headroom(precise.value,33));
    CHECK(ps1_spu_set_mix_headroom(precise.value,4));CHECK(ps1_spu_set_mix_headroom(split.value,4));
    for(auto *chip:{&legacy,&precise,&split})ps1_pattern::key(*chip,0,true);
    const auto original=ps1_pattern::render(legacy,16385),wide=ps1_pattern::render(precise,16385),parts=ps1_pattern::render(split,16385,127);
    CHECK(wide.left==parts.left && wide.right==parts.right);
    ps1_pattern::Chip wet_a,wet_b;
    for(auto *chip:{&wet_a,&wet_b}){ps1_pattern::configure(*chip);CHECK(ps1_spu_set_mix_headroom(chip->value,4));ps1_pattern::voice(*chip,0,0x1234);ps1_pattern::room(*chip);chip->write(0x198,1);ps1_pattern::key(*chip,0,true);}
    const auto wet_whole=ps1_pattern::render(wet_a,32769,2048),wet_parts=ps1_pattern::render(wet_b,32769,127);
    CHECK(wet_whole.left==wet_parts.left && wet_whole.right==wet_parts.right);

    for(unsigned i=0;i<original.left.size();i++){CHECK(original.left[i]==wide.left[i]*4);CHECK(original.right[i]==wide.right[i]*4);}
    CHECK(ps1_spu_reset(precise.value,0));ps1_pattern::configure(precise);ps1_pattern::voice(precise,0);ps1_pattern::key(precise,0,true);
    CHECK(ps1_spu_reset(legacy.value,0));ps1_pattern::configure(legacy);ps1_pattern::voice(legacy,0);ps1_pattern::key(legacy,0,true);
    const auto a=ps1_pattern::render(legacy,4097),b=ps1_pattern::render(precise,4097);
    for(unsigned i=0;i<a.left.size();i++)CHECK(a.left[i]==b.left[i]*4);
    return 0;
}
static int host_pcm_selftest()
{
    ps1_pattern::Chip host,split,ram;
    std::vector<int16_t> pcm(112);
    const auto bytes=ps1_pattern::wave();
    // Independently decode filter-zero fixture nibbles for a bit-exact
    // comparison with the existing physical-RAM playback path.
    for(unsigned n=0;n<112;n++) {
        int v=(bytes[(n/28)*16+2+(n%28)/2]>>((n%2)*4))&15;
        pcm[n]=(v<8?v:v-16)*256;
    }
    CHECK(!ps1_spu_set_host_pcm(nullptr,pcm.data(),112,1));
    CHECK(!ps1_spu_set_host_pcm(host.value,nullptr,1,1));
    CHECK(!ps1_spu_set_host_pcm(host.value,pcm.data(),79380001,1));
    CHECK(!ps1_spu_set_host_pcm(host.value,pcm.data(),112,2));
    CHECK(!ps1_spu_set_host_mask(host.value,1u<<24));
    for(auto *chip:{&host,&split,&ram}) {
        ps1_pattern::configure(*chip);ps1_pattern::voice(*chip,0,0x1234);
        if(chip!=&ram) {CHECK(ps1_spu_set_host_pcm(chip->value,pcm.data(),112,1));CHECK(ps1_spu_set_host_mask(chip->value,1));}
        ps1_pattern::key(*chip,0,true);
    }
    const auto a=ps1_pattern::render(host,8193,2048),b=ps1_pattern::render(split,8193,1),c=ps1_pattern::render(ram,8193,127);
    CHECK(same_audio(a,b));CHECK(same_audio(a,c));
    CHECK(ps1_spu_reset(host.value,0));ps1_pattern::configure(host);ps1_pattern::voice(host,0);ps1_pattern::key(host,0,true);
    CHECK(ps1_pattern::peak(ps1_pattern::render(host,4097).left)>0);
    // Beyond physical RAM capacity, the end remains audible, then stops.
    std::vector<int16_t> long_pcm(44100*24,2048);
    CHECK(ps1_spu_set_host_pcm(split.value,long_pcm.data(),long_pcm.size(),0));
    CHECK(ps1_spu_reset(split.value,0));ps1_pattern::configure(split);ps1_pattern::voice(split,0);ps1_pattern::key(split,0,true);
    ps1_pattern::render(split,44100*23);
    CHECK(ps1_pattern::peak(ps1_pattern::render(split,22050).left)>0);
    ps1_pattern::render(split,44100);
    CHECK(ps1_pattern::peak(ps1_pattern::render(split,2048).left)==0);
    CHECK(ps1_spu_set_host_pcm(split.value,nullptr,0,0));
    return 0;
}
static int long_host_event_selftest()
{
    // Exactly 2^20 source frames at PITCH=1 used to wrap the 64-bit
    // output distance (2^32) to zero: false END for one-shot, invalid
    // unsigned cursor overshoot for loop. The first few source frames must
    // be identical to a short reference, including both physical voice banks.
    for(bool loop:{false,true})for(unsigned frames:{1048576u,2097153u,16777216u}) {
        ps1_pattern::Chip long_chip,reference;
        std::vector<int16_t> pcm(frames,12000);
        for(auto *chip:{&long_chip,&reference}) {
            ps1_pattern::configure(*chip);
            ps1_pattern::voice(*chip,0,1,0x1800,0);
            ps1_pattern::voice(*chip,23,1,0,0x1800);
            CHECK(ps1_spu_set_host_pcm(chip->value,pcm.data(),chip==&long_chip?frames:112,chip==&long_chip?loop:1));
            CHECK(ps1_spu_set_host_mask(chip->value,1u|(1u<<23)));
        }
        std::array<float,257> left{},right{},expected_left{},expected_right{};
        bool ok=true,sound=false;
        allocations=frees=0;track_allocations=true;
        for(auto *chip:{&long_chip,&reference}) {
            ok=ps1_spu_write(chip->value,0x188,1)&&ok;
            ok=ps1_spu_write(chip->value,0x18a,1u<<7)&&ok;
        }
        for(unsigned block=0;block<64;++block) {
            ok=ps1_spu_render(long_chip.value,left.data(),right.data(),left.size())&&ok;
            ok=ps1_spu_render(reference.value,expected_left.data(),expected_right.data(),expected_left.size())&&ok;
            ok=left==expected_left&&right==expected_right&&ok;
            sound=sound||*std::max_element(left.begin(),left.end())>0;
            ok=!(ps1_spu_read(long_chip.value,0x19c)&1)&&!(ps1_spu_read(long_chip.value,0x19e)&(1u<<7))&&ok;
        }
        track_allocations=false;
        CHECK(ok&&sound&&allocations==0&&frees==0);
    }
    return 0;
}
static int live_host_pcm_selftest()
{
    std::array<int16_t,112> pcm{},changed{},zero{};
    for(unsigned i=0;i<pcm.size();++i){pcm[i]=static_cast<int16_t>((int(i)-56)*400);changed[i]=-pcm[i];}
    ps1_pattern::Chip edited,reference,empty;
    CHECK(!ps1_spu_update_host_pcm(nullptr,pcm.data(),112));
    CHECK(!ps1_spu_update_host_pcm(empty.value,pcm.data(),112));
    for(auto *chip:{&edited,&reference}){
        ps1_pattern::configure(*chip);ps1_pattern::voice(*chip,0,4096);
        CHECK(ps1_spu_set_host_pcm(chip->value,pcm.data(),112,1));
        CHECK(ps1_spu_set_host_mask(chip->value,1));ps1_pattern::key(*chip,0,true);
        ps1_pattern::render(*chip,1009);
    }
    CHECK(!ps1_spu_update_host_pcm(edited.value,nullptr,112));
    CHECK(!ps1_spu_update_host_pcm(edited.value,changed.data(),0));
    CHECK(!ps1_spu_update_host_pcm(edited.value,changed.data(),111));
    CHECK(!ps1_spu_update_host_pcm(edited.value,changed.data(),113));
    CHECK(same_audio(ps1_pattern::render(edited,257,1),ps1_pattern::render(reference,257,127)));
    std::array<uint32_t,512> registers{};
    for(unsigned i=0;i<registers.size();++i)registers[i]=ps1_spu_read(edited.value,i*2);
    std::array<uint8_t,64> before{},after{};
    CHECK(ps1_spu_read_ram(edited.value,ps1_pattern::address,before.data(),before.size()));
    allocations=frees=0;track_allocations=true;
    const bool updated=ps1_spu_update_host_pcm(edited.value,zero.data(),112)!=0;
    track_allocations=false;CHECK(updated&&allocations==0&&frees==0);
    for(unsigned i=0;i<registers.size();++i)CHECK(ps1_spu_read(edited.value,i*2)==registers[i]);
    CHECK(ps1_spu_read_ram(edited.value,ps1_pattern::address,after.data(),after.size()));CHECK(before==after);
    // This cursor is inside the separate loop cache, not the main PCM array.
    // Preserve three Gaussian history samples, then immediately hear the edit.
    const auto muted=ps1_pattern::render(edited,257,1);
    CHECK(tail_peak(muted.left,4)==0);
    CHECK(ps1_pattern::peak(ps1_pattern::render(reference,257).left)>.01);
    // Silent even voices still publish post-envelope OUTX into odd PMON.
    for(auto *chip:{&edited,&reference}){
        CHECK(ps1_spu_reset(chip->value,0));ps1_pattern::configure(*chip);
        CHECK(ps1_spu_update_host_pcm(chip->value,pcm.data(),112));
        CHECK(ps1_spu_set_host_mask(chip->value,0x555555));
        chip->write(0x190,0xaaaa);chip->write(0x192,0xaa);
        for(unsigned v=0;v<24;++v){
            ps1_pattern::voice(*chip,v,0x3fff,v%2?0x0400:0,v%2?0x0400:0);
            ps1_pattern::key(*chip,v,true);
        }
        ps1_pattern::render(*chip,1024);
    }
    std::array<float,257> a{},ar{},b{},br{};
    allocations=frees=0;track_allocations=true;
    bool ok=true,equal=true,nonzero=false;
    for(unsigned stage=0;stage<257;++stage){
        const auto& next=stage%3==0?zero:stage%3==1?pcm:changed;
        for(auto *chip:{&edited,&reference}){
            ok=(ps1_spu_update_host_pcm(chip->value,next.data(),112)!=0)&&ok;
            for(unsigned v=0;v<24;++v)chip->write(v*16+4,stage%2?1:0x3fff);
        }
        ok=(ps1_spu_render(edited.value,a.data(),ar.data(),a.size())!=0)&&ok;
        for(unsigned at=0;at<a.size();){
            const unsigned n=std::min<unsigned>(7,a.size()-at);
            ok=(ps1_spu_render(reference.value,b.data()+at,br.data()+at,n)!=0)&&ok;at+=n;
        }
        equal=equal&&a==b&&ar==br;
        for(float value:a)nonzero=nonzero||value!=0;
    }
    track_allocations=false;CHECK(ok&&equal&&nonzero&&allocations==0&&frees==0);
    return 0;
}
static int two_host_banks_selftest()
{
    std::array<int16_t,112> first{},second{},zero{};
    for(unsigned i=0;i<112;++i){first[i]=static_cast<int16_t>((int(i)-56)*400);second[i]=-first[i];}
    ps1_pattern::Chip edited,reference;
    for(auto *chip:{&edited,&reference}){
        ps1_pattern::configure(*chip);
        CHECK(ps1_spu_set_host_pcm(chip->value,first.data(),112,1));
        CHECK(ps1_spu_set_host_pcm_bank(chip->value,1,second.data(),112,1));
        CHECK(ps1_spu_set_host_masks(chip->value,1,1u<<23));
        ps1_pattern::voice(*chip,0,0x3fff,0x1800,0);ps1_pattern::voice(*chip,23,0x1234,0,0x1800);
        ps1_pattern::key(*chip,0,true);ps1_pattern::key(*chip,23,true);ps1_pattern::render(*chip,1009);
    }
    CHECK(!ps1_spu_set_host_pcm_bank(edited.value,2,first.data(),112,1));
    CHECK(!ps1_spu_update_host_pcm_bank(edited.value,2,first.data(),112));
    CHECK(!ps1_spu_set_host_masks(nullptr,1,0));
    CHECK(!ps1_spu_set_host_masks(edited.value,1,1));
    CHECK(!ps1_spu_set_host_masks(edited.value,0,1u<<24));
    CHECK(same_audio(ps1_pattern::render(edited,257,1),ps1_pattern::render(reference,257,127)));
    CHECK(ps1_spu_update_host_pcm_bank(edited.value,1,zero.data(),112));
    const auto a=ps1_pattern::render(edited,257),b=ps1_pattern::render(reference,257);
    CHECK(a.left==b.left&&tail_peak(a.right,4)==0&&ps1_pattern::peak(b.right)>.01);
    CHECK(ps1_pattern::peak(std::vector<float>(a.right.begin(),a.right.begin()+4))>0); //Gaussian history retained.
    CHECK(ps1_spu_set_host_masks(edited.value,0,0)); //Existing bank0 cursor remains latched.
    CHECK(ps1_spu_update_host_pcm(edited.value,zero.data(),112));
    CHECK(tail_peak(ps1_pattern::render(edited,257).left,4)==0);
    ps1_pattern::key(edited,0,true);CHECK(ps1_pattern::peak(ps1_pattern::render(edited,257).left)>.01); //New key uses RAM.
    for(auto *chip:{&edited,&reference}){
        CHECK(ps1_spu_reset(chip->value,0));ps1_pattern::configure(*chip);
        CHECK(ps1_spu_update_host_pcm_bank(chip->value,0,first.data(),112));
        CHECK(ps1_spu_update_host_pcm_bank(chip->value,1,second.data(),112));
        CHECK(ps1_spu_set_host_masks(chip->value,0x555555,0xaaaaaa));
        chip->write(0x190,0xaaaa);chip->write(0x192,0xaa);
        for(unsigned v=0;v<24;++v){ps1_pattern::voice(*chip,v,0x3fff,v%2?0x0400:0,v%2?0x0400:0);ps1_pattern::key(*chip,v,true);}
        ps1_pattern::render(*chip,1024);
    }
    std::array<float,257> left{},right{},other{},otherRight{};
    allocations=frees=0;track_allocations=true;bool ok=true,equal=true;
    for(unsigned stage=0;stage<257;++stage){
        for(auto *chip:{&edited,&reference}){
            ok=(ps1_spu_update_host_pcm_bank(chip->value,0,stage%2?first.data():zero.data(),112)!=0)&&ok;
            ok=(ps1_spu_update_host_pcm_bank(chip->value,1,stage%3?second.data():first.data(),112)!=0)&&ok;
            for(unsigned v=0;v<24;++v)chip->write(v*16+4,stage%2?1:0x3fff);
        }
        ok=(ps1_spu_render(edited.value,left.data(),right.data(),257)!=0)&&ok;
        for(unsigned at=0;at<257;){const unsigned n=std::min(7u,257-at);ok=(ps1_spu_render(reference.value,other.data()+at,otherRight.data()+at,n)!=0)&&ok;at+=n;}
        equal=equal&&left==other&&right==otherRight;
    }
    track_allocations=false;CHECK(ok&&equal&&allocations==0&&frees==0);
    return 0;
}
static int selftest()
{
    CHECK(ps1_spu_sample_rate()==44100);
    CHECK(!ps1_spu_reset(nullptr,0));CHECK(!ps1_spu_write(nullptr,0,0));
    CHECK(ps1_spu_read(nullptr,0)==0xffffffffu);
    CHECK(!ps1_spu_load_ram(nullptr,0,nullptr,0));CHECK(!ps1_spu_read_ram(nullptr,0,nullptr,0));
    CHECK(!ps1_spu_render(nullptr,nullptr,nullptr,0));ps1_spu_destroy(nullptr);
    CHECK(!ps1_spu_refresh_envelope(nullptr,0));CHECK(!ps1_spu_audition_key(nullptr,0,1));
    void *chip=ps1_spu_create();CHECK(chip);
    CHECK(!ps1_spu_refresh_envelope(chip,24));CHECK(!ps1_spu_refresh_envelope(chip,0xffffffffu));
    CHECK(!ps1_spu_audition_key(chip,24,1));CHECK(!ps1_spu_audition_key(chip,0,2));CHECK(!ps1_spu_audition_key(chip,0,-1));
    CHECK(ps1_spu_refresh_envelope(chip,0));CHECK(ps1_spu_refresh_envelope(chip,23));
    CHECK(!ps1_spu_reset(chip,2));CHECK(!ps1_spu_write(chip,1,0));CHECK(!ps1_spu_write(chip,0x400,0));
    CHECK(ps1_spu_read(chip,1)==0xffffffffu);CHECK(ps1_spu_read(chip,0x400)==0xffffffffu);
    CHECK(!ps1_spu_write(chip,0,0x8000));CHECK(!ps1_spu_write(chip,0x180,0x8000));
    CHECK(!ps1_spu_write(chip,0x1ac,0));
    CHECK(!ps1_spu_write(chip,6,0x401));CHECK(!ps1_spu_write(chip,14,0x401));
    uint8_t bytes[16]={};
    CHECK(!ps1_spu_load_ram(chip,0,nullptr,1));CHECK(!ps1_spu_read_ram(chip,0,nullptr,1));
    CHECK(!ps1_spu_load_ram(chip,0x7ffff,bytes,2));CHECK(!ps1_spu_read_ram(chip,0x7ffff,bytes,2));
    CHECK(ps1_spu_load_ram(chip,0x80000,nullptr,0));CHECK(ps1_spu_read_ram(chip,0x80000,nullptr,0));
    CHECK(!ps1_spu_load_ram(chip,0x80001,bytes,0));CHECK(!ps1_spu_read_ram(chip,0x80001,bytes,0));
    float pcm[17];for(auto &value:pcm)value=123.0f;
    CHECK(ps1_spu_render(chip,nullptr,nullptr,0));CHECK(!ps1_spu_render(chip,nullptr,pcm,1));
    CHECK(!ps1_spu_render(chip,pcm,pcm,8));CHECK(!ps1_spu_render(chip,pcm,pcm+7,8));
    CHECK(!ps1_spu_render(chip,pcm,pcm+8,(1u<<20)+1));
    for(const auto value:pcm)CHECK(value==123.0f);
    CHECK(ps1_spu_render(chip,pcm,pcm+8,8));for(unsigned i=0;i<16;i++)CHECK(pcm[i]==0.0f);
    ps1_spu_destroy(chip);
    CHECK(ps1_pattern::selftest());
    CHECK(repeat_flags_selftest()==0);
    CHECK(full_ram_repeat_selftest()==0);
    CHECK(gaussian_selftest()==0);
    CHECK(headroom_selftest()==0);
    CHECK(host_pcm_selftest()==0);
    CHECK(long_host_event_selftest()==0);
    CHECK(live_host_pcm_selftest()==0);
    CHECK(two_host_banks_selftest()==0);
    CHECK(live_editor_selftest()==0);
    CHECK(deferred_release_selftest()==0);
    CHECK(clear_reverb_selftest()==0);
    std::puts("{\"status\":\"pass\",\"scope\":\"register/RAM guards, independent ADPCM flags, full-RAM allocation-free loops, 24 voices, ADSR, reverb, isolation, partition invariance, two software banks, long PCM, live editor controls, deferred release latching and allocation-free reverb history clear\"}");
    return 0;
}
int main(int argc,char **argv)
{
    if(argc==2&&(!std::strcmp(argv[1],"--selftest")||!std::strcmp(argv[1],"--self-test")))return selftest();
    void *chip=ps1_spu_create();if(!chip)return 3;
    uint32_t commands=read_u32();
    while(commands--) {
        switch(read_u32()) {
        case 0: {const auto clear=read_u32();if(!ps1_spu_reset(chip,int(clear)))return 4;break;}
        case 1: {const auto offset=read_u32(),value=read_u32();if(value>65535||!ps1_spu_write(chip,offset,uint16_t(value)))return 4;break;}
        case 2: {const auto value=ps1_spu_read(chip,read_u32());if(value==0xffffffffu)return 4;write_u32(value);break;}
        case 3: {
            const auto address=read_u32(),size=read_u32();if(size>512*1024)return 4;
            std::vector<uint8_t> bytes(size);if(std::fread(bytes.data(),1,size,stdin)!=size)return 2;
            if(!ps1_spu_load_ram(chip,address,bytes.data(),size))return 4;break;
        }
        case 4: {
            const auto address=read_u32(),size=read_u32();if(size>512*1024)return 4;
            std::vector<uint8_t> bytes(size);if(!ps1_spu_read_ram(chip,address,bytes.data(),size))return 4;
            if(std::fwrite(bytes.data(),1,size,stdout)!=size)return 5;break;
        }
        case 5: {
            const auto frames=read_u32();if(frames>(1u<<20))return 4;
            std::vector<float> left(frames),right(frames);
            if(!ps1_spu_render(chip,left.data(),right.data(),frames))return 4;
            for(uint32_t frame=0;frame<frames;frame++){write_float(left[frame]);write_float(right[frame]);}
            break;
        }
        case 6: {if(!ps1_spu_clear_reverb(chip))return 4;break;}
        default:return 2;
        }
    }
    ps1_spu_destroy(chip);return std::ferror(stdout)?5:0;
}
