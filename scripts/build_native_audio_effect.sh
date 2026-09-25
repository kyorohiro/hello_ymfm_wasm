#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/docs/native_audio_effect}"
mkdir -p "$OUT_DIR"
emcc "$ROOT_DIR/native/audio_effect/gain.c" "$ROOT_DIR/native/audio_effect/reverb.c" "$ROOT_DIR/native/audio_effect/compressor.c" "$ROOT_DIR/native/audio_effect/noise_gate.c" "$ROOT_DIR/native/audio_effect/eq.c" "$ROOT_DIR/native/audio_effect/graph.c" "$ROOT_DIR/native/audio_effect/extra_fx.c" -O2 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sSTANDALONE_WASM=1 \
  -Wl,--export=reverb_reset -Wl,--export=reverb_set -Wl,--export=reverb_clear \
  -Wl,--export=compressor_reset -Wl,--export=compressor_set -Wl,--export=compressor_clear \
  -Wl,--export=gate_reset -Wl,--export=gate_set -Wl,--export=gate_clear \
  -Wl,--export=graph_begin -Wl,--export=graph_add -Wl,--export=graph_append -Wl,--export=graph_commit -Wl,--export=graph_reset -Wl,--export=graph_clear -Wl,--export=graph_process -Wl,--export=gain_select -Wl,--export=eq_select -Wl,--export=gate_select -Wl,--export=compressor_select -Wl,--export=reverb_select \
  -Wl,--export=extra_reset_slot -Wl,--export=extra_set -Wl,--export=extra_prepare \
  --no-entry -Wl,--export-memory \
  -Wl,--export=gain_input -Wl,--export=gain_output \
  -Wl,--export=gain_capacity -Wl,--export=gain_reset \
  -Wl,--export=eq_reset -Wl,--export=eq_set \
  -Wl,--export=gain_set -Wl,--export=gain_process \
  -o "$OUT_DIR/gain.wasm"

# Shared Playground artifact; keep the lab and shipped runtime on the same DSP.
cp "$OUT_DIR/gain.wasm" "$ROOT_DIR/web/native_audio_effect.wasm"
cp "$OUT_DIR/gain.wasm" "$ROOT_DIR/docs/js/native_audio_effect.wasm"
