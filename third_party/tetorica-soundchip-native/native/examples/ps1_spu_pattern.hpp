// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro
// Original filter-zero waveform and test host. No game asset or PCM encoder.
// Room register constants retain the BSD-licensed pSXAuthor/R. Belmont table
// in vendor/mame-ps1-spu/spu_tables.cpp; this is not another reverb algorithm.
#pragma once
#include <tetorica/ps1_spu.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <stdexcept>
#include <vector>
namespace ps1_pattern {
constexpr unsigned rate=44100, address=0x2000;
inline void require(bool ok) { if(!ok) throw std::runtime_error("PS1 instrument API or fixture assertion failed"); }
struct Chip {
    void* value=ps1_spu_create();
    Chip(){require(value!=nullptr);}
    ~Chip(){ps1_spu_destroy(value);}
    Chip(const Chip&)=delete; Chip& operator=(const Chip&)=delete;
    void write(unsigned offset,unsigned value_){require(ps1_spu_write(value,offset,uint16_t(value_))!=0);}
};
inline std::array<uint8_t,64> wave() {
    std::array<uint8_t,64> bytes{};
    for(unsigned block=0;block<4;++block){
        bytes[block*16]=4; bytes[block*16+1]=block==0?6:block==3?3:0;
        for(unsigned pair=0;pair<14;++pair){
            auto nibble=[](unsigned n){return unsigned(int(std::lround(7*std::sin(6.283185307179586*n/112)))&15);};
            unsigned n=block*28+pair*2;
            bytes[block*16+pair+2]=uint8_t(nibble(n)|(nibble(n+1)<<4));
        }
    }
    return bytes;
}
inline void configure(Chip& chip) {
    const auto bytes=wave();require(ps1_spu_load_ram(chip.value,address,bytes.data(),unsigned(bytes.size()))!=0);
    chip.write(0x180,0x3fff);chip.write(0x182,0x3fff);chip.write(0x1aa,0xc000);
}
inline void voice(Chip& chip,unsigned channel,unsigned pitch=0x1000,unsigned left=0x1800,unsigned right=0x1000) {
    require(channel<24);const unsigned base=channel*16;
    chip.write(base,left);chip.write(base+2,right);chip.write(base+4,pitch);
    chip.write(base+6,address/8);chip.write(base+8,0xf);chip.write(base+10,0x1fc0);chip.write(base+14,address/8);
}
inline void key(Chip& chip,unsigned channel,bool on) {chip.write((on?0x188:0x18c)+(channel>=16?2:0),1u<<(channel%16));}
inline void room(Chip& chip) {
    constexpr uint16_t words[]={
        0x007d,0x005b,0x6d80,0x54b8,0xbed0,0x0000,0x0000,0xba80,
        0x5800,0x5300,0x04d6,0x0333,0x03f0,0x0227,0x0374,0x01ef,
        0x0334,0x01b5,0,0,0,0,0,0,0,0,0x01b4,0x0136,0x00b8,0x005c,0x8000,0x8000};
    for(unsigned i=0;i<32;++i)chip.write(0x1c0+i*2,words[i]);
    chip.write(0x184,0x3000);chip.write(0x186,0x3000);
}
struct Audio{std::vector<float> left,right; explicit Audio(unsigned n):left(n),right(n){};};
inline Audio render(Chip& chip,unsigned frames,unsigned quantum=2048){
    Audio out(frames);
    for(unsigned at=0;at<frames;){unsigned n=std::min(quantum,frames-at);
        require(ps1_spu_render(chip.value,out.left.data()+at,out.right.data()+at,n)!=0);at+=n;}
    for(unsigned i=0;i<frames;++i)require(std::isfinite(out.left[i])&&std::isfinite(out.right[i])&&std::abs(out.left[i])<=1&&std::abs(out.right[i])<=1);
    return out;
}
inline double peak(const std::vector<float>& values){double result=0;for(float v:values)result=std::max(result,double(std::abs(v)));return result;}
inline bool selftest(){
    // Every bank/channel uses a real ADPCM voice, including CH24.
    for(unsigned c=0;c<24;++c){Chip chip;configure(chip);voice(chip,c);key(chip,c,true);
        auto pcm=render(chip,4097,127);require(peak(pcm.left)>.01&&peak(pcm.right)>.01&&pcm.left!=pcm.right);}
    Chip a,b,reference;for(auto* chip:{&a,&b,&reference}){configure(*chip);voice(*chip,23,0x1234);key(*chip,23,true);}
    auto whole=render(a,8193,8193),parts=render(b,8193,127),ref=render(reference,8193,2048);
    require(whole.left==parts.left&&whole.right==parts.right&&whole.left==ref.left);
    require(ps1_spu_reset(a.value,1)!=0);require(peak(render(a,257).left)==0);
    require(render(b,1025).left==render(reference,1025).left); // A reset/RAM does not touch B.
    key(b,23,false);render(b,4096);require(peak(render(b,257).left)==0);
    Chip wet;configure(wet);voice(wet,0);room(wet);wet.write(0x198,1);key(wet,0,true);
    render(wet,8192);key(wet,0,false);render(wet,2048);require(peak(render(wet,8192).left)>.00001);
    require(ps1_spu_reset(wet.value,0)!=0);require(peak(render(wet,4097).left)==0);
    std::array<uint8_t,64> retained{};require(ps1_spu_read_ram(wet.value,address,retained.data(),64)!=0);require(retained==wave());
    require(ps1_spu_reset(wet.value,1)!=0);require(ps1_spu_read_ram(wet.value,address,retained.data(),64)!=0);
    require(std::all_of(retained.begin(),retained.end(),[](uint8_t v){return v==0;}));return true;
}
}
