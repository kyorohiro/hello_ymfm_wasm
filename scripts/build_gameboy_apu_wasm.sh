#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"
mkdir -p "$OUT_DIR"
cd "$ROOT_DIR"
em++ -std=c++17 -O2 -Ithird_party/mame-gameboy \
  wasm/gameboy_apu_wasm.cpp third_party/mame-gameboy/gameboy_apu.cpp \
  -sMODULARIZE=1 -sEXPORT_ES6=1 \
  -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
  -sENVIRONMENT=web,worker,node,shell -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS='["_gameboy_apu_create","_gameboy_apu_destroy","_gameboy_apu_reset","_gameboy_apu_write","_gameboy_apu_sample_rate","_gameboy_apu_set_mute_mask","_gameboy_apu_generate","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' \
  -o "$OUT_DIR/gameboy_apu_wasm.js"
