#pragma once
// Reference C ABI for the NES APU: two pulses, triangle, noise, copied 64 KiB
// DMC RAM, and optional FDS wavetable/modulation synthesis. No CPU, machine,
// audio device, filesystem, or host sample pointer is owned.
//
// create accepts output rates 8000..384000 Hz and a finite base clock
// 1600000..1900000 Hz. A base clock below 1700000 selects PAL timing tables;
// set_clock accepts 100000..100000000 Hz and resamples that original timing.
// Writes use native CPU addresses ($4000..$4017, plus optional FDS registers).
// Mute bits 0..5 affect output while sources continue advancing. Observations
// do not advance audio. All operations on an instance belong to one thread.
//
// Stop retains RAM, wave/modulation data, frequency, clock, and mute settings;
// its FDS halt/zero-gain writes obey $4023 IO. stop_channel(5) halts FDS even
// with IO disabled and retains gain and authored IO. Output filters and the
// ordinary DMC gate can retain a tail/DAC value; Stop is not a filter reset.
// reset clears RAM, patch and filter history, retaining clock and mute.
#include "native_genesis_nes.h"
