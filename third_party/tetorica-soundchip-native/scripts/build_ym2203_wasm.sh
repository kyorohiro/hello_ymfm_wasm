#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"
OUT_DIR="${1:-$ROOT_DIR/dist/wasm}"

mkdir -p "$OUT_DIR"

# Keep runtime checks while optimizing the audio-thread synthesis hot path.
"${EMXX:-em++}" -std=c++14 -O2 -sASSERTIONS=1 \
  -Ivendor/ymfm \
  wasm/ym2203_wasm.cpp \
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
  -sEXPORTED_FUNCTIONS='["_ym2203_create","_ym2203_destroy","_ym2203_reset","_ym2203_write","_ym2203_read","_ym2203_read_status","_ym2203_get_irq","_ym2203_sample_rate","_ym2203_generate","_ym2203_set_mute_mask","_ym2203_set_source_mute_mask","_ym2203_save_state","_ym2203_load_state","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' \
  -o "$OUT_DIR/ym2203_wasm.js"

# Keep generated glue free of whitespace-only diff noise.
perl -pi -e 's/[ \t]+$//' "$OUT_DIR/ym2203_wasm.js"
