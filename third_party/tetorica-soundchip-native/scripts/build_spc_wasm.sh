#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"
OUT_DIR="${1:-$ROOT_DIR/dist/wasm}"
mkdir -p "$OUT_DIR"
cd "$ROOT_DIR"
# Accurate DSP, fixed native 32 kHz. No optional fast DSP, filter or bundled IPL ROM.
"${EMXX:-em++}" -std=c++14 -O2 -sASSERTIONS=1 \
  -Ivendor/snes-spc/snes_spc \
  wasm/spc_wasm.cpp \
  vendor/snes-spc/snes_spc/SNES_SPC.cpp \
  vendor/snes-spc/snes_spc/SNES_SPC_misc.cpp \
  vendor/snes-spc/snes_spc/SNES_SPC_state.cpp \
  vendor/snes-spc/snes_spc/SPC_DSP.cpp \
  -sMODULARIZE=1 -sEXPORT_ES6=1 \
  -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
  -sENVIRONMENT=web,worker,node,shell -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS='["_spc_create","_spc_destroy","_spc_error","_spc_load","_spc_restart","_spc_render","_spc_left_ptr","_spc_right_ptr","_spc_native_frames","_spc_set_mute_mask","_spc_snapshot_ptr","_spc_load_ram","_spc_write_dsp","_spc_read_dsp","_spc_trace_begin","_spc_trace_finish","_spc_trace_initial_ptr","_spc_trace_events_ptr","_spc_trace_event_count","_spc_ram_read_begin","_spc_ram_read_finish","_spc_ram_read_mask_ptr","_spc_observer_begin","_spc_observer_stop","_spc_observer_ptr","_spc_observer_drain","_spc_observer_lost","_spc_observer_registers_ptr","_spc_load_timeline","_spc_restart_timeline","_spc_timeline_total_frames","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["HEAPU8","HEAPF32","UTF8ToString"]' \
  -o "$OUT_DIR/spc_wasm.js"
perl -pi -e 's/[ \t]+$//' "$OUT_DIR/spc_wasm.js"
