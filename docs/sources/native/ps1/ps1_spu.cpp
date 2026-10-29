// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro
#include "ps1_spu.h"
#include "spu.h"
#include <cstdint>
#include <limits>
#include <new>

namespace {
constexpr uint32_t ram_size = 512u * 1024u;
constexpr uint32_t max_frames = 1u << 20;
bool memory_range(uint32_t address, uint32_t length)
{
    return address <= ram_size && length <= ram_size - address;
}
bool register_range(uint32_t offset)
{
    return offset <= 0x3fe && !(offset & 1);
}
bool outputs_overlap(const float *left, const float *right, uint32_t frames)
{
    const auto a = reinterpret_cast<uintptr_t>(left);
    const auto b = reinterpret_cast<uintptr_t>(right);
    const uintptr_t bytes = uintptr_t(frames) * sizeof(float);
    if (a > std::numeric_limits<uintptr_t>::max() - bytes ||
        b > std::numeric_limits<uintptr_t>::max() - bytes) return true;
    return a < b + bytes && b < a + bytes;
}
}

extern "C" void *ps1_spu_create(void)
{
    try { return new spu_device; } catch (...) { return nullptr; }
}
extern "C" void ps1_spu_destroy(void *handle)
{
    delete static_cast<spu_device *>(handle);
}
extern "C" uint32_t ps1_spu_sample_rate(void) { return 44100; }
extern "C" int ps1_spu_reset(void *handle, int clear_ram)
{
    if (!handle || (clear_ram != 0 && clear_ram != 1)) return 0;
    try { static_cast<spu_device *>(handle)->reset(clear_ram != 0); return 1; }
    catch (...) { return 0; }
}
extern "C" int ps1_spu_write(void *handle, uint32_t offset, uint16_t value)
{
    if (!handle || !register_range(offset)) return 0;
    if (((offset < 0x180 && (offset & 0xf) < 4) || offset == 0x180 || offset == 0x182) && (value & 0x8000)) return 0;
    // The instrument API intentionally exposes only the standard 512 KiB map.
    if (offset == 0x1ac && (value & 0xe) != 4) return 0;
    // Packets contain 16 bytes; the address registers count eight-byte units.
    if (offset < 0x180 && ((offset & 0xf) == 6 || (offset & 0xf) == 14) && (value & 1)) return 0;
    try { static_cast<spu_device *>(handle)->write(offset / 2, value); return 1; }
    catch (...) { return 0; }
}
extern "C" uint32_t ps1_spu_read(void *handle, uint32_t offset)
{
    if (!handle || !register_range(offset)) return 0xffffffffu;
    try { return static_cast<spu_device *>(handle)->read(offset / 2); }
    catch (...) { return 0xffffffffu; }
}
extern "C" int ps1_spu_refresh_envelope(void *handle, uint32_t channel)
{
    if (!handle || channel >= 24) return 0;
    try { static_cast<spu_device *>(handle)->refresh_envelope(channel); return 1; }
    catch (...) { return 0; }
}
extern "C" int ps1_spu_audition_key(void *handle, uint32_t channel, int on)
{
    if (!handle || channel >= 24 || (on != 0 && on != 1)) return 0;
    try { static_cast<spu_device *>(handle)->audition_key(channel, on != 0); return 1; }
    catch (...) { return 0; }
}
extern "C" int ps1_spu_load_ram(void *handle, uint32_t address, const uint8_t *data, uint32_t length)
{
    if (!handle || !memory_range(address, length) || (length && !data)) return 0;
    if (!length) return 1;
    try { static_cast<spu_device *>(handle)->load_ram(address, data, length); return 1; }
    catch (...) { return 0; }
}
extern "C" int ps1_spu_read_ram(void *handle, uint32_t address, uint8_t *data, uint32_t length)
{
    if (!handle || !memory_range(address, length) || (length && !data)) return 0;
    if (!length) return 1;
    try { static_cast<spu_device *>(handle)->read_ram(address, data, length); return 1; }
    catch (...) { return 0; }
}
extern "C" int ps1_spu_render(void *handle, float *left, float *right, uint32_t frames)
{
    if (!handle || frames > max_frames) return 0;
    if (!frames) return 1;
    if (!left || !right || outputs_overlap(left, right, frames)) return 0;
    try { static_cast<spu_device *>(handle)->render(left, right, frames); return 1; }
    catch (...) { return 0; }
}

extern "C" int ps1_spu_set_mix_headroom(void *handle, uint32_t divisor)
{
    if (!handle || divisor<1 || divisor>32) return 0;
    try {static_cast<spu_device *>(handle)->set_mix_headroom(divisor);return 1;}
    catch (...) {return 0;}
}

extern "C" int ps1_spu_set_host_pcm(void *handle, const int16_t *pcm, uint32_t frames, int loop)
{
    // Thirty minutes at 44.1 kHz; signed mono PCM lives outside SPU RAM.
    if (!handle || frames>44100u*60u*30u || (frames && !pcm) || (loop && frames && frames<4) || (loop!=0 && loop!=1)) return 0;
    try {static_cast<spu_device *>(handle)->set_host_pcm(pcm,frames,loop!=0);return 1;}
    catch (...) {return 0;}
}
extern "C" int ps1_spu_set_host_mask(void *handle, uint32_t mask)
{
    if (!handle || (mask&0xff000000u)) return 0;
    static_cast<spu_device *>(handle)->set_host_mask(mask);return 1;
}
