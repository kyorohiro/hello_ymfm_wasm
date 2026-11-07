#!/bin/sh
# SPDX-License-Identifier: BSD-3-Clause
# Independent research build: no Cargo resolution, optional player or SDK writes.
set -eu
SID8_ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SID8_OUT="${1:-$SID8_ROOT/build/sid8580-probe}"
SID8_RUSTC="${RUSTC:-rustc}"
SID8_CC="${CC:-clang}"
SID8_WASM_CC=$(node "$SID8_ROOT/scripts/sid8580_probe_artifacts.mjs" --wasm-cc)
mkdir -p "$SID8_OUT"
SID8_OUT=$(CDPATH= cd -- "$SID8_OUT" && pwd)
node "$SID8_ROOT/scripts/sid8580_probe_artifacts.mjs" --sources
mkdir -p "$SID8_OUT/wasm-include"
cat > "$SID8_OUT/wasm-include/string.h" <<'SID8_HEADER'
#ifndef TETORICA_CPU_FREESTANDING_STRING_H
#define TETORICA_CPU_FREESTANDING_STRING_H
#include <stddef.h>
void *memset(void *destination, int value, size_t size);
#endif
SID8_HEADER
"$SID8_CC" -std=c11 -O2 -ffreestanding -ffile-prefix-map="$SID8_ROOT=tetorica" \
  -c "$SID8_ROOT/tetorica_src/wasm/sid8580-probe/cpu_bridge.c" -o "$SID8_OUT/cpu_bridge.o"
"$SID8_WASM_CC" --target=wasm32-unknown-unknown -std=c11 -O2 -ffreestanding \
  -ffile-prefix-map="$SID8_ROOT=tetorica" -I "$SID8_OUT/wasm-include" \
  -c "$SID8_ROOT/tetorica_src/wasm/sid8580-probe/cpu_bridge.c" -o "$SID8_OUT/cpu_bridge_wasm.o"
"$SID8_RUSTC" --edition=2021 -C opt-level=3 -C panic=abort -C codegen-units=1 --remap-path-prefix "$SID8_ROOT=tetorica" \
  --crate-name sidera --crate-type rlib "$SID8_ROOT/third_party/sidera/adapted/src/lib.rs" \
  -o "$SID8_OUT/libsidera.rlib"
"$SID8_RUSTC" --edition=2021 -C opt-level=3 -C panic=abort -C codegen-units=1 --remap-path-prefix "$SID8_ROOT=tetorica" \
  "$SID8_ROOT/tetorica_src/wasm/sid8580-probe/native.rs" \
  --extern "sidera=$SID8_OUT/libsidera.rlib" -o "$SID8_OUT/sid8580-probe"
"$SID8_RUSTC" --edition=2021 -C opt-level=3 -C panic=abort -C codegen-units=1 --remap-path-prefix "$SID8_ROOT=tetorica" \
  --target wasm32-unknown-unknown --crate-name sidera --crate-type rlib \
  "$SID8_ROOT/third_party/sidera/adapted/src/lib.rs" -o "$SID8_OUT/libsidera-wasm.rlib"
"$SID8_RUSTC" --edition=2021 -C opt-level=3 -C panic=abort -C codegen-units=1 --remap-path-prefix "$SID8_ROOT=tetorica" \
  --target wasm32-unknown-unknown --crate-name sid8580_probe --crate-type cdylib \
  "$SID8_ROOT/tetorica_src/wasm/sid8580-probe/lib.rs" \
  --extern "sidera=$SID8_OUT/libsidera-wasm.rlib" -o "$SID8_OUT/sid8580-probe.wasm"
"$SID8_RUSTC" --edition=2021 -C opt-level=3 -C panic=abort -C codegen-units=1 --remap-path-prefix "$SID8_ROOT=tetorica" \
  "$SID8_ROOT/tetorica_src/wasm/sid8580-probe/cpu_native.rs" \
  --extern "sidera=$SID8_OUT/libsidera.rlib" -C "link-arg=$SID8_OUT/cpu_bridge.o" -o "$SID8_OUT/sid8580-cpu"
"$SID8_RUSTC" --edition=2021 -C opt-level=3 -C panic=abort -C codegen-units=1 --remap-path-prefix "$SID8_ROOT=tetorica" \
  --target wasm32-unknown-unknown --crate-name sid8580_cpu --crate-type cdylib \
  "$SID8_ROOT/tetorica_src/wasm/sid8580-probe/cpu.rs" \
  --extern "sidera=$SID8_OUT/libsidera-wasm.rlib" -C "link-arg=$SID8_OUT/cpu_bridge_wasm.o" -o "$SID8_OUT/sid8580-cpu.wasm"
node "$SID8_ROOT/scripts/sid8580_probe_artifacts.mjs" --record "$SID8_OUT"
