#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"
exec sh "$ROOT_DIR/scripts/build_opn_variant_wasm.sh" ymf288 "${1:-$ROOT_DIR/dist/wasm}"
