#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"

mkdir -p "$OUT_DIR"

em++ -std=c++14 \
  -Isrc \
  wasm/ym2610b_wasm.cpp \
  src/ymfm_adpcm.cpp src/ymfm_misc.cpp src/ymfm_opl.cpp src/ymfm_opm.cpp \
  src/ymfm_opn.cpp src/ymfm_opq.cpp src/ymfm_opz.cpp src/ymfm_pcm.cpp src/ymfm_ssg.cpp \
  -sMODULARIZE=1 -sEXPORT_ES6=1 \
  -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
  -sENVIRONMENT=web,worker,node,shell -sALLOW_MEMORY_GROWTH=1 -sEXPORT_ALL=1 \
  -sEXPORTED_FUNCTIONS='["_ym2610b_create","_ym2610b_destroy","_ym2610b_reset","_ym2610b_write","_ym2610b_read","_ym2610b_read_status","_ym2610b_read_status_hi","_ym2610b_get_irq","_ym2610b_sample_rate","_ym2610b_generate","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' \
  -o "$OUT_DIR/ym2610b_wasm.js"
