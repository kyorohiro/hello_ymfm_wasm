#!/bin/sh
# Build the exact licensed application-audio source in the fixed SDK snapshot.
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SDK_DIR="$ROOT_DIR/third_party/tetorica-soundchip-native"
OUT_DIR="${1:-$ROOT_DIR/web/generated}"
python3 "$ROOT_DIR/scripts/import_soundchip_sdk.py" --check
mkdir -p "$OUT_DIR"
OUT_DIR=$(CDPATH= cd -- "$OUT_DIR" && pwd)
exec sh "$SDK_DIR/scripts/build-wasm.sh" msm5205 "$OUT_DIR"
