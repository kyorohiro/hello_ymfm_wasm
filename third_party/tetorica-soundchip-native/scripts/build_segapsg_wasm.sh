#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"
OUT_DIR="${1:-$ROOT_DIR/dist/wasm}"

mkdir -p "$OUT_DIR"

# Keep runtime checks while optimizing the audio-thread synthesis hot path.
"${EMXX:-em++}" -std=c++14 -O2 -sASSERTIONS=1 \
  -Ivendor/tetorica_sega_psg -Ivendor/ymfm \
  wasm/segapsg_wasm.cpp \
  vendor/tetorica_sega_psg/segapsg.cpp \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
  -sENVIRONMENT=web,worker,node,shell \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORT_ALL=1 \
  -sEXPORTED_FUNCTIONS='["_segapsg_create","_segapsg_destroy","_segapsg_reset","_segapsg_write","_segapsg_set_mute_mask","_segapsg_set_stereo","_segapsg_sample_rate","_segapsg_generate","_segapsg_save_state","_segapsg_load_state","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' \
  -o "$OUT_DIR/segapsg_wasm.js"
