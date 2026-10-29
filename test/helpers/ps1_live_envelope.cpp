// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro
// Real-core editor ADSR tests: levels and sample phase must survive a refresh.
#include "ps1_spu.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <vector>

#define CHECK(x) do { if (!(x)) { std::fprintf(stderr,"line %d: %s\n",__LINE__,#x); std::exit(1); } } while (0)
struct Chip {
    void *p=ps1_spu_create();
    Chip() { CHECK(p); }
    ~Chip() { ps1_spu_destroy(p); }
    Chip(const Chip &)=delete;
    void write(unsigned at,uint16_t value) { CHECK(ps1_spu_write(p,at,value)); }
    void refresh(unsigned ch=0) { CHECK(ps1_spu_refresh_envelope(p,ch)); }
    uint32_t level(unsigned ch=0) { return ps1_spu_read(p,ch*16+12); }
};
struct Audio { std::vector<float> l,r; };
static Audio render(Chip &chip,unsigned count,const std::vector<unsigned> &parts={2048})
{
    Audio out;out.l.resize(count);out.r.resize(count);
    for(unsigned i=0,part=0;i<count;part++) {
        const unsigned n=std::min(count-i,parts[part%parts.size()]);CHECK(n);
        CHECK(ps1_spu_render(chip.p,out.l.data()+i,out.r.data()+i,n));i+=n;
    }
    for(const auto *v:{&out.l,&out.r})for(float sample:*v)CHECK(std::isfinite(sample)&&std::abs(sample)<=1);
    return out;
}
static void setup(Chip &chip,uint16_t adsr1,uint16_t adsr2,bool constant=false)
{
    std::array<uint8_t,64> bytes{};
    for(unsigned block=0;block<4;block++) {
        bytes[block*16+1]=block==3?3:block==0?6:0;
        for(unsigned pair=0;pair<14;pair++) {
            const unsigned index=block*28+pair*2;
            const auto nibble=[&](unsigned i) { return unsigned(constant?5:int(std::lround(5*std::sin(6.283185307179586*i/112))))&15; };
            bytes[block*16+pair+2]=uint8_t(nibble(index)|(nibble(index+1)<<4));
        }
    }
    CHECK(ps1_spu_load_ram(chip.p,0x2000,bytes.data(),unsigned(bytes.size())));
    chip.write(0x180,0x3fff);chip.write(0x182,0x3fff);chip.write(0x1aa,0xc000);
    for(unsigned ch:{0,23}) {
        chip.write(ch*16,ch?0:0x2000);chip.write(ch*16+2,ch?0x2000:0);
        chip.write(ch*16+4,ch?0x0813:0x1234);chip.write(ch*16+6,0x400);
        chip.write(ch*16+8,adsr1);chip.write(ch*16+10,adsr2);chip.write(ch*16+14,0x400);
    }
    chip.write(0x188,1);chip.write(0x18a,0x80);
}
static void first_sample_matches(const Audio &a,const Audio &b)
{
    CHECK(a.l.front()==b.l.front());CHECK(a.r==b.r);
}
static void attack()
{
    Chip edited,reference;
    for(auto *chip:{&edited,&reference}) { setup(*chip,0x400f,0x1fcf);render(*chip,101);chip->write(8,0x100f); }
    const auto old=edited.level();CHECK(old>0&&old<32767);edited.refresh();CHECK(edited.level()==old);
    const auto a=render(edited,129),b=render(reference,129);first_sample_matches(a,b);
    CHECK(a.l!=b.l);CHECK(edited.level()>reference.level());
}
static void decay()
{
    Chip edited,reference;
    for(auto *chip:{&edited,&reference}) { setup(*chip,0x00c0,0x1fcf,true);render(*chip,300);chip->write(8,0x00cf); }
    const auto old=edited.level();CHECK(old>0&&old<32767);edited.refresh();CHECK(edited.level()==old);
    const auto a=render(edited,257),b=render(reference,257);first_sample_matches(a,b);
    // Gaussian coefficient sums vary by phase, even for a constant source.
    // Raising SL must hold the envelope itself without snapping its level.
    CHECK(edited.level()==old);
    CHECK(reference.level()<edited.level());
}
static void sustain()
{
    // Both an explicit hold (SR127) and the default rising SR0 endpoint must
    // resume a newly descending sustain from the current level and phase.
    for(uint16_t adsr2:{uint16_t(0x000f),uint16_t(0x1fcf)}) {
        Chip edited,reference;
        for(auto *chip:{&edited,&reference}) { setup(*chip,0x000f,adsr2);render(*chip,1009);chip->write(10,0x4f0f); }
        CHECK(edited.level()==32767);edited.refresh();const auto a=render(edited,129),b=render(reference,129);
        first_sample_matches(a,b);CHECK(a.l!=b.l);CHECK(edited.level()<reference.level());
    }
    Chip edited,reference;
    for(auto *chip:{&edited,&reference}) { setup(*chip,0x000f,0x000f);render(*chip,1009);chip->write(8,0x7f0f); }
    edited.refresh();const auto a=render(edited,513),b=render(reference,513);
    CHECK(a.l==b.l);CHECK(a.r==b.r); // AR changes never restart a held note.
}
static void release()
{
    Chip edited,reference;
    for(auto *chip:{&edited,&reference}) {
        setup(*chip,0x000f,0x1fce);render(*chip,1009);
        CHECK(ps1_spu_audition_key(chip->p,0,0));render(*chip,53);chip->write(10,0x1fc0);
    }
    const auto old=edited.level();edited.refresh();CHECK(edited.level()==old);
    const auto a=render(edited,257),b=render(reference,257);first_sample_matches(a,b);
    CHECK(a.l!=b.l);CHECK(edited.level()==0);CHECK(reference.level()>0);
    // A live change to the fastest RR still keeps the manual-release floor.
    CHECK(std::any_of(a.l.begin()+20,a.l.begin()+70,[](float v){return v!=0;}));
}
static void inactive_and_guards()
{
    Chip chip;CHECK(!ps1_spu_refresh_envelope(nullptr,0));
    CHECK(!ps1_spu_refresh_envelope(chip.p,24));CHECK(!ps1_spu_refresh_envelope(chip.p,0xffffffffu));
    chip.write(8,0xffff);chip.write(10,0xffff);chip.refresh();chip.refresh(23);
    const auto silent=render(chip,1024);for(float v:silent.l)CHECK(v==0);for(float v:silent.r)CHECK(v==0);
}
static Audio sweep(const std::vector<unsigned> &parts)
{
    Chip chip;setup(chip,0x400f,0x1fcf);Audio out;
    for(unsigned i=0;i<64;i++) {
        const uint16_t a=uint16_t((i*65521u)^0x1327u),b=uint16_t((i*27847u)^0xa875u);
        chip.write(8,a);chip.write(10,b);chip.refresh();
        if(i==47)CHECK(ps1_spu_audition_key(chip.p,0,0));
        const auto pcm=render(chip,173,parts);out.l.insert(out.l.end(),pcm.l.begin(),pcm.l.end());out.r.insert(out.r.end(),pcm.r.begin(),pcm.r.end());
    }
    return out;
}
int main()
{
    inactive_and_guards();attack();decay();sustain();release();
    const auto a=sweep({2048}),b=sweep({1,7,53,128});CHECK(a.l==b.l);CHECK(a.r==b.r);
    std::puts("{\"attack\":true,\"decay\":true,\"sustain\":true,\"release\":true,\"phaseAndLevelPreserved\":true,\"raisedSustainLevelDoesNotJump\":true,\"otherVoiceBitExact\":true,\"partitionInvariant\":true,\"sweepFrames\":11072}");
}
