#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"
OUT_DIR="${1:-$ROOT_DIR/dist/wasm}"

mkdir -p "$OUT_DIR"

# Keep runtime checks while optimizing the audio-thread synthesis hot path.
"${EMXX:-em++}" -std=c++14 -O2 -sASSERTIONS=1 \
  -Ivendor/ymfm \
  wasm/ym2612_wasm.cpp \
  vendor/ymfm/ymfm_adpcm.cpp \
  vendor/ymfm/ymfm_misc.cpp \
  vendor/ymfm/ymfm_opl.cpp \
  vendor/ymfm/ymfm_opm.cpp \
  vendor/ymfm/ymfm_opn.cpp \
  vendor/ymfm/ymfm_opq.cpp \
  vendor/ymfm/ymfm_opz.cpp \
  vendor/ymfm/ymfm_pcm.cpp \
  vendor/ymfm/ymfm_ssg.cpp \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
  -sENVIRONMENT=web,worker,node,shell \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORT_ALL=1 \
  -sEXPORTED_FUNCTIONS='["_ym2612_create","_ym2612_destroy","_ym2612_reset","_ym2612_write","_ym2612_read","_ym2612_read_status","_ym2612_get_irq","_ym2612_sample_rate","_ym2612_generate","_ym2612_generate_with_internal_envelope","_ym2612_save_state","_ym2612_load_state","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' \
  -o "$OUT_DIR/ym2612_wasm.js"
