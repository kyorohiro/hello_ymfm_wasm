#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"
mkdir -p "$OUT_DIR"
cd "$ROOT_DIR"
em++ -std=c++17 -O2 -Ithird_party/mame-segapcm \
  wasm/segapcm_wasm.cpp third_party/mame-segapcm/segapcm.cpp \
  -sMODULARIZE=1 -sEXPORT_ES6=1 \
  -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
  -sENVIRONMENT=web,worker,node,shell -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS='["_segapcm_create","_segapcm_destroy","_segapcm_reset","_segapcm_write","_segapcm_load_memory","_segapcm_clear_memory","_segapcm_sample_rate","_segapcm_set_mute_mask","_segapcm_generate","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32","HEAPU8"]' \
  -o "$OUT_DIR/segapcm_wasm.js"
