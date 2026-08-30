#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"

mkdir -p "$OUT_DIR"

em++ -std=c++14 \
  -Isrc \
  wasm/ym2203_wasm.cpp \
  src/ymfm_adpcm.cpp \
  src/ymfm_misc.cpp \
  src/ymfm_opl.cpp \
  src/ymfm_opm.cpp \
  src/ymfm_opn.cpp \
  src/ymfm_opq.cpp \
  src/ymfm_opz.cpp \
  src/ymfm_pcm.cpp \
  src/ymfm_ssg.cpp \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
  -sENVIRONMENT=web,worker,shell \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORT_ALL=1 \
  -sEXPORTED_FUNCTIONS='["_ym2203_create","_ym2203_destroy","_ym2203_reset","_ym2203_write","_ym2203_read","_ym2203_read_status","_ym2203_get_irq","_ym2203_sample_rate","_ym2203_generate","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' \
  -o "$OUT_DIR/ym2203_wasm.js"
