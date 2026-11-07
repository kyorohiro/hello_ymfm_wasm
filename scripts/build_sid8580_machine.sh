#!/bin/sh
# SPDX-License-Identifier: BSD-3-Clause
# Two coupled research WASM modules; no production asset or SDK sync.
set -eu
SID8M_ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SID8M_OUT="${1:-$SID8M_ROOT/build/sid8580-machine}"
SID8M_RUSTC="${RUSTC:-rustc}"
SID8M_CC="${CC:-clang}"
SID8M_CXX="${CXX:-clang++}"
SID8M_EMCC="${EMCC:-emcc}"
SID8M_EMXX="${EMXX:-em++}"
node "$SID8M_ROOT/scripts/prepare_sid8580_machine_core.mjs"
mkdir -p "$SID8M_OUT"
SID8M_OUT=$(CDPATH= cd -- "$SID8M_OUT" && pwd)
"$SID8M_RUSTC" --edition=2021 -C opt-level=3 -C panic=abort -C codegen-units=1 --remap-path-prefix "$SID8M_ROOT=tetorica" \
  --crate-name sidera --crate-type rlib "$SID8M_ROOT/third_party/sidera/adapted/src/lib.rs" -o "$SID8M_OUT/libsidera.rlib"
"$SID8M_RUSTC" --edition=2021 -C opt-level=3 -C panic=abort -C codegen-units=1 --remap-path-prefix "$SID8M_ROOT=tetorica" \
  --crate-name sid8580_endpoint --crate-type staticlib "$SID8M_ROOT/tetorica_src/wasm/sid8580-machine/endpoint.rs" \
  --extern "sidera=$SID8M_OUT/libsidera.rlib" -o "$SID8M_OUT/libsid8580_endpoint.a"
"$SID8M_RUSTC" --edition=2021 -C opt-level=3 -C panic=abort -C codegen-units=1 --remap-path-prefix "$SID8M_ROOT=tetorica" \
  --target wasm32-unknown-unknown --crate-name sidera --crate-type rlib "$SID8M_ROOT/third_party/sidera/adapted/src/lib.rs" -o "$SID8M_OUT/libsidera-wasm.rlib"
"$SID8M_RUSTC" --edition=2021 -C opt-level=3 -C panic=abort -C codegen-units=1 --remap-path-prefix "$SID8M_ROOT=tetorica" \
  --target wasm32-unknown-unknown --crate-name sid8580_endpoint --crate-type cdylib "$SID8M_ROOT/tetorica_src/wasm/sid8580-machine/endpoint.rs" \
  --extern "sidera=$SID8M_OUT/libsidera-wasm.rlib" -o "$SID8M_OUT/sid8580-endpoint.wasm"
"$SID8M_CC" -std=c11 -O2 -DNDEBUG -ffp-contract=off -ffile-prefix-map="$SID8M_ROOT=tetorica" \
  -c "$SID8M_ROOT/tetorica_src/wasm/sid8580-machine/machine.c" -o "$SID8M_OUT/machine.o"
case "$(uname -s)" in
  # Rust's prebuilt std objects carry Mach-O N_OSO archive paths. Strip only
  # native debug metadata so relocating the same source kit is reproducible.
  Darwin) SID8M_LIBS="-liconv -Wl,-S" ;;
  *) SID8M_LIBS="-ldl -lpthread -lm -lrt -lutil" ;;
esac
# The small platform link-flag list is intentional word splitting, not a path.
# shellcheck disable=SC2086
"$SID8M_CXX" -std=c++17 -O2 -DNDEBUG -ffp-contract=off -ffile-prefix-map="$SID8M_ROOT=tetorica" \
  "$SID8M_ROOT/tetorica_src/wasm/sid8580-machine/machine_native.cpp" \
  "$SID8M_ROOT/tetorica_src/wasm/sid8580-machine/sid_endpoint.cpp" "$SID8M_OUT/machine.o" \
  "$SID8M_OUT/libsid8580_endpoint.a" $SID8M_LIBS -o "$SID8M_OUT/sid8580-machine"
"$SID8M_EMCC" -std=c11 -O2 -DNDEBUG -ffp-contract=off -ffile-prefix-map="$SID8M_ROOT=tetorica" \
  -c "$SID8M_ROOT/tetorica_src/wasm/sid8580-machine/machine.c" -o "$SID8M_OUT/machine-wasm.o"
"$SID8M_EMXX" -std=c++17 -O2 -DNDEBUG -ffp-contract=off -ffile-prefix-map="$SID8M_ROOT=tetorica" \
  "$SID8M_ROOT/tetorica_src/wasm/sid8580-machine/machine_wasm.cpp" \
  "$SID8M_ROOT/tetorica_src/wasm/sid8580-machine/sid_endpoint.cpp" "$SID8M_OUT/machine-wasm.o" \
  -s STANDALONE_WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=4194304 -s MAXIMUM_MEMORY=67108864 \
  -s STACK_SIZE=65536 -s ERROR_ON_UNDEFINED_SYMBOLS=0 --no-entry -o "$SID8M_OUT/sid8580-machine.wasm"
node "$SID8M_ROOT/scripts/sid8580_machine_artifacts.mjs" --record "$SID8M_OUT"
