// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro
// Original integer sine fixture, no game samples or driver code.
#pragma once
#include <tetorica/scsp.h>
#include <array>
#include <cstdint>
#include <stdexcept>
#include <vector>
namespace scsp_pattern {
inline constexpr std::array<int16_t,64> sine={0,803,1598,2378,3135,3862,4551,5197,5793,6333,6811,7225,7568,7839,8035,8153,8192,8153,8035,7839,7568,7225,6811,6333,5793,5197,4551,3862,3135,2378,1598,803,0,-803,-1598,-2378,-3135,-3862,-4551,-5197,-5793,-6333,-6811,-7225,-7568,-7839,-8035,-8153,-8192,-8153,-8035,-7839,-7568,-7225,-6811,-6333,-5793,-5197,-4551,-3862,-3135,-2378,-1598,-803};
struct Chip {
    void *value=scsp_create();
    Chip(){if(!value)throw std::runtime_error("SCSP allocation failed");}
    ~Chip(){scsp_destroy(value);}
    Chip(const Chip&)=delete;Chip& operator=(const Chip&)=delete;
    void write(uint32_t at,uint16_t v){if(!scsp_write(value,at,v,0xffff))throw std::runtime_error("SCSP register rejected");}
};
inline void configure(Chip &chip,unsigned slot=0,uint16_t pan=0) {
    std::array<uint8_t,128> bytes{};
    for(unsigned i=0;i<sine.size();++i){const uint16_t v=sine[i];bytes[i*2]=v>>8;bytes[i*2+1]=v;}
    if(!scsp_load_ram(chip.value,0x1000,bytes.data(),bytes.size()))throw std::runtime_error("SCSP upload rejected");
    chip.write(0x400,0x020f);
    const unsigned b=slot*32;
    chip.write(b+2,0x1000);chip.write(b+4,0);chip.write(b+6,64);
    chip.write(b+8,31);chip.write(b+10,0x3c1f); // fastest attack/release, no decay, KRS disabled
    chip.write(b+12,0);chip.write(b+14,0);chip.write(b+16,0);chip.write(b+18,0);
    chip.write(b+20,0);chip.write(b+22,0xe000|pan);
    chip.write(b,0x1820); // key bit + execute, forward loop, signed PCM16
}
struct Audio {std::vector<float> left,right;};
inline Audio render(Chip &chip,unsigned frames,unsigned block=127) {
    Audio a{std::vector<float>(frames),std::vector<float>(frames)};
    for(unsigned at=0;at<frames;at+=block){const unsigned n=std::min(block,frames-at);if(!scsp_render(chip.value,a.left.data()+at,a.right.data()+at,n))throw std::runtime_error("SCSP render rejected");}
    return a;
}
}
