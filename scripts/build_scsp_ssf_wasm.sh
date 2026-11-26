#!/bin/sh
# SPDX-License-Identifier: BSD-3-Clause
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
BOARD="$ROOT_DIR/tetorica_src/native/scsp_ssf"
SCSP="$ROOT_DIR/third_party/tetorica-soundchip-native/vendor/mame-scsp"
MUSASHI="$ROOT_DIR/third_party/atari-audio/src/external/Musashi"
OUT_DIR="${1:-$ROOT_DIR/docs/generated/scsp-ssf}"
EMXX="${EMXX:-em++}"

node "$ROOT_DIR/scripts/scsp_ssf_artifacts.mjs" --check-source
mkdir -p "$OUT_DIR"
STAGE_DIR=$(mktemp -d "$OUT_DIR/.scsp-ssf-build.XXXXXX")
trap 'rm -rf "$STAGE_DIR"' EXIT
"$EMXX" "$BOARD/scsp_ssf.cpp" \
  "$SCSP/scsp_instrument.cpp" "$SCSP/scsp.cpp" "$SCSP/scspdsp.cpp" \
  "$MUSASHI/m68k.cpp" "$MUSASHI/m68kcpu.cpp" "$MUSASHI/m68kops.cpp" \
  -I "$BOARD" -I "$SCSP" -I "$MUSASHI" \
  -std=c++17 -O2 -DNDEBUG -fwrapv -fno-strict-aliasing -ffp-contract=off \
  -s STANDALONE_WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=16777216 \
  -s MAXIMUM_MEMORY=67108864 -s STACK_SIZE=262144 -s FILESYSTEM=0 \
  -s 'EXPORTED_FUNCTIONS=["_malloc","_free","_scsp_ssf_create","_scsp_ssf_destroy","_scsp_ssf_set_mute","_scsp_ssf_render","_scsp_ssf_fault_address"]' \
  --no-entry -o "$STAGE_DIR/scsp-ssf.wasm"
compiler=$("$EMXX" --version | sed -n '1p')
node "$ROOT_DIR/scripts/scsp_ssf_artifacts.mjs" --record "$STAGE_DIR" "$compiler"
mv -f "$STAGE_DIR/scsp-ssf.wasm" "$STAGE_DIR/scsp-ssf-build.json" "$STAGE_DIR/scsp-ssf-notices.txt" "$OUT_DIR"
