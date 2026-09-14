#!/bin/sh
# No audio device, WASM build, npm dependencies or network access required.
set -eu
cd "$(dirname "$0")/.."
node --test web/vgm-parser-mock.test.mjs web/vgm-player-mock.test.mjs \
  web/vgm-delivery.test.mjs web/dac-stream.test.mjs web/dac-warning.test.mjs \
  web/vgmplayer.test.mjs web/pwm.test.mjs \
  docs/vgm_analyzer/playback_warnings.test.mjs docs/vgm_analyzer/note_timeline.test.mjs
