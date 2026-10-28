// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro
// Test transport only: no ADPCM decoder, synthesis or audio arithmetic.
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
static int selftest()
{
    CHECK(ps1_spu_sample_rate()==44100);
    CHECK(!ps1_spu_reset(nullptr,0));CHECK(!ps1_spu_write(nullptr,0,0));
    CHECK(ps1_spu_read(nullptr,0)==0xffffffffu);
    CHECK(!ps1_spu_load_ram(nullptr,0,nullptr,0));CHECK(!ps1_spu_read_ram(nullptr,0,nullptr,0));
    CHECK(!ps1_spu_render(nullptr,nullptr,nullptr,0));ps1_spu_destroy(nullptr);
    void *chip=ps1_spu_create();CHECK(chip);
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
    std::puts("{\"status\":\"pass\",\"scope\":\"register/RAM guards, 24 voices, ADSR, reverb, isolation and partition invariance\"}");
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
