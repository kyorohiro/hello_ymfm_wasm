#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
RELEASE_DIR="${ROOT_DIR}/release"
VERSION="${1:-dev}"
OUTPUT_NAME="hello_ymfm_wasm_${VERSION}_web_runtime.zip"
OUTPUT_PATH="${RELEASE_DIR}/${OUTPUT_NAME}"
STAGE_DIR="${RELEASE_DIR}/web_runtime_${VERSION}"

WEB_DIR="${ROOT_DIR}/web"
GENERATED_DIR="${ROOT_DIR}/docs/generated"
PLAYGROUND_SAMPLES_DIR="${ROOT_DIR}/docs/playground/samples"
LICENSE_FILE="${ROOT_DIR}/LICENSE"
RUNTIME_FILES="
bitcrusher-worklet.js
genesisaudioengine.js
looper.js
megadrive-fm-presets.js
megasynth_fx.js
megasynth.js
megasynth_looper.js
megasynth_recording.js
opn_fm_synth.js
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
ym2203.js
ym2203audioengine.js
ym2203synth.js
ym2203-worklet.js
ym2608.js
ym2608audioengine.js
ym2608synth.js
ym2608-worklet.js
vgm-output-worklet.js
vgm_runtime.js
vgmplayer.js
ym2612-worklet.js
ym2612-worklet-nuked.js
ym2612.js
ym2612synth.js
ym2612vgm.js
"

NUKED_LICENSE_DIR="${ROOT_DIR}/third_party/nuked-opn2"
NUKED_LICENSE_FILES="
LICENSE
README.md
"

if [ ! -d "${WEB_DIR}" ]; then
  echo "error: missing directory: ${WEB_DIR}" >&2
  exit 1
fi

if [ ! -d "${GENERATED_DIR}" ]; then
  echo "error: missing directory: ${GENERATED_DIR}" >&2
  exit 1
fi

if [ ! -d "${PLAYGROUND_SAMPLES_DIR}" ]; then
  echo "error: missing directory: ${PLAYGROUND_SAMPLES_DIR}" >&2
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

if [ ! -f "${GENERATED_DIR}/ym2612_wasm.js" ] || [ ! -f "${GENERATED_DIR}/ym2612_wasm.wasm" ]; then
  echo "error: YM2612 WASM files are missing in ${GENERATED_DIR}" >&2
  echo "hint: run sh scripts/build_ym2612_wasm.sh first" >&2
  exit 1
fi

if [ ! -f "${GENERATED_DIR}/segapsg_wasm.js" ] || [ ! -f "${GENERATED_DIR}/segapsg_wasm.wasm" ]; then
  echo "error: Sega PSG WASM files are missing in ${GENERATED_DIR}" >&2
  echo "hint: run sh scripts/build_segapsg_wasm.sh first" >&2
  exit 1
fi

if [ ! -f "${GENERATED_DIR}/ym2203_wasm.js" ] || [ ! -f "${GENERATED_DIR}/ym2203_wasm.wasm" ] || [ ! -f "${GENERATED_DIR}/ym2608_wasm.js" ] || [ ! -f "${GENERATED_DIR}/ym2608_wasm.wasm" ]; then
  echo "error: YM2203/YM2608 WASM files are missing in ${GENERATED_DIR}" >&2
  echo "hint: run sh scripts/build_ym2203_wasm.sh and sh scripts/build_ym2608_wasm.sh first" >&2
  exit 1
fi

if [ ! -f "${GENERATED_DIR}/nuked_opn2_wasm.js" ] || [ ! -f "${GENERATED_DIR}/nuked_opn2_wasm.wasm" ]; then
  echo "error: Nuked-OPN2 WASM files are missing in ${GENERATED_DIR}" >&2
  echo "hint: run sh scripts/build_nuked_opn2_wasm.sh first" >&2
  exit 1
fi

mkdir -p "${RELEASE_DIR}"
rm -rf "${STAGE_DIR}"
rm -f "${OUTPUT_PATH}"
mkdir -p "${STAGE_DIR}/generated" "${STAGE_DIR}/samples" "${STAGE_DIR}/licenses/nuked-opn2"

(
  for file in ${RUNTIME_FILES}; do
    src="${WEB_DIR}/${file}"
    dst="${STAGE_DIR}/${file}"

    if [ ! -f "${src}" ]; then
      echo "error: missing runtime file: ${src}" >&2
      exit 1
    fi

    cp "${src}" "${dst}"
  done

  cp "${GENERATED_DIR}/ym2612_wasm.js" "${STAGE_DIR}/generated/ym2612_wasm.js"
  cp "${GENERATED_DIR}/ym2612_wasm.wasm" "${STAGE_DIR}/generated/ym2612_wasm.wasm"
  cp "${GENERATED_DIR}/nuked_opn2_wasm.js" "${STAGE_DIR}/generated/nuked_opn2_wasm.js"
  cp "${GENERATED_DIR}/nuked_opn2_wasm.wasm" "${STAGE_DIR}/generated/nuked_opn2_wasm.wasm"
  cp "${GENERATED_DIR}/segapsg_wasm.js" "${STAGE_DIR}/generated/segapsg_wasm.js"
  cp "${GENERATED_DIR}/segapsg_wasm.wasm" "${STAGE_DIR}/generated/segapsg_wasm.wasm"
  cp "${GENERATED_DIR}/ym2203_wasm.js" "${STAGE_DIR}/generated/ym2203_wasm.js"
  cp "${GENERATED_DIR}/ym2203_wasm.wasm" "${STAGE_DIR}/generated/ym2203_wasm.wasm"
  cp "${GENERATED_DIR}/ym2608_wasm.js" "${STAGE_DIR}/generated/ym2608_wasm.js"
  cp "${GENERATED_DIR}/ym2608_wasm.wasm" "${STAGE_DIR}/generated/ym2608_wasm.wasm"
  cp -R "${PLAYGROUND_SAMPLES_DIR}/." "${STAGE_DIR}/samples/"
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

  cd "${STAGE_DIR}"
  zip -r "${OUTPUT_PATH}" .
)

echo "created: ${OUTPUT_PATH}"
echo "created stage: ${STAGE_DIR}"
