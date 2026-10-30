#!/bin/sh
# Build only the authenticated fixed SDK snapshot, never the development checkout.
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"
python3 "$ROOT_DIR/scripts/import_soundchip_sdk.py" --check
sh "$ROOT_DIR/third_party/tetorica-soundchip-native/scripts/build-wasm.sh" scsp "$OUT_DIR"
