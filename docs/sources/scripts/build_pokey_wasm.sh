#!/bin/sh
# Compile the standalone BSD POKEY adaptation, not the archived framework file.
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"
OUT_DIR="${1:-$ROOT_DIR/dist/wasm}"
mkdir -p "$OUT_DIR"
OUT_DIR=$(CDPATH= cd -- "$OUT_DIR" && pwd)
"${EMXX:-em++}" -std=c++14 -O2 -fexceptions -Ithird_party/libvgm-pokey \
 wasm/pokey_wasm.cpp third_party/libvgm-pokey/pokey.cpp \
 -sMODULARIZE=1 -sEXPORT_ES6=1 -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
 -sENVIRONMENT=web,worker,node,shell -sALLOW_MEMORY_GROWTH=1 \
 -sEXPORTED_FUNCTIONS='["_pokey_create","_pokey_destroy","_pokey_reset","_pokey_write","_pokey_read","_pokey_mute","_pokey_generate","_malloc","_free"]' \
 -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' \
 -o "$OUT_DIR/pokey_wasm.js"
