#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"
OUT_DIR="${1:-$ROOT_DIR/dist/wasm}"

mkdir -p "$OUT_DIR"

# Keep runtime checks while optimizing the audio-thread synthesis hot path.
"${EMXX:-em++}" -std=c++14 -O2 -sASSERTIONS=1 \
  -Ivendor/ymfm \
  wasm/ym2608_wasm.cpp \
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
  -sEXPORTED_FUNCTIONS='["_ym2608_create","_ym2608_destroy","_ym2608_reset","_ym2608_write","_ym2608_read","_ym2608_read_status","_ym2608_read_status_hi","_ym2608_get_irq","_ym2608_sample_rate","_ym2608_load_adpcm_a_rom","_ym2608_load_adpcm_b_memory","_ym2608_clear_adpcm_b_memory","_ym2608_generate","_ym2608_set_source_mute_mask","_ym2608_save_state","_ym2608_load_state","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32","HEAPU8"]' \
  -o "$OUT_DIR/ym2608_wasm.js"
