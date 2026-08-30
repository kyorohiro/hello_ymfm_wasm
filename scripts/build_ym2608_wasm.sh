#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"

mkdir -p "$OUT_DIR"

em++ -std=c++14 \
  -Isrc \
  wasm/ym2608_wasm.cpp \
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
  -sEXPORTED_FUNCTIONS='["_ym2608_create","_ym2608_destroy","_ym2608_reset","_ym2608_write","_ym2608_read","_ym2608_read_status","_ym2608_read_status_hi","_ym2608_get_irq","_ym2608_sample_rate","_ym2608_load_adpcm_a_rom","_ym2608_generate","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32","HEAPU8"]' \
  -o "$OUT_DIR/ym2608_wasm.js"
