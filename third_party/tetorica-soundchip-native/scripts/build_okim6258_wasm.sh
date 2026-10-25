#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"
OUT_DIR="${1:-$ROOT_DIR/dist/wasm}"
mkdir -p "$OUT_DIR"
cd "$ROOT_DIR"
"${EMXX:-em++}" -std=c++14 -O2 -Ivendor/ymfm -Ivendor/mame-okim6258 \
 wasm/okim6258_wasm.cpp vendor/mame-okim6258/okim6258.cpp \
 -sMODULARIZE=1 -sEXPORT_ES6=1 -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
 -sENVIRONMENT=web,worker,node,shell -sALLOW_MEMORY_GROWTH=1 -sEXPORT_ALL=1 \
 -sEXPORTED_FUNCTIONS='["_okim6258_create","_okim6258_destroy","_okim6258_reset","_okim6258_write","_okim6258_generate","_okim6258_save_state","_okim6258_load_state","_malloc","_free"]' \
 -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' -o "$OUT_DIR/okim6258_wasm.js"

# Keep generated glue free of whitespace-only diff noise.
perl -pi -e 's/[ \t]+$//' "$OUT_DIR/okim6258_wasm.js"
