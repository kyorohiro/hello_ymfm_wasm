#!/bin/sh
# No audio device, WASM build, npm dependencies or network access required.
set -eu
cd "$(dirname "$0")/.."
node --test test/runtime/vgm-parser-mock.test.mjs test/runtime/vgm-player-mock.test.mjs \
  test/runtime/segapcm-skip.test.mjs test/runtime/psg-stream.test.mjs test/runtime/vgm-compression.test.mjs test/runtime/vgm-delivery.test.mjs test/runtime/dac-stream.test.mjs test/runtime/dac-warning.test.mjs \
  test/runtime/vgmplayer.test.mjs test/runtime/pwm.test.mjs \
  docs/vgm_analyzer/playback_warnings.test.mjs docs/vgm_analyzer/note_timeline.test.mjs
