#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
VERSION="${1:-dev}"
RELEASE_DIR="${ROOT_DIR}/release"
OUTPUT_PATH="${RELEASE_DIR}/hello_ymfm_wasm_${VERSION}_web_runtime.zip"
STAGE_DIR="${RELEASE_DIR}/web_runtime_${VERSION}"
mkdir -p "${RELEASE_DIR}"
rm -rf "${STAGE_DIR}"
rm -f "${OUTPUT_PATH}"
mkdir -p "${STAGE_DIR}/samples"
node "${ROOT_DIR}/scripts/copy_full_web_runtime.mjs" "${STAGE_DIR}"
cp -R "${ROOT_DIR}/docs/playground/samples/." "${STAGE_DIR}/samples/"
cp "${ROOT_DIR}/LICENSE" "${STAGE_DIR}/LICENSE"
node "${ROOT_DIR}/scripts/check_analyzer_package.mjs" "${STAGE_DIR}"
node "${ROOT_DIR}/scripts/check_web_runtime.mjs" "${STAGE_DIR}"
(cd "${STAGE_DIR}" && zip -r "${OUTPUT_PATH}" .)
echo "created: ${OUTPUT_PATH}"
echo "created stage: ${STAGE_DIR}"
