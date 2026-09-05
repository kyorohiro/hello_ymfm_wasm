#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
RELEASE_DIR="${ROOT_DIR}/release"
VERSION="${1:-dev}"
STAGE_DIR="${RELEASE_DIR}/itch_vgm_analyzer_${VERSION}"
ZIP_PATH="${RELEASE_DIR}/hello_ymfm_wasm_${VERSION}_itch_vgm_analyzer.zip"

ANALYZER_DIR="${ROOT_DIR}/docs/vgm_analyzer"
DOCS_JS_DIR="${ROOT_DIR}/docs/js"
DOCS_GENERATED_DIR="${ROOT_DIR}/docs/generated"
LICENSE_FILE="${ROOT_DIR}/LICENSE"

ANALYZER_FILES="
index.html
vgm_analyzer.js
vgm_mml.js
vgm_mml_music.js
"

JS_FILES="
genesisaudioengine.js
opn_fm_vgm.js
segapsg.js
tfi.js
vgm_file.js
vgm-output-worklet.js
vgmplayer.js
ym2203.js
ym2203audioengine.js
ym2608.js
ym2608audioengine.js
ym2612.js
ym2612vgm.js
"

GENERATED_FILES="
ym2203_wasm.js
ym2203_wasm.wasm
ym2608_wasm.js
ym2608_wasm.wasm
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

if [ ! -d "${ANALYZER_DIR}" ]; then
  echo "error: missing directory: ${ANALYZER_DIR}" >&2
  exit 1
fi

if [ ! -d "${DOCS_JS_DIR}" ]; then
  echo "error: missing directory: ${DOCS_JS_DIR}" >&2
  exit 1
fi

if [ ! -d "${DOCS_GENERATED_DIR}" ]; then
  echo "error: missing directory: ${DOCS_GENERATED_DIR}" >&2
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
mkdir -p "${STAGE_DIR}/js" "${STAGE_DIR}/generated" "${STAGE_DIR}/licenses/nuked-opn2"

for file in ${ANALYZER_FILES}; do
  src="${ANALYZER_DIR}/${file}"
  dst="${STAGE_DIR}/${file}"

  if [ ! -f "${src}" ]; then
    echo "error: missing analyzer file: ${src}" >&2
    exit 1
  fi

  cp "${src}" "${dst}"
done

for file in ${JS_FILES}; do
  src="${DOCS_JS_DIR}/${file}"
  dst="${STAGE_DIR}/js/${file}"

  if [ ! -f "${src}" ]; then
    echo "error: missing js file: ${src}" >&2
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

cp "${LICENSE_FILE}" "${STAGE_DIR}/LICENSE"

for file in ${NUKED_LICENSE_FILES}; do
  src="${NUKED_LICENSE_DIR}/${file}"
  dst="${STAGE_DIR}/licenses/nuked-opn2/${file}"

  if [ ! -f "${src}" ]; then
    echo "error: missing Nuked license file: ${src}" >&2
    exit 1
  fi

  cp "${src}" "${dst}"
done

cat > "${STAGE_DIR}/THIRD_PARTY_LICENSES.txt" <<EOF
This package includes two YM2612 engine options:

- Default engine: ymfm
  - Project: https://github.com/aaronsgiles/ymfm
  - License: BSD 3-Clause
  - Covered by: ./LICENSE

- Optional engine: Nuked-OPN2
  - Project: https://github.com/nukeykt/Nuked-OPN2
  - Vendored source in this repository: third_party/nuked-opn2/
  - License: GNU Lesser General Public License v2.1 or later (LGPL-2.1-or-later)
  - Included license files:
    - ./licenses/nuked-opn2/LICENSE
    - ./licenses/nuked-opn2/README.md

Use ?engine=nuked only if you want the optional Nuked-OPN2 backend.
EOF

# Make the analyzer runnable from itch.io as a standalone app.
perl -0pi -e 's#<a class="link-button" href="\.\./index\.html">Back</a>##g' "${STAGE_DIR}/index.html"
perl -0pi -e 's#"\.\./js/#"./js/#g; s#"\.\./generated/#"./generated/#g' \
  "${STAGE_DIR}/index.html" "${STAGE_DIR}/vgm_analyzer.js" "${STAGE_DIR}/vgm_mml.js"
perl -0pi -e 's#\.\./js/vgm-output-worklet\.js#./js/vgm-output-worklet.js#g' \
  "${STAGE_DIR}/index.html"

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
