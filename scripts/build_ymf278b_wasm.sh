#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"

mkdir -p "$OUT_DIR"

em++ -std=c++14 -O2 \
  -Isrc \
  wasm/ymf278b_wasm.cpp \
  src/ymfm_opl.cpp \
  src/ymfm_adpcm.cpp \
  src/ymfm_pcm.cpp \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
  -sENVIRONMENT=web,worker,node,shell \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORT_ALL=1 \
  -sEXPORTED_FUNCTIONS='["_ymf278b_create","_ymf278b_destroy","_ymf278b_reset","_ymf278b_write","_ymf278b_read","_ymf278b_read_status","_ymf278b_get_irq","_ymf278b_sample_rate","_ymf278b_generate","_ymf278b_load_memory","_ymf278b_clear_memory","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32","HEAPU8"]' \
  -o "$OUT_DIR/ymf278b_wasm.js"
