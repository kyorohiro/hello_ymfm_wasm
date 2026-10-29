// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro
// Actual-core manual-audition regression fixture. The constant packet is an
// authored DC signal: it isolates event discontinuities from oscillator slope.
#include "ps1_spu.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <utility>
#include <vector>

#define CHECK(x) do { if (!(x)) { std::fprintf(stderr,"line %d: %s\n",__LINE__,#x); std::exit(1); } } while (0)
struct Chip {
    void *p = ps1_spu_create();
    Chip() { CHECK(p); }
    ~Chip() { ps1_spu_destroy(p); }
    Chip(const Chip &) = delete;
    void write(uint32_t at, uint16_t value) { CHECK(ps1_spu_write(p,at,value)); }
    uint32_t read(uint32_t at) { return ps1_spu_read(p,at); }
    void reset() { CHECK(ps1_spu_reset(p,0)); }
};
struct Audio { std::vector<float> l,r; };
static void setup(Chip &chip, unsigned ch=0, uint16_t release=0, bool right=false, bool sine=false)
{
    std::array<uint8_t,64> bytes{};
    for (unsigned block=0;block<4;block++) {
        bytes[block*16+1]=block==3?3:block==0?6:0;
        for (unsigned pair=0;pair<14;pair++) {
            const unsigned index=block*28+pair*2;
            const auto nibble=[&](unsigned sample) {
                return unsigned(sine?int(std::lround(5*std::sin(6.283185307179586*sample/112))):5)&15u;
            };
            bytes[block*16+2+pair]=uint8_t(nibble(index)|(nibble(index+1)<<4));
        }
    }
    CHECK(ps1_spu_load_ram(chip.p,0x2000,bytes.data(),unsigned(bytes.size())));
    chip.write(0x180,0x3fff); chip.write(0x182,0x3fff); chip.write(0x1aa,0xc000);
    chip.write(ch*16,right?0:0x2000); chip.write(ch*16+2,right?0x2000:0);
    chip.write(ch*16+4,0x1000); chip.write(ch*16+6,0x400);
    chip.write(ch*16+8,0x000f); chip.write(ch*16+10,release); chip.write(ch*16+14,0x400);
}
static void key(Chip &chip,unsigned ch,bool on)
{
    chip.write((on?0x188:0x18c)+(ch>=16?2:0),uint16_t(1u<<(ch%16)));
}
static Audio render(Chip &chip,unsigned frames,const std::vector<unsigned> &parts={2048})
{
    Audio pcm;pcm.l.resize(frames);pcm.r.resize(frames);
    for(unsigned offset=0,index=0;offset<frames;index++) {
        const unsigned count=std::min(parts[index%parts.size()],frames-offset);
        CHECK(count); CHECK(ps1_spu_render(chip.p,pcm.l.data()+offset,pcm.r.data()+offset,count)); offset+=count;
    }
    for(const auto *v:{&pcm.l,&pcm.r})for(float value:*v)CHECK(std::isfinite(value)&&std::abs(value)<=1);
    return pcm;
}
static float maximum_step(const std::vector<float> &pcm,float previous)
{
    float result=0;for(float value:pcm){result=std::max(result,std::abs(value-previous));previous=value;}return result;
}
static void append(Audio &out,const Audio &part)
{
    out.l.insert(out.l.end(),part.l.begin(),part.l.end());out.r.insert(out.r.end(),part.r.begin(),part.r.end());
}
static void raw_fixture()
{
    Chip chip;Audio out;
    for(bool sine:{false,true})for(unsigned release:{0,6,14,31}) {
        chip.reset();setup(chip,0,uint16_t(release),false,sine);setup(chip,23,uint16_t(release),true,sine);
        key(chip,0,true);key(chip,23,true);append(out,render(chip,1009,{1,127,2047,53}));
        chip.write(4,0x1234);chip.write(23*16+4,0x0813);append(out,render(chip,2131,{128,7,1024}));
        key(chip,0,true);append(out,render(chip,531,{1,91}));
        key(chip,0,false);append(out,render(chip,4211,{19,128,2047}));
        key(chip,23,false);append(out,render(chip,1103,{53,1024}));
    }
    // A raw-only build can compile against the previous fixed SDK, providing
    // an independent byte comparison for the unchanged public register path.
    for(size_t i=0;i<out.l.size();i++)for(float value:{out.l[i],out.r[i]}) {
        uint32_t bits;std::memcpy(&bits,&value,4);
        for(unsigned shift=0;shift<32;shift+=8)CHECK(std::putchar((bits>>shift)&255)!=EOF);
    }
}

#ifndef PS1_AUDITION_RAW_ONLY
static void audition(Chip &chip,unsigned ch,bool on) { CHECK(ps1_spu_audition_key(chip.p,ch,int(on))); }
static std::pair<float,float> fast_release()
{
    Chip raw,manual;for(auto *chip:{&raw,&manual}){setup(*chip);key(*chip,0,true);render(*chip,1024);}
    const float previous=render(raw,1).l[0];render(manual,1);
    key(raw,0,false);audition(manual,0,false);
    const Audio a=render(raw,512),b=render(manual,512,{1,7,19,128});
    const float raw_step=maximum_step(a.l,previous),manual_step=maximum_step(b.l,previous);
    CHECK(previous>0.1f);CHECK(raw_step>manual_step*16);
    CHECK(manual_step<previous/100);CHECK(b.l[100]>0);CHECK(b.l[200]==0);
    CHECK(manual.read(10)==0); // The displayed/authored RR register is retained.
    return {raw_step,manual_step};
}
static std::pair<float,float> retrigger()
{
    Chip raw,manual;for(auto *chip:{&raw,&manual}){setup(*chip);key(*chip,0,true);render(*chip,1024);}
    const float previous=render(raw,1).l[0];render(manual,1);
    key(raw,0,true);audition(manual,0,true);
    const Audio a=render(raw,512),b=render(manual,512,{1,127,17});
    const float raw_step=maximum_step(a.l,previous),manual_step=maximum_step(b.l,previous);
    // The fastest attack is multiplied by the fade-in ramp; its first two
    // samples may rise by up to two gain steps rather than a single step.
    CHECK(raw_step>manual_step*16);CHECK(manual_step<previous*2/128+2.0f/32768);
    CHECK(std::abs(b.l.back()-previous)<0.0001f);
    return {raw_step,manual_step};
}
static void preserve_release()
{
    for(unsigned release:{14,31}) {
        Chip raw,manual;for(auto *chip:{&raw,&manual}){setup(*chip,0,uint16_t(release));key(*chip,0,true);render(*chip,1024);}
        key(raw,0,false);audition(manual,0,false);
        const Audio a=render(raw,4096),b=render(manual,4096,{1,127,53});
        CHECK(a.l==b.l);CHECK(a.r==b.r);CHECK(b.l.back()>0.1f);CHECK(manual.read(10)==release);
        if(release==31)CHECK(b.l.front()==b.l.back());
    }
}
static Audio rapid(const std::vector<unsigned> &parts)
{
    Chip chip;setup(chip);setup(chip,23,0,true);key(chip,23,true);Audio out;
    audition(chip,0,true);append(out,render(chip,51,parts));
    audition(chip,0,true);append(out,render(chip,19,parts));
    audition(chip,0,false);append(out,render(chip,7,parts));
    audition(chip,0,true);append(out,render(chip,401,parts));
    audition(chip,0,false);append(out,render(chip,11,parts));
    audition(chip,0,true);append(out,render(chip,23,parts));
    audition(chip,0,true);append(out,render(chip,9,parts));
    audition(chip,0,false);append(out,render(chip,1024,parts));
    CHECK(std::all_of(out.l.end()-256,out.l.end(),[](float v){return v==0;}));
    Chip other;setup(other,23,0,true);key(other,23,true);
    CHECK(out.r==render(other,unsigned(out.r.size()),parts).r);
    // A transport reset must cancel a deferred key-on as well as the current gate.
    audition(chip,0,true);render(chip,11,parts);audition(chip,0,true);render(chip,13,parts);
    chip.reset();const Audio stopped=render(chip,4096,parts);
    for(const auto *v:{&stopped.l,&stopped.r})for(float sample:*v)CHECK(sample==0);
    return out;
}
static void selftest()
{
    Chip chip;setup(chip);CHECK(!ps1_spu_audition_key(nullptr,0,1));
    CHECK(!ps1_spu_audition_key(chip.p,24,1));CHECK(!ps1_spu_audition_key(chip.p,0,2));CHECK(!ps1_spu_audition_key(chip.p,0,-1));
    const auto off=fast_release(),on=retrigger();preserve_release();
    const Audio contiguous=rapid({2048}),partitioned=rapid({1,7,19,127,53});CHECK(contiguous.l==partitioned.l);CHECK(contiguous.r==partitioned.r);
    std::printf("{\"rawReleaseMaximumStep\":%.9g,\"auditionReleaseMaximumStep\":%.9g,\"rawRetriggerMaximumStep\":%.9g,\"auditionRetriggerMaximumStep\":%.9g,\"rapidFrames\":%zu,\"longAndInfiniteReleasePreserved\":true,\"otherVoiceBitExact\":true,\"partitionInvariant\":true,\"resetCancelsPendingOn\":true}\n",off.first,off.second,on.first,on.second,contiguous.l.size());
}
#endif
int main(int argc,char **argv)
{
    if(argc==2&&!std::strcmp(argv[1],"--raw")){raw_fixture();return 0;}
#ifndef PS1_AUDITION_RAW_ONLY
    selftest();return 0;
#else
    return 2;
#endif
}
