// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro
// Test transport only. Decode with the actual pinned core's internal decoder;
// do not keep a second implementation of PSX ADPCM arithmetic in the tests.
#include "../../third_party/tetorica-soundchip-native/vendor/mame-ps1-spu/spu.cpp"
#include <cstdint>
#include <cstdio>
#include <cstdlib>
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
static void write_i16(int16_t value)
{
    const auto bits=uint16_t(value);std::putchar(bits&255);std::putchar(bits>>8);
}
int main()
{
    const uint32_t streams=read_u32();if(streams>1024)return 3;
    for(uint32_t stream=0;stream<streams;stream++) {
        const uint32_t size=read_u32();if(!size||size%16||size>2*1024*1024)return 3;
        std::vector<uint8_t> bytes(size);if(std::fread(bytes.data(),1,size,stdin)!=size)return 2;
        adpcm_decoder decoder;
        for(uint32_t offset=0;offset<size;offset+=16) {
            adpcm_packet packet;std::memcpy(&packet,bytes.data()+offset,16);
            signed short pcm[28];decoder.decode_packet(&packet,pcm);
            for(const auto sample:pcm)write_i16(sample);
        }
    }
    return std::ferror(stdout)?4:0;
}
