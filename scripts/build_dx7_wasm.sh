#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SDK_DIR="$ROOT_DIR/third_party/tetorica-soundchip-native"
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"

python3 "$ROOT_DIR/scripts/import_soundchip_sdk.py" --check
mkdir -p "$OUT_DIR"
OUT_DIR=$(CDPATH= cd -- "$OUT_DIR" && pwd)

sh "$SDK_DIR/scripts/build-wasm.sh" dx7 "$OUT_DIR"

# Default builds refresh both existing runtime locations from one SDK output.
# Custom output directories stay isolated for comparisons and downstream builds.
if [ "$#" -eq 0 ]; then
  mkdir -p "$ROOT_DIR/web/msfa_dx7/wasm" "$ROOT_DIR/docs/js/msfa_dx7/wasm"
  cp "$OUT_DIR/msfa.wasm" "$ROOT_DIR/web/msfa_dx7/wasm/msfa.wasm"
  cp "$OUT_DIR/msfa.wasm" "$ROOT_DIR/docs/js/msfa_dx7/wasm/msfa.wasm"
fi
