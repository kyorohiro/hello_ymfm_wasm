#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"
OUT_DIR="${1:-$ROOT_DIR/dist/wasm}"

mkdir -p "$OUT_DIR"

"${EMXX:-em++}" -std=c++14 -O2 \
  -Ivendor/ymfm \
  wasm/ym2151_wasm.cpp \
  vendor/ymfm/ymfm_opm.cpp \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
  -sENVIRONMENT=web,worker,node,shell \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORT_ALL=1 \
  -sEXPORTED_FUNCTIONS='["_ym2151_create","_ym2164_create","_ym2151_destroy","_ym2151_reset","_ym2151_write","_ym2151_read","_ym2151_read_status","_ym2151_get_irq","_ym2151_sample_rate","_ym2151_generate","_ym2151_set_mute_mask","_ym2151_save_state","_ym2151_load_state","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' \
  -o "$OUT_DIR/ym2151_wasm.js"

# Keep generated glue free of whitespace-only diff noise.
perl -pi -e 's/[ \t]+$//' "$OUT_DIR/ym2151_wasm.js"
