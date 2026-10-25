#pragma once
// Reference C ABI for the accurate eight-voice S-DSP instrument. No SPC700 CPU,
// ROM, output device, or mixer is included. The source clock is fixed at 32000
// stereo frames/s; sample returns two floats at the requested 8000..384000 Hz
// output rate with two source-frame prefetch and integer-phase interpolation.
// Creation returns null for an unsupported rate or allocation failure. Runtime
// operations allocate no memory. An instance and its views belong to one thread;
// ordinary operations require valid nonnull instance and output pointers.
//
// load copies bytes into the owned 65536-byte RAM and rejects null nonempty
// input or out-of-range spans without modifying RAM. The source must not overlap
// the destination RAM span. get_ram copies all RAM.
// ram_data borrows the same read-only allocation across Stop/reset; it expires
// at destruction and must not be read concurrently with instance mutation.
// read_memory accepts a 16-bit address. Writes outside registers 0..127 and
// key operations outside channels 0..7 are ignored. State reads do not advance
// the chip. Protected writes retain masked KON/KOFF bits for host-owned voices;
// all other registers are written normally. Stop retains RAM and authored DSP
// settings, clears gates and DSP/interpolation history, and detaches the timeline.
// Retained echo RAM/echo volume can still produce output after Stop. Reset also
// clears RAM and restores the DSP's nonzero power-on register image (muted by
// FLG), rather than zeroing all registers. destroy accepts null.
//
// prepare_timeline borrows immutable 65536-byte RAM, 128-byte DSP, and count*4
// uint32_t event storage (events may be null only when count is zero). The caller
// prevalidates count<=UINT32_MAX/4, duration>=32 divisible by32,
// events ordered by nondecreasing clock<=duration, kind0(DSP)/1(RAM), addresses
// <=127/65535 respectively, and values<=255. Each tuple is clock/kind/address/
// value. Storage must remain alive until Stop, reset, replacement, or destroy;
// stop_timeline and natural completion retain these borrowed arrays. Preparation
// copies initial RAM/DSP into the core and pauses; play_timeline restarts from
// those arrays, and stop_timeline pauses without advancing position. State is
// observation only, not a portable saved-state format.
#include "native_genesis_snes.h"
