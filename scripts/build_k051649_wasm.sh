#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"
mkdir -p "$OUT_DIR"
cd "$ROOT_DIR"
em++ -std=c++17 -O2 -Ithird_party/mame-k051649 \
  wasm/k051649_wasm.cpp third_party/mame-k051649/k051649.cpp \
  -sMODULARIZE=1 -sEXPORT_ES6=1 \
  -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
  -sENVIRONMENT=web,worker,node,shell -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS='["_k051649_create","_k051649_destroy","_k051649_reset","_k051649_write","_k051649_sample_rate","_k051649_set_mute_mask","_k051649_generate","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' \
  -o "$OUT_DIR/k051649_wasm.js"
