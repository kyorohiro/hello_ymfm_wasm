#!/bin/sh
# SPDX-License-Identifier: BSD-3-Clause
# Copyright (c) 2026 kyorohiro
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/dist/wasm}"
mkdir -p "$OUT_DIR"
OUT_DIR=$(CDPATH= cd -- "$OUT_DIR" && pwd)
"${EMXX:-em++}" -std=c++17 -O2 -DNDEBUG -fwrapv -fno-strict-aliasing -ffp-contract=off \
  "$ROOT_DIR/vendor/mame-scsp/scsp_instrument.cpp" \
  "$ROOT_DIR/vendor/mame-scsp/scsp.cpp" "$ROOT_DIR/vendor/mame-scsp/scspdsp.cpp" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=16777216 -sSTACK_SIZE=1048576 -sFILESYSTEM=0 \
  -sEXPORTED_FUNCTIONS='["_scsp_create","_scsp_destroy","_scsp_reset","_scsp_sample_rate","_scsp_write","_scsp_read","_scsp_load_ram","_scsp_read_ram","_scsp_render","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPU8","HEAPF32"]' \
  -o "$OUT_DIR/scsp_wasm.js"
