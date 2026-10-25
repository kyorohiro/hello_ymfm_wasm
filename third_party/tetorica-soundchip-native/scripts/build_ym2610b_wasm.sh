#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"
OUT_DIR="${1:-$ROOT_DIR/dist/wasm}"

mkdir -p "$OUT_DIR"

# Keep runtime checks while optimizing the audio-thread synthesis hot path.
"${EMXX:-em++}" -std=c++14 -O2 -sASSERTIONS=1 \
  -Ivendor/ymfm \
  wasm/ym2610b_wasm.cpp \
  vendor/ymfm/ymfm_adpcm.cpp vendor/ymfm/ymfm_misc.cpp vendor/ymfm/ymfm_opl.cpp vendor/ymfm/ymfm_opm.cpp \
  vendor/ymfm/ymfm_opn.cpp vendor/ymfm/ymfm_opq.cpp vendor/ymfm/ymfm_opz.cpp vendor/ymfm/ymfm_pcm.cpp vendor/ymfm/ymfm_ssg.cpp \
  -sMODULARIZE=1 -sEXPORT_ES6=1 \
  -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
  -sENVIRONMENT=web,worker,node,shell -sALLOW_MEMORY_GROWTH=1 -sEXPORT_ALL=1 \
  -sEXPORTED_FUNCTIONS='["_ym2610b_create","_ym2610b_create_variant","_ym2610b_load_rom","_ym2610b_clear_roms","_ym2610b_set_source_mute_mask","_ym2610b_destroy","_ym2610b_reset","_ym2610b_write","_ym2610b_read","_ym2610b_read_status","_ym2610b_read_status_hi","_ym2610b_get_irq","_ym2610b_sample_rate","_ym2610b_generate","_ym2610b_save_state","_ym2610b_load_state","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32","HEAPU8"]' \
  -o "$OUT_DIR/ym2610b_wasm.js"

# Keep generated glue free of whitespace-only diff noise.
perl -pi -e 's/[ \t]+$//' "$OUT_DIR/ym2610b_wasm.js"
