#!/bin/sh
# SPDX-License-Identifier: BSD-3-Clause
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
CORE="$ROOT_DIR/tetorica_src/native/sm510/sm510.cpp"
WASM_DIR="${1:-$ROOT_DIR/docs/synth-lcd-buzzer}"
NATIVE_DIR="${2:-}"
EMXX="${EMXX:-em++}"
WASM_CXX="${WASM_CXX:-$("$EMXX" -print-prog-name=clang++)}"
CXX="${CXX:-c++}"
AR="${AR:-ar}"

mkdir -p "$WASM_DIR"
WASM_STAGE=$(mktemp -d "$WASM_DIR/.sm510-build.XXXXXX")
trap 'rm -rf "$WASM_STAGE"' EXIT
"$WASM_CXX" --target=wasm32-unknown-unknown "$CORE" \
  -std=c++17 -O2 -ffreestanding -fno-exceptions -fno-rtti -nostdlib \
  -Wl,--no-entry,--export-memory,--export=__heap_base,--export=sm510_output_pins,--export=sm510_render_r1 \
  -Wl,--export=sm510_direct_half_cycles,--export=sm510_render_direct_note,--export=sm510_render_direct_r1 \
  -o "$WASM_STAGE/sm510.wasm"

if [ -n "$NATIVE_DIR" ]; then
  mkdir -p "$NATIVE_DIR"
  "$CXX" "$CORE" -std=c++17 -O2 -c -o "$WASM_STAGE/sm510.o"
  "$AR" rcs "$WASM_STAGE/libsm510.a" "$WASM_STAGE/sm510.o"
  mv -f "$WASM_STAGE/libsm510.a" "$NATIVE_DIR/libsm510.a"
fi

mv -f "$WASM_STAGE/sm510.wasm" "$WASM_DIR/sm510.wasm"
