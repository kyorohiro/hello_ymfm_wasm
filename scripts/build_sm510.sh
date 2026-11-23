#!/bin/sh
# SPDX-License-Identifier: BSD-3-Clause
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
CORE="$ROOT_DIR/tetorica_src/native/sm510"
WASM_DIR="${1:-$ROOT_DIR/docs/synth-lcd-buzzer}"
NATIVE_DIR="${2:-}"
EMXX="${EMXX:-em++}"
WASM_CXX="${WASM_CXX:-$("$EMXX" -print-prog-name=clang++)}"
CXX="${CXX:-c++}"
AR="${AR:-ar}"

mkdir -p "$WASM_DIR"
WASM_STAGE=$(mktemp -d "$WASM_DIR/.sm510-build.XXXXXX")
trap 'rm -rf "$WASM_STAGE"' EXIT
"$WASM_CXX" --target=wasm32-unknown-unknown "$CORE/sm510.cpp" "$CORE/sm511.cpp" \
  -std=c++17 -O2 -ffreestanding -fno-exceptions -fno-rtti -nostdlib \
  -Wl,--no-entry,--export-memory,--export=__heap_base,--export=sm510_output_pins,--export=sm510_render_r1 \
  -Wl,--export=sm510_direct_half_cycles,--export=sm510_direct_high_cycles \
  -Wl,--export=sm510_render_direct_note,--export=sm510_render_direct_r1 \
  -Wl,--export=sm511_pitch_hz,--export=sm511_render_tone,--export=sm511_render_melody \
  -Wl,--export=sm511_controller_size,--export=sm511_controller_reset,--export=sm511_controller_load \
  -Wl,--export=sm511_controller_apply,--export=sm511_controller_state,--export=sm511_controller_render \
  -o "$WASM_STAGE/sm510.wasm"

if [ -n "$NATIVE_DIR" ]; then
  mkdir -p "$NATIVE_DIR"
  for chip in sm510 sm511; do
    "$CXX" "$CORE/$chip.cpp" -std=c++17 -O2 -c -o "$WASM_STAGE/$chip.o"
  done
  "$AR" rcs "$WASM_STAGE/libsm510.a" "$WASM_STAGE/sm510.o" "$WASM_STAGE/sm511.o"
  mv -f "$WASM_STAGE/libsm510.a" "$NATIVE_DIR/libsm510.a"
fi

mv -f "$WASM_STAGE/sm510.wasm" "$WASM_DIR/sm510.wasm"
