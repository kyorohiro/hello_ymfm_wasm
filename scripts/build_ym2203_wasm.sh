#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SDK_DIR="$ROOT_DIR/third_party/tetorica-soundchip-native"
OUT_DIR="${1:-$ROOT_DIR/web/generated}"

python3 "$ROOT_DIR/scripts/import_soundchip_sdk.py" --check
mkdir -p "$OUT_DIR"
OUT_DIR=$(CDPATH= cd -- "$OUT_DIR" && pwd)

# Compile the immutable local recipe, including its glue normalization, and
# record compiler/input/output hashes without changing the synchronous ABI.
sh "$SDK_DIR/scripts/build-wasm.sh" ym2203 "$OUT_DIR"

# Publish only normal builds; explicit output directories stay isolated.
if [ "$#" -eq 0 ]; then
  node "$ROOT_DIR/scripts/sync_runtime_artifacts.mjs" --only ym2203
fi
