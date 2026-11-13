// SPDX-License-Identifier: BSD-3-Clause
// The imported functions are WASM exports, never JS per-cycle closures.
#include "sid_endpoint.h"
#include <cstring>
#include <limits>
#ifdef __EMSCRIPTEN__
#define SID8_IMPORT(name) __attribute__((import_module("env"),import_name(#name)))
#else
#define SID8_IMPORT(name)
#endif
extern "C" {
SID8_IMPORT(sid8e_create) uint32_t sid8e_create(uint32_t,uint32_t);
SID8_IMPORT(sid8e_destroy) uint32_t sid8e_destroy(uint32_t);
SID8_IMPORT(sid8e_reset) uint32_t sid8e_reset(uint32_t);
SID8_IMPORT(sid8e_stop) uint32_t sid8e_stop(uint32_t);
SID8_IMPORT(sid8e_set_profiles) uint32_t sid8e_set_profiles(uint32_t,uint32_t);
SID8_IMPORT(sid8e_error) uint32_t sid8e_error(uint32_t);
SID8_IMPORT(sid8e_tick) uint32_t sid8e_tick(uint32_t,uint32_t,uint32_t,uint32_t);
SID8_IMPORT(sid8e_write) uint32_t sid8e_write(uint32_t,uint32_t,uint32_t);
}
extern "C" int tetorica_sid8580_manual_write(m6581_t* sid,unsigned reg,unsigned value) {
    return sid->handle && !sid->error && reg<=24 && value<=255 && sid8e_write(sid->handle,reg,value);
}
static void increase(uint32_t& n) { if(n!=std::numeric_limits<uint32_t>::max())++n; }
void m6581_init(m6581_t* sid,const m6581_desc_t* desc) {
    std::memset(sid,0,sizeof(*sid)); sid->sample_mag=desc->magnitude;
    if(desc->tick_hz!=985248 || desc->sound_hz<8000 || desc->sound_hz>96000) {sid->error=2;return;}
    sid->handle=sid8e_create(static_cast<uint32_t>(desc->sound_hz),0);
    if(!sid->handle || !sid8e_reset(sid->handle))sid->error=1;
    else sid->error=sid8e_error(sid->handle);
}
void m6581_reset(m6581_t* sid) {
    if(sid->handle)sid8e_reset(sid->handle);
    sid->sample=0;sid->error=0;sid->cycles=0;sid->pins=0;sid8580_endpoint_clear_debug(sid);
}
void sid8580_endpoint_stop(m6581_t* sid) {
    if(sid->handle)sid8e_stop(sid->handle);sid->sample=0;
    // Keep actual read/fault history and elapsed cycles for diagnosis.
}
void sid8580_endpoint_discard(m6581_t* sid) {
    if(sid->handle)sid8e_destroy(sid->handle);std::memset(sid,0,sizeof(*sid));
}
void sid8580_endpoint_clear_debug(m6581_t* sid) {
    sid->read_count=sid->write_count=sid->read_trace_count=sid->read_trace_dropped=0;
    sid->observable_mask=sid->osc3_value=sid->env3_value=0;sid->osc3_cycle=sid->env3_cycle=0;
}
int sid8580_endpoint_set_profiles(m6581_t* sid,unsigned profiles) {
    if(!sid->handle || profiles>3 || !sid8e_set_profiles(sid->handle,profiles))return 0;
    sid->profiles=profiles;return 1;
}
uint64_t m6581_tick(m6581_t* sid,uint64_t pins) {
    const unsigned reg=static_cast<unsigned>(pins&31),data=static_cast<unsigned>((pins>>16)&255);
    const unsigned access=(pins&M6581_CS)?((pins&M6581_RW)?2:1):0;
    const uint32_t result=sid8e_tick(sid->handle,access,reg,data);
    if(result&(1u<<9))++sid->cycles;
    pins&=~M6581_SAMPLE;
    if(result&(1u<<8)) {
        int sample=static_cast<int>(result>>16);if(sample>=32768)sample-=65536;
        sid->sample=(sample/32768.0f)*sid->sample_mag;pins|=M6581_SAMPLE;
    }
    sid->error=(result>>10)&63;
    if(access==2 && (result&(1u<<9))) {
        increase(sid->read_count);const unsigned value=result&255;
        if(sid->read_trace_count<4096)sid->read_trace[sid->read_trace_count++]={
            static_cast<uint32_t>(sid->cycles),static_cast<uint32_t>(sid->cycles>>32),
            static_cast<uint32_t>(pins&65535),reg,sid->error?256u:value,sid->error};
        else increase(sid->read_trace_dropped);
        if(!sid->error && reg==27){sid->observable_mask|=1;sid->osc3_value=value;sid->osc3_cycle=sid->cycles;}
        if(!sid->error && reg==28){sid->observable_mask|=2;sid->env3_value=value;sid->env3_cycle=sid->cycles;}
        pins=(pins&~(255ULL<<16))|(static_cast<uint64_t>(value)<<16);
    } else if(access==1 && (result&(1u<<9)))increase(sid->write_count);
    sid->error_register=reg;sid->pins=pins;return pins;
}
