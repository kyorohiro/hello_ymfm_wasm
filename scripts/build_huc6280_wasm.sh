#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"
mkdir -p "$OUT_DIR"
cd "$ROOT_DIR"
em++ -std=c++14 -O2 -Ithird_party/mame-huc6280 \
 wasm/huc6280_wasm.cpp third_party/mame-huc6280/huc6280.cpp \
 -sMODULARIZE=1 -sEXPORT_ES6=1 -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
 -sENVIRONMENT=web,worker,node,shell -sALLOW_MEMORY_GROWTH=1 -sEXPORT_ALL=1 \
 -sEXPORTED_FUNCTIONS='["_huc6280_create","_huc6280_destroy","_huc6280_reset","_huc6280_mute","_huc6280_write","_huc6280_generate","_malloc","_free"]' \
 -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' -o "$OUT_DIR/huc6280_wasm.js"
