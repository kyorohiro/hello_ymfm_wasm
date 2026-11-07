// SPDX-License-Identifier: BSD-3-Clause
// Thin ABI around the untouched, pinned zlib chips/m6502 CPU. No CPU reimplementation.
#include <stddef.h>
#include <stdint.h>

// m6502_init only needs memset. Keep the freestanding object independent of a
// C runtime; the build supplies a declaration-only string.h for wasm32.
void *sid8c_memset(void *destination, int value, size_t size) {
    volatile unsigned char *bytes = (volatile unsigned char *)destination;
    for (size_t i = 0; i < size; ++i) bytes[i] = (unsigned char)value;
    return destination;
}
#define memset sid8c_memset
#define CHIPS_ASSERT(condition) ((void)0)
#define assert(condition) ((void)0)
#define CHIPS_IMPL
#include "../../../third_party/chips-m6502/upstream/m6502.h"
#undef memset
#undef assert

typedef struct { m6502_t cpu; uint64_t pins; } sid8c_context;
uint32_t sid8c_size(void) { return (uint32_t)sizeof(sid8c_context); }
uint32_t sid8c_alignment(void) { return (uint32_t)_Alignof(sid8c_context); }
void sid8c_init(void *storage) {
    sid8c_context *context = (sid8c_context *)storage;
    const m6502_desc_t descriptor = {0};
    context->pins = m6502_init(&context->cpu, &descriptor);
}
uint64_t sid8c_tick(void *storage) {
    sid8c_context *context = (sid8c_context *)storage;
    context->pins = m6502_tick(&context->cpu, context->pins);
    return context->pins;
}
void sid8c_data(void *storage, uint32_t value) {
    sid8c_context *context = (sid8c_context *)storage;
    M6502_SET_DATA(context->pins, value);
}
uint32_t sid8c_register(void *storage, uint32_t index) {
    sid8c_context *context = (sid8c_context *)storage;
    switch (index) {
    case 0: return context->cpu.PC;
    case 1: return context->cpu.A;
    case 2: return context->cpu.X;
    case 3: return context->cpu.Y;
    case 4: return context->cpu.S;
    case 5: return context->cpu.P;
    case 6: return context->cpu.IR;
    default: return UINT32_MAX;
    }
}
