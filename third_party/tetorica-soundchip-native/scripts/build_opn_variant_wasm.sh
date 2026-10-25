#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"
CHIP=${1:?Specify ym3438, ymf276 or ymf288}
OUT_DIR=${2:-$ROOT_DIR/dist/wasm}
case "$CHIP" in
  ym3438|ymf276) SSG_FLAG= ;;
  ymf288) SSG_FLAG=-DOPN_HAS_SSG ;;
  *) echo "Unsupported OPN variant: $CHIP" >&2; exit 1 ;;
esac
mkdir -p "$OUT_DIR"
cd "$ROOT_DIR"
"${EMXX:-em++}" -std=c++14 -O2 -Ivendor/ymfm -DOPN_VARIANT="$CHIP" $SSG_FLAG \
  wasm/opn_variant_wasm.cpp vendor/ymfm/ymfm_opn.cpp vendor/ymfm/ymfm_adpcm.cpp vendor/ymfm/ymfm_ssg.cpp \
  -sMODULARIZE=1 -sEXPORT_ES6=1 \
  -sINCOMING_MODULE_JS_API='["wasmBinary","locateFile"]' \
  -sENVIRONMENT=web,worker,node,shell -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS='["_opn_create","_opn_destroy","_opn_reset","_opn_write","_opn_read","_opn_read_status","_opn_get_irq","_opn_sample_rate","_opn_generate","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' \
  -o "$OUT_DIR/${CHIP}_wasm.js"
