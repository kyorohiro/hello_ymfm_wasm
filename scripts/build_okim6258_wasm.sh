#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"
mkdir -p "$OUT_DIR"
cd "$ROOT_DIR"
em++ -std=c++14 -O2 -Ithird_party/mame-okim6258 \
 wasm/okim6258_wasm.cpp third_party/mame-okim6258/okim6258.cpp \
 -sMODULARIZE=1 -sEXPORT_ES6=1 -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
 -sENVIRONMENT=web,worker,node,shell -sALLOW_MEMORY_GROWTH=1 -sEXPORT_ALL=1 \
 -sEXPORTED_FUNCTIONS='["_okim6258_create","_okim6258_destroy","_okim6258_reset","_okim6258_write","_okim6258_generate","_malloc","_free"]' \
 -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' -o "$OUT_DIR/okim6258_wasm.js"
