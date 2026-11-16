#!/bin/sh
# SPDX-License-Identifier: BSD-3-Clause
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SOURCE_DIR="$ROOT_DIR/third_party/atari-audio/src"
OUT_DIR="${1:-$ROOT_DIR/docs/generated/atari-audio-player}"
node "$ROOT_DIR/scripts/atari_audio_player_artifacts.mjs" --check-source
mkdir -p "$OUT_DIR"
EMXX="${EMXX:-em++}"
"$EMXX" "$ROOT_DIR/tetorica_src/wasm/atari_audio_player_wasm.cpp" \
  "$SOURCE_DIR/AtariAudioRenderer.cpp" "$SOURCE_DIR/AtariMachine.cpp" \
  "$SOURCE_DIR/Blitter.cpp" "$SOURCE_DIR/Mk68901.cpp" "$SOURCE_DIR/SndhRenderer.cpp" \
  "$SOURCE_DIR/SteDac.cpp" "$SOURCE_DIR/timedb.cpp" "$SOURCE_DIR/ym2149c.cpp" \
  "$SOURCE_DIR/YmRenderer.cpp" "$SOURCE_DIR/external/ice_24.cpp" \
  "$SOURCE_DIR/external/lzh.cpp" "$SOURCE_DIR/external/Musashi/m68k.cpp" \
  "$SOURCE_DIR/external/Musashi/m68kcpu.cpp" "$SOURCE_DIR/external/Musashi/m68kops.cpp" \
  -std=c++17 -O2 -DNDEBUG -ffp-contract=off \
  -s STANDALONE_WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=16777216 \
  -s MAXIMUM_MEMORY=67108864 -s STACK_SIZE=262144 -s FILESYSTEM=0 \
  --no-entry -o "$OUT_DIR/atari-audio-player.wasm"
node "$ROOT_DIR/scripts/atari_audio_player_artifacts.mjs" --record "$OUT_DIR"
