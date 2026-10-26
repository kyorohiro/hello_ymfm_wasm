#!/bin/sh
# Build the included WonderSwan adaptation without MAME infrastructure.
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"
OUT_DIR="${1:-$ROOT_DIR/dist/wasm}"
mkdir -p "$OUT_DIR"
OUT_DIR=$(CDPATH= cd -- "$OUT_DIR" && pwd)
"${EMXX:-em++}" -std=c++14 -O2 -Ivendor/mame-wonderswan \
 wasm/wonderswan_wasm.cpp vendor/mame-wonderswan/wonderswan.cpp \
 -sMODULARIZE=1 -sEXPORT_ES6=1 -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
 -sENVIRONMENT=web,worker,node,shell -sALLOW_MEMORY_GROWTH=1 \
 -sEXPORTED_FUNCTIONS='["_wonderswan_create","_wonderswan_destroy","_wonderswan_reset","_wonderswan_write","_wonderswan_read","_wonderswan_write_memory","_wonderswan_read_memory","_wonderswan_mute","_wonderswan_generate","_malloc","_free"]' \
 -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' \
 -o "$OUT_DIR/wonderswan_wasm.js"
