#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"
OUT_DIR="${1:-$ROOT_DIR/dist/wasm}"

mkdir -p "$OUT_DIR"

"${EMXX:-em++}" -std=c++14 -O2 \
  -Ivendor/ymfm \
  wasm/ym3526_wasm.cpp \
  vendor/ymfm/ymfm_opl.cpp \
  vendor/ymfm/ymfm_adpcm.cpp \
  vendor/ymfm/ymfm_pcm.cpp \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
  -sENVIRONMENT=web,worker,node,shell \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORT_ALL=1 \
  -sEXPORTED_FUNCTIONS='["_ym3526_create","_ym3526_destroy","_ym3526_reset","_ym3526_write","_ym3526_read","_ym3526_read_status","_ym3526_get_irq","_ym3526_sample_rate","_ym3526_set_mute_mask","_ym3526_generate","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' \
  -o "$OUT_DIR/ym3526_wasm.js"
