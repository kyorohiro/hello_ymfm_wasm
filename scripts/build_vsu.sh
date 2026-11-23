#!/bin/sh
# SPDX-License-Identifier: BSD-3-Clause
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
WASM_DIR="${1:-$ROOT_DIR/docs/synth-vsu}"
EMXX="${EMXX:-em++}"
WASM_CXX="${WASM_CXX:-$("$EMXX" -print-prog-name=clang++)}"

mkdir -p "$WASM_DIR"
WASM_STAGE=$(mktemp -d "$WASM_DIR/.vsu-build.XXXXXX")
trap 'rm -rf "$WASM_STAGE"' EXIT

"$WASM_CXX" --target=wasm32-unknown-unknown "$ROOT_DIR/tetorica_src/native/vsu/vsu.cpp" \
  -std=c++17 -O2 -ffreestanding -fno-exceptions -fno-rtti -nostdlib \
  -Wl,--no-entry,--export-memory,--export=__heap_base \
  -Wl,--export=vsu_size,--export=vsu_reset,--export=vsu_write,--export=vsu_render \
  -o "$WASM_STAGE/vsu.wasm"

mv -f "$WASM_STAGE/vsu.wasm" "$WASM_DIR/vsu.wasm"
