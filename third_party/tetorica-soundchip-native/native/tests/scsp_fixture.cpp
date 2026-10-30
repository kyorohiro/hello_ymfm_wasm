// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro
#include <tetorica/scsp.h>
#include "../examples/scsp_pattern.hpp"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <limits>
#define CHECK(x) do {if(!(x)){std::fprintf(stderr,"SCSP check failed at %d: %s\n",__LINE__,#x);return 1;}} while(0)
static int self_test() {
    using namespace scsp_pattern;
    CHECK(scsp_sample_rate()==44100);
    CHECK(!scsp_write(nullptr,0,0,0xffff));CHECK(scsp_read(nullptr,0)==0xffffffff);
    CHECK(!scsp_render(nullptr,nullptr,nullptr,0));CHECK(!scsp_reset(nullptr,0));scsp_destroy(nullptr);
    Chip a,b;configure(a);configure(b);
    CHECK(scsp_render(a.value,nullptr,nullptr,0));
    float l[8]{},r[8]{};
    CHECK(!scsp_render(a.value,l,l,8));CHECK(!scsp_render(a.value,nullptr,r,8));
    CHECK(!scsp_render(a.value,l,r,1048577));
    CHECK(!scsp_reset(a.value,2));
    for(unsigned at:{1u,0x1000u,0xffffu,0x418u,0x406u,0x7c0u})CHECK(!scsp_write(a.value,at,0,0xffff));
    CHECK(!scsp_write(a.value,0x400,0xf,0xffff));CHECK(scsp_read(a.value,0x400)==0x20f);
    CHECK(!scsp_write(a.value,0,0x1980,0xffff));CHECK(scsp_read(a.value,0)==0x820);
    CHECK(scsp_write(a.value,0x16,0xe01f,0xff));CHECK(scsp_read(a.value,0x16)==0xe01f);
    CHECK(scsp_write(a.value,0x16,0,0xff));
    uint8_t bytes[2]{0x40,0};
    CHECK(!scsp_load_ram(a.value,524287,bytes,2));CHECK(!scsp_read_ram(a.value,0xffffffff,bytes,2));
    CHECK(!scsp_load_ram(a.value,0,nullptr,1));CHECK(scsp_load_ram(a.value,524288,nullptr,0));
    const auto x=render(a,4096,4096),y=render(b,4096,7);
    CHECK(x.left==y.left&&x.right==y.right);
    CHECK(scsp_read(a.value,0x408)==scsp_read(b.value,0x408));
    for(unsigned i=0;i<x.left.size();++i){CHECK(std::isfinite(x.left[i]));CHECK(x.left[i]==x.right[i]);CHECK(x.left[i]==float(sine[i%64])/32768.0f);}
    a.write(0,0x1020);const auto release=render(a,4410);
    CHECK(std::all_of(release.left.end()-100,release.left.end(),[](float v){return v==0;}));
    CHECK(scsp_reset(a.value,0));CHECK(scsp_read_ram(a.value,0x1002,bytes,2));CHECK(bytes[0]!=0||bytes[1]!=0);
    const auto muted=render(a,100);CHECK(std::all_of(muted.left.begin(),muted.left.end(),[](float v){return v==0;}));
    CHECK(scsp_reset(a.value,1));CHECK(scsp_read_ram(a.value,0x1002,bytes,2));CHECK(bytes[0]==0&&bytes[1]==0);
    CHECK(render(b,64).left[1]!=0); // reset of a cannot change b
    Chip last;configure(last,31,0x1f00);const auto pan=render(last,128);
    CHECK(*std::max_element(pan.left.begin(),pan.left.end())>0);
    CHECK(std::all_of(pan.right.begin(),pan.right.end(),[](float v){return v==0;}));
    // Byte order and signed PCM8, with direct output bypassing EG/TL.
    Chip eight;configure(eight);const uint8_t pcm8[4]={0x80,0,0x7f,0};
    CHECK(scsp_load_ram(eight.value,0x1000,pcm8,4));eight.write(6,4);eight.write(12,0x100);eight.write(0,0x1830);
    const auto e=render(eight,16,1);CHECK(e.left[0]==-1.0f&&e.left[1]==0&&e.left[2]==127.0f/128&&e.left[3]==0);
    Chip many;for(unsigned slot=0;slot<32;++slot)configure(many,slot);
    const auto chord=render(many,1024);
    CHECK(std::all_of(chord.left.begin(),chord.left.end(),[](float v){return std::isfinite(v)&&v>=-1&&v<=1;}));
    CHECK(*std::max_element(chord.left.begin(),chord.left.end())==1);
    std::puts("SCSP self-test passed: sine/PCM8, stereo, slot31, 32-slot clamp, release, reset, bounds, masked writes and render partitions");return 0;
}
int main(int argc,char **argv) {
    if(argc==2&&!std::strcmp(argv[1],"--self-test"))return self_test();
    if(argc==2&&!std::strcmp(argv[1],"--pcm")) {
        scsp_pattern::Chip chip;scsp_pattern::configure(chip);
        const auto a=scsp_pattern::render(chip,8192,127);
        for(unsigned i=0;i<a.left.size();++i)for(float v:{a.left[i],a.right[i]}){
            uint32_t bits;std::memcpy(&bits,&v,4);
            for(unsigned shift=0;shift<32;shift+=8)std::putchar((bits>>shift)&255);
        }
        return 0;
    }
    std::fputs("Usage: scsp_fixture --self-test | --pcm\n",stderr);return 2;
}
