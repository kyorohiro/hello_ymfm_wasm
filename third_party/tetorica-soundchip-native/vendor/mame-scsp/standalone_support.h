// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro
#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iterator>
using u8=uint8_t; using u16=uint16_t; using u32=uint32_t;
using s16=int16_t; using s32=int32_t; using s64=int64_t;
template<class T> constexpr unsigned BIT(T value,unsigned bit) { return (value>>bit)&1; }
namespace util {
inline s32 sext(u32 value,unsigned bits) {
    const u32 mask=(u32(1)<<bits)-1,sign=u32(1)<<(bits-1);
    const u32 low=value&mask;
    return low&sign ? s32(low)-s32(u32(1)<<bits) : s32(low);
}
}
// Saturn sound RAM is byte addressed and 16-bit PCM is big endian. The
// instrument fixes 512 KiB mode; chip addresses wrap within this private RAM.
struct scsp_memory {
    std::array<u8,524288> bytes{};
    u8 read_byte(u32 at) const { return bytes[at&0x7ffff]; }
    u16 read_word(u32 at) const { return (u16(read_byte(at))<<8)|read_byte(at+1); }
    void write_word(u32 at,u16 value) { bytes[at&0x7ffff]=value>>8; bytes[(at+1)&0x7ffff]=value; }
};
// Stack-only adapter around caller-owned buffers. External input is silent;
// MAME's DAC clamp precedes the master-volume gain, as in its sound stream.
struct sound_stream {
    float *left,*right; u32 frames; float gain;
    sound_stream(float *l,float *r,u32 n,float g):left(l),right(r),frames(n),gain(g){}
    u32 samples() const { return frames; }
    float get(int,u32) const { return 0; }
    void put_int_clamp(int channel,u32 frame,s32 value,s32 scale) {
        (channel?right:left)[frame]=std::clamp(float(value)/float(scale),-1.0f,1.0f)*gain;
    }
};
