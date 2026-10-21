#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"
mkdir -p "$OUT_DIR"
cd "$ROOT_DIR"
# JS uses separate double operations. In particular, native ARM64 must not fuse
# multiply/add if its PCM is to match this WASM and the JS reference exactly.
em++ -std=c++14 -O2 -ffp-contract=off wasm/pwm32x_wasm.cpp \
 -sMODULARIZE=1 -sEXPORT_ES6=1 -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
 -sENVIRONMENT=web,worker,node,shell -sALLOW_MEMORY_GROWTH=1 \
 -sEXPORTED_FUNCTIONS='["_pwm32x_create","_pwm32x_destroy","_pwm32x_reset","_pwm32x_write","_pwm32x_read","_pwm32x_generate","_pwm32x_set_clock","_pwm32x_set_gain","_pwm32x_set_output_mode","_pwm32x_set_muted","_pwm32x_tick","_pwm32x_configure_timer","_pwm32x_active","_pwm32x_get","_pwm32x_set","_pwm32x_fifo_count","_pwm32x_fifo_get","_pwm32x_fifo_set","_pwm32x_state_size","_pwm32x_save_state","_pwm32x_load_state","_malloc","_free"]' \
 -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPU8","HEAPU16","HEAPF32"]' -o "$OUT_DIR/pwm32x_wasm.js"
