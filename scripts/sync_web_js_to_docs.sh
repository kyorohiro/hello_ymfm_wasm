#!/bin/sh

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
WEB_DIR="${ROOT_DIR}/web"
DOCS_JS_DIR="${ROOT_DIR}/docs/js"

# Copy only the browser-side runtime files that are intended to stay shared
# between `web/` and `docs/js/`.
#
SYNC_FILES="
bitcrusher-worklet.js
genesisaudioengine.js
looper.js
megasynth.js
megasynth_fx.js
megasynth_looper.js
megasynth_recording.js
megadrive-fm-presets.js
pitch.js
playground_runtime.js
playground_clock.js
playground_execution.js
playground_live.js
playground_music.js
playground_noise.js
playground_sync.js
segapsg.js
stereo-width-worklet.js
tfi.js
vgm_file.js
vgm-output-worklet.js
vgmplayer.js
vgm_runtime.js
ym2203.js
ym2203audioengine.js
ym2608.js
ym2608audioengine.js
ym2612-worklet.js
ym2612-worklet-nuked.js
ym2612.js
ym2612synth.js
ym2612vgm.js
"

mkdir -p "${DOCS_JS_DIR}"

for file in ${SYNC_FILES}; do
  src="${WEB_DIR}/${file}"
  dst="${DOCS_JS_DIR}/${file}"

  if [ ! -f "${src}" ]; then
    echo "missing source: ${src}" >&2
    exit 1
  fi

  cp "${src}" "${dst}"
  echo "synced ${file}"
done

perl -0pi -e 's#"\./generated/ym2612_wasm\.js"#"../generated/ym2612_wasm.js"#g' \
  "${DOCS_JS_DIR}/ym2612-worklet.js"

perl -0pi -e 's#"\./generated/segapsg_wasm\.js"#"../generated/segapsg_wasm.js"#g' \
  "${DOCS_JS_DIR}/ym2612-worklet.js"

perl -0pi -e 's#"\./generated/ym2612_wasm\.js"#"../generated/ym2612_wasm.js"#g' \
  "${DOCS_JS_DIR}/vgm_runtime.js"

perl -0pi -e 's#"\./generated/segapsg_wasm\.js"#"../generated/segapsg_wasm.js"#g' \
  "${DOCS_JS_DIR}/vgm_runtime.js"

perl -0pi -e 's#"\./generated/nuked_opn2_wasm\.js"#"../generated/nuked_opn2_wasm.js"#g' \
  "${DOCS_JS_DIR}/ym2612-worklet-nuked.js"

perl -0pi -e 's#"\./generated/segapsg_wasm\.js"#"../generated/segapsg_wasm.js"#g' \
  "${DOCS_JS_DIR}/ym2612-worklet-nuked.js"

perl -0pi -e 's#"\./generated/ym2612_wasm\.js"#"../generated/ym2612_wasm.js"#g' \
  "${DOCS_JS_DIR}/bitcrusher-worklet.js"

echo "done: synced shared web runtime files into docs/js"
