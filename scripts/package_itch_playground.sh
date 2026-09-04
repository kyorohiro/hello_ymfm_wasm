#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
RELEASE_DIR="${ROOT_DIR}/release"
VERSION="${1:-dev}"
STAGE_DIR="${RELEASE_DIR}/itch_playground_${VERSION}"
ZIP_PATH="${RELEASE_DIR}/hello_ymfm_wasm_${VERSION}_itch_playground.zip"

PLAYGROUND_DIR="${ROOT_DIR}/docs/playground"
PLAYGROUND_VENDOR_DIR="${PLAYGROUND_DIR}/vendor"
DOCS_JS_DIR="${ROOT_DIR}/docs/js"
DOCS_SYNTH_DIR="${ROOT_DIR}/docs/synth"
DOCS_GENERATED_DIR="${ROOT_DIR}/docs/generated"
PLAYGROUND_SAMPLES_DIR="${ROOT_DIR}/docs/playground/samples"
LICENSE_FILE="${ROOT_DIR}/LICENSE"

PLAYGROUND_FILES="
index.html
playground.js
playground_cassette.js
playground_examples.js
playground_monaco.js
playground_monaco_completion.js
playground_operator_tab.js
playground_query.js
playground_sync.js
playground_ui.js
tetorica-playground-globals.d.ts
"

RUNTIME_FILES="
bitcrusher-worklet.js
looper.js
megasynth.js
megasynth_fx.js
megasynth_looper.js
megasynth_recording.js
megadrive-fm-presets.js
opn_fm_synth.js
opn_runtime_synth.js
opn_fm_vgm.js
pitch.js
playground_clock.js
playground_execution.js
playground_live.js
playground_logic_worker.js
playground_music.js
playground_noise.js
playground_runtime.js
playground_sync.js
segapsg.js
segapsg_api.js
stereo-width-worklet.js
tfi.js
tetorica_audio_runtime.js
tetorica_synth.js
ym2203.js
ym2203audioengine.js
ym2203synth.js
ym2203-worklet.js
ym2608.js
ym2608audioengine.js
ym2608synth.js
ym2608-worklet.js
vgm_file.js
ym2612vgm.js
ym2203vgm.js
ym2608vgm.js
ym2612-worklet.js
ym2612-worklet-nuked.js
ym2612.js
ym2612synth.js
"

SYNTH_SUPPORT_FILES="
synth_controls.js
synth_keyboard.js
"

GENERATED_FILES="
ym2612_wasm.js
ym2612_wasm.wasm
nuked_opn2_wasm.js
nuked_opn2_wasm.wasm
segapsg_wasm.js
segapsg_wasm.wasm
"

NUKED_LICENSE_DIR="${ROOT_DIR}/third_party/nuked-opn2"
NUKED_LICENSE_FILES="
LICENSE
README.md
"

if [ ! -d "${PLAYGROUND_DIR}" ]; then
  echo "error: missing directory: ${PLAYGROUND_DIR}" >&2
  exit 1
fi

if [ ! -d "${DOCS_JS_DIR}" ]; then
  echo "error: missing directory: ${DOCS_JS_DIR}" >&2
  exit 1
fi

if [ ! -d "${DOCS_SYNTH_DIR}" ]; then
  echo "error: missing directory: ${DOCS_SYNTH_DIR}" >&2
  exit 1
fi

if [ ! -d "${DOCS_GENERATED_DIR}" ]; then
  echo "error: missing directory: ${DOCS_GENERATED_DIR}" >&2
  exit 1
fi

if [ ! -d "${PLAYGROUND_SAMPLES_DIR}" ]; then
  echo "error: missing directory: ${PLAYGROUND_SAMPLES_DIR}" >&2
  exit 1
fi

if [ ! -d "${PLAYGROUND_VENDOR_DIR}" ]; then
  echo "error: missing directory: ${PLAYGROUND_VENDOR_DIR}" >&2
  exit 1
fi

if [ ! -f "${LICENSE_FILE}" ]; then
  echo "error: missing file: ${LICENSE_FILE}" >&2
  exit 1
fi

if [ ! -d "${NUKED_LICENSE_DIR}" ]; then
  echo "error: missing directory: ${NUKED_LICENSE_DIR}" >&2
  exit 1
fi

mkdir -p "${RELEASE_DIR}"
rm -rf "${STAGE_DIR}"
rm -f "${ZIP_PATH}"
mkdir -p "${STAGE_DIR}/js" "${STAGE_DIR}/synth" "${STAGE_DIR}/generated" "${STAGE_DIR}/samples" "${STAGE_DIR}/vendor" "${STAGE_DIR}/licenses/nuked-opn2"

for file in ${PLAYGROUND_FILES}; do
  src="${PLAYGROUND_DIR}/${file}"
  dst="${STAGE_DIR}/${file}"

  if [ ! -f "${src}" ]; then
    echo "error: missing playground file: ${src}" >&2
    exit 1
  fi

  cp "${src}" "${dst}"
done

for file in ${RUNTIME_FILES}; do
  src="${DOCS_JS_DIR}/${file}"
  dst="${STAGE_DIR}/js/${file}"

  if [ ! -f "${src}" ]; then
    echo "error: missing runtime file: ${src}" >&2
    exit 1
  fi

  cp "${src}" "${dst}"
done

for file in ${SYNTH_SUPPORT_FILES}; do
  src="${DOCS_SYNTH_DIR}/${file}"
  dst="${STAGE_DIR}/synth/${file}"

  if [ ! -f "${src}" ]; then
    echo "error: missing synth support file: ${src}" >&2
    exit 1
  fi

  cp "${src}" "${dst}"
done

for file in ${GENERATED_FILES}; do
  src="${DOCS_GENERATED_DIR}/${file}"
  dst="${STAGE_DIR}/generated/${file}"

  if [ ! -f "${src}" ]; then
    echo "error: missing generated file: ${src}" >&2
    exit 1
  fi

  cp "${src}" "${dst}"
done

for chip in ym2203 ym2608; do
  if [ -f "${DOCS_GENERATED_DIR}/${chip}_wasm.js" ] && [ -f "${DOCS_GENERATED_DIR}/${chip}_wasm.wasm" ]; then
    cp "${DOCS_GENERATED_DIR}/${chip}_wasm.js" "${STAGE_DIR}/generated/${chip}_wasm.js"
    cp "${DOCS_GENERATED_DIR}/${chip}_wasm.wasm" "${STAGE_DIR}/generated/${chip}_wasm.wasm"
  fi
done

cp -R "${PLAYGROUND_SAMPLES_DIR}/." "${STAGE_DIR}/samples/"
cp -R "${PLAYGROUND_VENDOR_DIR}/." "${STAGE_DIR}/vendor/"

cp "${LICENSE_FILE}" "${STAGE_DIR}/LICENSE"

for file in ${NUKED_LICENSE_FILES}; do
  cp "${NUKED_LICENSE_DIR}/${file}" "${STAGE_DIR}/licenses/nuked-opn2/${file}"
done

cat > "${STAGE_DIR}/THIRD_PARTY_LICENSES.txt" <<EOF
This package includes two YM2612 engine options:

- Default engine: ymfm
  - Project: https://github.com/aaronsgiles/ymfm
  - License: BSD 3-Clause
  - Covered by: ./LICENSE

- Optional engine: Nuked-OPN2
  - Project: https://github.com/nukeykt/Nuked-OPN2
  - License: GNU Lesser General Public License v2.1 or later (LGPL-2.1-or-later)
  - Included license files:
    - ./licenses/nuked-opn2/LICENSE
    - ./licenses/nuked-opn2/README.md
EOF

# Make the playground runnable from itch.io as a standalone app.
perl -0pi -e 's#<a class="link-button" href="\.\./index\.html">Back</a>##g' \
  "${STAGE_DIR}/index.html"
perl -0pi -e 's#"\./playground\.js"#"./playground.js"#g; s#"\.\./js/#"./js/#g; s#"\.\./synth/#"./synth/#g; s#"\.\./generated/#"./generated/#g' \
  "${STAGE_DIR}/index.html" \
  "${STAGE_DIR}/playground.js" \
  "${STAGE_DIR}/playground_monaco.js" \
  "${STAGE_DIR}/playground_monaco_completion.js" \
  "${STAGE_DIR}/playground_sync.js" \
  "${STAGE_DIR}/playground_operator_tab.js" \
  "${STAGE_DIR}/playground_query.js" \
  "${STAGE_DIR}/playground_examples.js" \
  "${STAGE_DIR}/playground_ui.js"

(
  cd "${STAGE_DIR}"
  zip -r "${ZIP_PATH}" .
)

echo "created stage: ${STAGE_DIR}"
echo "created zip: ${ZIP_PATH}"
echo "itch.io upload:"
echo "  1. Create/Edit project"
echo "  2. Set Kind of project to HTML"
echo "  3. Upload ${ZIP_PATH}"
echo "  4. Ensure index.html is the entry file"
