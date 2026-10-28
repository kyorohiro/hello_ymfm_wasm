#!/bin/sh
# Standalone instrument API; compile the included BSD-3-Clause sources only.
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/dist/wasm}"
mkdir -p "$OUT_DIR"
OUT_DIR=$(CDPATH= cd -- "$OUT_DIR" && pwd)
"${EMXX:-em++}" -std=c++17 -O2 -DNDEBUG -fwrapv -fno-strict-aliasing -ffp-contract=off -fexceptions \
  -I"$ROOT_DIR/native/ps1" \
  "$ROOT_DIR/native/ps1/ps1_spu.cpp" "$ROOT_DIR/native/ps1/spu.cpp" \
  "$ROOT_DIR/native/ps1/spu_tables.cpp" "$ROOT_DIR/native/ps1/spureverb.cpp" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=268435456 \
  -sSTACK_SIZE=1048576 -sFILESYSTEM=0 \
  -sINCOMING_MODULE_JS_API='["wasmBinary","locateFile","instantiateWasm","print","printErr","onAbort","preRun","postRun","onRuntimeInitialized","setStatus","arguments","thisProgram","noExitRuntime","wasmMemory","onExit"]' \
  -sEXPORTED_FUNCTIONS='["_ps1_spu_create","_ps1_spu_destroy","_ps1_spu_reset","_ps1_spu_sample_rate","_ps1_spu_write","_ps1_spu_read","_ps1_spu_load_ram","_ps1_spu_read_ram","_ps1_spu_render","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPU8","HEAPF32"]' \
  -o "$OUT_DIR/ps1_spu_wasm.js"
