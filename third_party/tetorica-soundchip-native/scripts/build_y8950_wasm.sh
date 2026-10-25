#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"
OUT_DIR="${1:-$ROOT_DIR/dist/wasm}"

mkdir -p "$OUT_DIR"

"${EMXX:-em++}" -std=c++14 -O2 \
  -Ivendor/ymfm \
  wasm/y8950_wasm.cpp \
  vendor/ymfm/ymfm_opl.cpp \
  vendor/ymfm/ymfm_adpcm.cpp \
  vendor/ymfm/ymfm_pcm.cpp \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
  -sENVIRONMENT=web,worker,node,shell \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORT_ALL=1 \
  -sEXPORTED_FUNCTIONS='["_y8950_set_mute_mask","_y8950_create","_y8950_destroy","_y8950_reset","_y8950_write","_y8950_read","_y8950_read_status","_y8950_get_irq","_y8950_sample_rate","_y8950_generate","_y8950_load_memory","_y8950_clear_memory","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32","HEAPU8"]' \
  -o "$OUT_DIR/y8950_wasm.js"
