#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SDK_DIR="$ROOT_DIR/third_party/tetorica-soundchip-native"
OUT_DIR="${1:-$ROOT_DIR/web/generated}"

python3 "$ROOT_DIR/scripts/import_soundchip_sdk.py" --check
mkdir -p "$OUT_DIR"
OUT_DIR=$(CDPATH= cd -- "$OUT_DIR" && pwd)

# Keep the existing NES/FDS register, PCM and applied-state observation ABI
# while building the checked, bundled SDK sources without a network dependency.
sh "$SDK_DIR/scripts/build-wasm.sh" nesapu "$OUT_DIR"

# Publish only normal builds; explicit output directories stay isolated.
if [ "$#" -eq 0 ]; then
  node "$ROOT_DIR/scripts/sync_runtime_artifacts.mjs" --only nesapu
fi
