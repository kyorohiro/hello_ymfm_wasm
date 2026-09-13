#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"

mkdir -p "$OUT_DIR"

em++ -std=c++14 -O2 \
  -Isrc \
  wasm/ym3812_wasm.cpp \
  src/ymfm_opl.cpp \
  src/ymfm_adpcm.cpp \
  src/ymfm_pcm.cpp \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
  -sENVIRONMENT=web,worker,node,shell \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORT_ALL=1 \
  -sEXPORTED_FUNCTIONS='["_ym3812_create","_ym3812_destroy","_ym3812_reset","_ym3812_write","_ym3812_read","_ym3812_read_status","_ym3812_get_irq","_ym3812_sample_rate","_ym3812_generate","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' \
  -o "$OUT_DIR/ym3812_wasm.js"
