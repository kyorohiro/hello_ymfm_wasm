#!/bin/sh
# Application-local SID prototype; do not modify the authenticated fixed SDK.
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
python3 "$ROOT_DIR/scripts/prepare_sid_core.py" --check
OUT_DIR="${1:-$ROOT_DIR/tetorica_src/runtime/generated/sid}"
mkdir -p "$OUT_DIR"
em++ "$ROOT_DIR/tetorica_src/wasm/sid_wasm.cpp" -std=c++17 -O2 -DNDEBUG -ffp-contract=off \
  -s STANDALONE_WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=2097152 \
  -s STACK_SIZE=65536 --no-entry -o "$OUT_DIR/sid.wasm"
node "$ROOT_DIR/scripts/sid_artifacts.mjs" --record "$OUT_DIR"
if [ "$#" -eq 0 ]; then
  node "$ROOT_DIR/scripts/sid_artifacts.mjs" --sync
fi
