#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -P -- "$(dirname "$0")/.." && pwd -P)
CHIP=${1:?Specify ym3438, ymf276 or ymf288}
case "$CHIP" in
  ym3438|ymf276) SSG_FLAG= ;;
  ymf288) SSG_FLAG=-DOPN_HAS_SSG ;;
  *) echo "Unsupported OPN variant: $CHIP" >&2; exit 1 ;;
esac
# Normal builds must use the authenticated SDK and produce its build receipt.
# The local comparison recipe below remains available with an explicit output.
if [ "$#" -eq 1 ]; then
  exec sh "$ROOT_DIR/scripts/build_${CHIP}_wasm.sh"
fi
OUT_DIR=$2
if [ -z "$OUT_DIR" ]; then
  echo "Specify a nonempty output directory for a local comparison build" >&2
  exit 1
fi
mkdir -p "$OUT_DIR"
OUT_DIR=$(CDPATH= cd -P -- "$OUT_DIR" && pwd -P)
case "$OUT_DIR" in
  "$ROOT_DIR/tetorica_src/runtime/generated"|"$ROOT_DIR/docs/generated")
    echo "Local comparison builds cannot overwrite published SDK artifacts; choose a separate output directory" >&2
    exit 1 ;;
esac
cd "$ROOT_DIR"
em++ -std=c++14 -O2 -Isrc -DOPN_VARIANT="$CHIP" $SSG_FLAG \
  tetorica_src/wasm/opn_variant_wasm.cpp src/ymfm_opn.cpp src/ymfm_adpcm.cpp src/ymfm_ssg.cpp \
  -sMODULARIZE=1 -sEXPORT_ES6=1 \
  -sINCOMING_MODULE_JS_API='["wasmBinary","locateFile"]' \
  -sENVIRONMENT=web,worker,node,shell -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS='["_opn_create","_opn_destroy","_opn_reset","_opn_write","_opn_read","_opn_read_status","_opn_get_irq","_opn_sample_rate","_opn_generate","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' \
  -o "$OUT_DIR/${CHIP}_wasm.js"
