#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"

mkdir -p "$OUT_DIR"

em++ -std=c++14 \
  -Isrc \
  wasm/ym2413_wasm.cpp \
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
  -sENVIRONMENT=web,worker,node,shell \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORT_ALL=1 \
  -sEXPORTED_FUNCTIONS='["_ym2413_create","_ym2413_destroy","_ym2413_reset","_ym2413_write","_ym2413_read","_ym2413_read_status","_ym2413_get_irq","_ym2413_sample_rate","_ym2413_generate","_ym2413_set_mute_mask","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' \
  -o "$OUT_DIR/ym2413_wasm.js"
