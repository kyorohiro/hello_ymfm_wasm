#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"

mkdir -p "$OUT_DIR"

em++ -std=c++14 -O2 \
  -Isrc \
  wasm/ym2151_wasm.cpp \
  src/ymfm_opm.cpp \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
  -sENVIRONMENT=web,worker,node,shell \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORT_ALL=1 \
  -sEXPORTED_FUNCTIONS='["_ym2151_create","_ym2151_destroy","_ym2151_reset","_ym2151_write","_ym2151_read","_ym2151_read_status","_ym2151_get_irq","_ym2151_sample_rate","_ym2151_generate","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' \
  -o "$OUT_DIR/ym2151_wasm.js"
