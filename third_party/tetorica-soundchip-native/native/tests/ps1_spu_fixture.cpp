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
#include <vector>

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
    CHECK(gaussian_selftest()==0);
    CHECK(headroom_selftest()==0);
    CHECK(host_pcm_selftest()==0);
    CHECK(live_editor_selftest()==0);
    CHECK(deferred_release_selftest()==0);
    std::puts("{\"status\":\"pass\",\"scope\":\"register/RAM guards, 24 voices, ADSR, reverb, isolation, partition invariance, live editor controls and deferred release latching\"}");
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
        default:return 2;
        }
    }
    ps1_spu_destroy(chip);return std::ferror(stdout)?5:0;
}
