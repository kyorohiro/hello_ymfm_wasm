#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"
OUT_DIR="${1:-$ROOT_DIR/dist/wasm}"
mkdir -p "$OUT_DIR"
"${EMXX:-em++}" -std=c++17 -O2 -DMSFA_FORCE_SCALAR -fwrapv -fno-strict-aliasing -ffp-contract=off \
  -Ivendor/msfa -Iwasm/dx7 wasm/dx7/dx7.cc \
  vendor/msfa/dx7note.cc vendor/msfa/env.cc vendor/msfa/exp2.cc vendor/msfa/fm_core.cc \
  vendor/msfa/fm_op_kernel.cc vendor/msfa/freqlut.cc vendor/msfa/lfo.cc vendor/msfa/patch.cc \
  vendor/msfa/pitchenv.cc vendor/msfa/resofilter.cc vendor/msfa/ringbuffer.cc vendor/msfa/sin.cc vendor/msfa/synth_unit.cc \
  --no-entry -sSTANDALONE_WASM=1 -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=0 \
  -sINITIAL_MEMORY=16777216 -sSTACK_SIZE=1048576 -sSUPPORT_LONGJMP=0 -sDISABLE_EXCEPTION_CATCHING=1 \
  -sEXPORTED_FUNCTIONS='["_dx7_create","_dx7_destroy","_dx7_voice_ptr","_dx7_set_voice","_dx7_output_ptr","_dx7_select_voice","_dx7_edit_voice","_dx7_note_on","_dx7_note_off","_dx7_all_notes_off","_dx7_panic","_dx7_render"]' \
  -o "$OUT_DIR/msfa.wasm"
