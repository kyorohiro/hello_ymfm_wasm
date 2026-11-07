#!/bin/sh
# Separate full-device PAL RSID host. Existing PSID/SID/SDK assets stay untouched.
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
python3 "$ROOT_DIR/scripts/prepare_sid_core.py" --check
OUT_DIR="${1:-$ROOT_DIR/tetorica_src/runtime/generated/sid-rsid}"
mkdir -p "$OUT_DIR"
BUILD_DIR=$(mktemp -d "${TMPDIR:-/tmp}/tetorica-rsid-build-XXXXXX")
trap 'rm -rf "$BUILD_DIR"' EXIT HUP INT TERM
emcc "$ROOT_DIR/tetorica_src/wasm/sid_rsid_machine.c" -std=c11 -O2 -DNDEBUG -ffp-contract=off -c -o "$BUILD_DIR/machine.o"
em++ "$ROOT_DIR/tetorica_src/wasm/sid_rsid_wasm.cpp" "$ROOT_DIR/tetorica_src/wasm/sid_rsid_chip.cpp" "$BUILD_DIR/machine.o" \
  -std=c++17 -O2 -DNDEBUG -ffp-contract=off \
  -s STANDALONE_WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=4194304 \
  -s MAXIMUM_MEMORY=67108864 -s STACK_SIZE=65536 --no-entry -o "$OUT_DIR/sid-rsid.wasm"
node "$ROOT_DIR/scripts/sid_rsid_artifacts.mjs" --record "$OUT_DIR"
if [ "$#" -eq 0 ]; then node "$ROOT_DIR/scripts/sid_rsid_artifacts.mjs" --sync; fi
