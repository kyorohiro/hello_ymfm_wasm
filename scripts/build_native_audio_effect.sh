#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/docs/native_audio_effect}"
mkdir -p "$OUT_DIR"
emcc "$ROOT_DIR/native/audio_effect/gain.c" "$ROOT_DIR/native/audio_effect/reverb.c" -O2 -sSTANDALONE_WASM=1 \
  -Wl,--export=reverb_reset -Wl,--export=reverb_set -Wl,--export=reverb_clear \
  --no-entry -Wl,--export-memory \
  -Wl,--export=gain_input -Wl,--export=gain_output \
  -Wl,--export=gain_capacity -Wl,--export=gain_reset \
  -Wl,--export=eq_reset -Wl,--export=eq_set \
  -Wl,--export=gain_set -Wl,--export=gain_process \
  -o "$OUT_DIR/gain.wasm"
