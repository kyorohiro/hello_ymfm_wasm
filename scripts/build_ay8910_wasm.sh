#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"
mkdir -p "$OUT_DIR"
cd "$ROOT_DIR"
em++ -std=c++17 -O2 -Ithird_party/mame-ay8910 \
  wasm/ay8910_wasm.cpp third_party/mame-ay8910/ay8910.cpp \
  -sMODULARIZE=1 -sEXPORT_ES6=1 \
  -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
  -sENVIRONMENT=web,worker,node,shell -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS='["_ay8910_create","_ay8910_destroy","_ay8910_reset","_ay8910_write","_ay8910_read","_ay8910_sample_rate","_ay8910_set_mute_mask","_ay8910_generate","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' \
  -o "$OUT_DIR/ay8910_wasm.js"
