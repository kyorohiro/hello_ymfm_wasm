#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"
OUT_DIR="${1:-$ROOT_DIR/dist/wasm}"
mkdir -p "$OUT_DIR"
cd "$ROOT_DIR"
"${EMXX:-em++}" -std=c++17 -O2 -fwrapv -fno-strict-aliasing -ffp-contract=off -fexceptions \
  -Ithird_party/tetorica-nes \
  wasm/nesapu_wasm.cpp third_party/tetorica-nes/nes_core.cpp \
  -sMODULARIZE=1 -sEXPORT_ES6=1 \
  -sINCOMING_MODULE_JS_API='["wasmBinary","locateFile","print","printErr","noInitialRun"]' \
  -sENVIRONMENT=web,worker,node,shell -sALLOW_MEMORY_GROWTH=1 \
  -sDISABLE_EXCEPTION_CATCHING=0 \
  -sEXPORTED_FUNCTIONS='["_native_nes_create","_native_nes_destroy","_native_nes_reset","_native_nes_stop","_native_nes_write","_native_nes_enable","_native_nes_load","_native_nes_set_mute","_native_nes_set_clock","_native_nes_sample","_native_nes_get_state","_native_nes_read_memory","_nesapu_generate","_nesapu_state_size","_nesapu_state_field_count","_nesapu_state_offset","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPU8","HEAPU32","HEAPF32","HEAPF64"]' \
  -o "$OUT_DIR/nesapu_wasm.js"
