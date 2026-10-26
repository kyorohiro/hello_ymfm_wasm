#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SDK_DIR="$ROOT_DIR/third_party/tetorica-soundchip-native"
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"

python3 "$ROOT_DIR/scripts/import_soundchip_sdk.py" --check
mkdir -p "$OUT_DIR"
OUT_DIR=$(CDPATH= cd -- "$OUT_DIR" && pwd)

# Keep the existing HuC6280 register, mute and synchronous PCM ABI
# while building the checked, bundled SDK sources without a network dependency.
exec sh "$SDK_DIR/scripts/build-wasm.sh" huc6280 "$OUT_DIR"
