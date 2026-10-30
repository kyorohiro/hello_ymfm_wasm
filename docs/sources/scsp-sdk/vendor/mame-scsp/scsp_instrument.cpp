// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro
#include "scsp_instrument.h"
#include "scsp.h"
#include <new>
namespace {
bool range(uint32_t at,uint32_t size) { return at<=524288 && size<=524288-at; }
bool readable(uint32_t at) {
    return !(at&1) && (at<0x400 || at==0x400 || at==0x402 || at==0x408 || (at>=0x600 && at<=0xee2));
}
bool writable(uint32_t at) {
    return readable(at) && (at<0x600 || (at<0xc00 && !(at>=0x7c0 && at<0x800)));
}
}
extern "C" {
void *scsp_create(void) { return new(std::nothrow) scsp_device; }
void scsp_destroy(void *handle) { delete static_cast<scsp_device*>(handle); }
int scsp_reset(void *handle,int clear_ram) {
    if(!handle || (clear_ram!=0 && clear_ram!=1))return 0;
    static_cast<scsp_device*>(handle)->reset(clear_ram!=0);return 1;
}
uint32_t scsp_sample_rate(void) { return 44100; }
uint32_t scsp_read(void *handle,uint32_t at) {
    if(!handle || !readable(at))return 0xffffffff;
    return static_cast<scsp_device*>(handle)->read(at/2);
}
int scsp_write(void *handle,uint32_t at,uint16_t value,uint16_t mask) {
    if(!handle || !writable(at))return 0;
    auto *chip=static_cast<scsp_device*>(handle);
    const uint16_t merged=(chip->read(at/2)&~mask)|(value&mask);
    if(at==0x400 && ((merged&~0x030f) || !(merged&0x0200)))return 0;
    if(at==0x402 && (merged&~0x01bf))return 0;
    if(at==0x408 && (value&mask&~0xf800))return 0;
    if(at<0x400 && at%32==0 && ((merged>>7)&3)==3)return 0;
    if(mask)chip->write(at/2,value,mask);
    return 1;
}
int scsp_load_ram(void *handle,uint32_t at,const uint8_t *data,uint32_t size) {
    if(!handle || !range(at,size) || (size && !data))return 0;
    if(size)std::memcpy(static_cast<scsp_device*>(handle)->memory.bytes.data()+at,data,size);
    return 1;
}
int scsp_read_ram(void *handle,uint32_t at,uint8_t *data,uint32_t size) {
    if(!handle || !range(at,size) || (size && !data))return 0;
    if(size)std::memcpy(data,static_cast<scsp_device*>(handle)->memory.bytes.data()+at,size);
    return 1;
}
int scsp_render(void *handle,float *left,float *right,uint32_t frames) {
    if(!handle || frames>1048576)return 0;
    if(!frames)return 1;
    if(!left || !right)return 0;
    const uintptr_t l=reinterpret_cast<uintptr_t>(left),r=reinterpret_cast<uintptr_t>(right);
    const uintptr_t distance=l<r?r-l:l-r;
    if(distance<uintptr_t(frames)*sizeof(float))return 0;
    static_cast<scsp_device*>(handle)->render(left,right,frames);return 1;
}
}
