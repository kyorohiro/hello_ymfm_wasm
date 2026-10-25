#pragma once
// Reference C ABI for 32X PWM: two three-word FIFOs, routing, timer, and
// tag-owned cancellation. create accepts output rates 1..1000000 Hz and uses
// the legacy 23011361 Hz clock, duty output, and gain 1. set_clock accepts
// 100000..100000000 Hz; rejected values leave all state unchanged.
//
// Registers 0/1 select control/cycle; 2/3 enqueue left/right; 4 enqueues both.
// Overflow drops the oldest word. Active control/cycle writes clear FIFOs and
// reconfigure the timer while keeping output latches. get_state never advances
// audio. Tag zero is the ordinary unowned path; cancelling another tag removes
// only its queued words and its currently owned output latches.
//
// Stop clears queued words, latches, and tags while retaining control, cycle,
// clock, and timer phase. reset clears registers, timer, FIFOs, latches, and
// tags while retaining the current clock. Runtime operations allocate no memory.
// An instance belongs to one thread. No CPU, audio device, or host buffer is owned.
#include "native_genesis_pwm.h"
