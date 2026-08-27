#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"

mkdir -p "$OUT_DIR"

emcc -std=c11 \
  -Ithird_party/nuked-opn2 \
  wasm/nuked_opn2_wasm.c \
  third_party/nuked-opn2/ym3438.c \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
  -sENVIRONMENT=web,worker,shell,node \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORT_ALL=1 \
  -sEXPORTED_FUNCTIONS='["_ym2612_create","_ym2612_destroy","_ym2612_reset","_ym2612_write","_ym2612_read","_ym2612_read_status","_ym2612_get_irq","_ym2612_sample_rate","_ym2612_generate","_ym2612_generate_with_internal_envelope","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' \
  -o "$OUT_DIR/nuked_opn2_wasm.js"
