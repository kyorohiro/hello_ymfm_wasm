#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"
OUT_DIR="${1:-$ROOT_DIR/dist/wasm}"

mkdir -p "$OUT_DIR"

"${EMXX:-em++}" -std=c++14 -O2 \
  -Ivendor/ymfm \
  wasm/ymf262_wasm.cpp \
  vendor/ymfm/ymfm_opl.cpp \
  vendor/ymfm/ymfm_adpcm.cpp \
  vendor/ymfm/ymfm_pcm.cpp \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
  -sENVIRONMENT=web,worker,node,shell \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORT_ALL=1 \
  -sEXPORTED_FUNCTIONS='["_ymf262_create","_ymf262_destroy","_ymf262_reset","_ymf262_write","_ymf262_read","_ymf262_read_status","_ymf262_get_irq","_ymf262_sample_rate","_ymf262_generate","_ymf262_set_mute_mask","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' \
  -o "$OUT_DIR/ymf262_wasm.js"
