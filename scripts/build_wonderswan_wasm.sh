#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SDK_DIR="$ROOT_DIR/third_party/tetorica-soundchip-native"
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"

python3 "$ROOT_DIR/scripts/import_soundchip_sdk.py" --check
mkdir -p "$OUT_DIR"
OUT_DIR=$(CDPATH= cd -- "$OUT_DIR" && pwd)

# Preserve the existing raw registers, wave RAM and synchronous stereo PCM ABI.
# Use only the checked release snapshot, without a network or sibling checkout.
exec sh "$SDK_DIR/scripts/build-wasm.sh" wonderswan "$OUT_DIR"
