// SPDX-License-Identifier: BSD-3-Clause
// Compatibility declarations for pristine c64.h, backed only by actual 8580.
#ifndef TETORICA_SID8580_ENDPOINT_H
#define TETORICA_SID8580_ENDPOINT_H
#include <stdint.h>
#define M6581_ADDR_MASK (0x1F)
#define M6581_RW (1ULL<<24)
#define M6581_CS (1ULL<<40)
#define M6581_SAMPLE (1ULL<<41)
#define M6581_NUM_REGS (32)
typedef struct { int tick_hz; int sound_hz; float magnitude; } m6581_desc_t;
typedef struct { uint32_t cycleLow,cycleHigh,address,reg,value,error; } sid8580_read_entry;
typedef struct {
    uint32_t handle,error,error_register,profiles;
    float sample,sample_mag;
    uint64_t cycles,pins;
    uint32_t read_count,write_count,read_trace_count,read_trace_dropped;
    uint32_t observable_mask,osc3_value,env3_value;
    uint64_t osc3_cycle,env3_cycle;
    sid8580_read_entry read_trace[4096];
} m6581_t;
#ifdef __cplusplus
extern "C" {
#endif
void m6581_init(m6581_t*,const m6581_desc_t*);
void m6581_reset(m6581_t*);
uint64_t m6581_tick(m6581_t*,uint64_t);
void sid8580_endpoint_discard(m6581_t*);
void sid8580_endpoint_stop(m6581_t*);
void sid8580_endpoint_clear_debug(m6581_t*);
int sid8580_endpoint_set_profiles(m6581_t*,unsigned);
#ifdef __cplusplus
}
#endif
#endif
