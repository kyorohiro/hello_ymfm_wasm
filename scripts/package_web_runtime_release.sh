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
LICENSE_FILE="${ROOT_DIR}/LICENSE"
RUNTIME_FILES="
genesisaudioengine.js
looper.js
megadrive-fm-presets.js
megasynth_fx.js
megasynth.js
megasynth_recording.js
segapsg.js
tfi.js
vgmplayer.js
ym2612-worklet.js
ym2612.js
ym2612synth.js
ym2612vgm.js
"

if [ ! -d "${WEB_DIR}" ]; then
  echo "error: missing directory: ${WEB_DIR}" >&2
  exit 1
fi

if [ ! -d "${GENERATED_DIR}" ]; then
  echo "error: missing directory: ${GENERATED_DIR}" >&2
  exit 1
fi

if [ ! -f "${LICENSE_FILE}" ]; then
  echo "error: missing file: ${LICENSE_FILE}" >&2
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

mkdir -p "${RELEASE_DIR}"
rm -rf "${STAGE_DIR}"
rm -f "${OUTPUT_PATH}"
mkdir -p "${STAGE_DIR}/generated"

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
  cp "${GENERATED_DIR}/segapsg_wasm.js" "${STAGE_DIR}/generated/segapsg_wasm.js"
  cp "${GENERATED_DIR}/segapsg_wasm.wasm" "${STAGE_DIR}/generated/segapsg_wasm.wasm"
  cp "${LICENSE_FILE}" "${STAGE_DIR}/LICENSE"

  cd "${STAGE_DIR}"
  zip -r "${OUTPUT_PATH}" .
)

echo "created: ${OUTPUT_PATH}"
echo "created stage: ${STAGE_DIR}"
