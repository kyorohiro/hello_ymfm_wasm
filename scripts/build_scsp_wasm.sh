#!/bin/sh
# Build only the authenticated fixed SDK snapshot, never the development checkout.
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/tetorica_src/runtime/generated}"
python3 "$ROOT_DIR/scripts/import_soundchip_sdk.py" --check
mkdir -p "$OUT_DIR"
OUT_DIR=$(CDPATH= cd -- "$OUT_DIR" && pwd)
sh "$ROOT_DIR/third_party/tetorica-soundchip-native/scripts/build-wasm.sh" scsp "$OUT_DIR"

# Publish only normal builds; explicit output directories stay isolated.
if [ "$#" -eq 0 ]; then
  node "$ROOT_DIR/scripts/sync_runtime_artifacts.mjs" --only scsp
fi
