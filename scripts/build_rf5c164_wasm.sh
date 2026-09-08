#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"

mkdir -p "$OUT_DIR"

em++ -std=c++14 \
  -Ithird_party/mame-rf5c164 \
  wasm/rf5c164_wasm.cpp \
  third_party/mame-rf5c164/rf5c164.cpp \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
  -sENVIRONMENT=web,worker,shell \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORT_ALL=1 \
  -sEXPORTED_FUNCTIONS='["_rf5c164_create","_rf5c164_destroy","_rf5c164_reset","_rf5c164_write","_rf5c164_sample_rate","_rf5c164_generate","_rf5c164_clear_memory","_rf5c164_write_memory","_rf5c164_read_memory","_rf5c164_read","_rf5c164_load","_rf5c164_bank","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32","HEAPU8"]' \
  -o "$OUT_DIR/rf5c164_wasm.js"
