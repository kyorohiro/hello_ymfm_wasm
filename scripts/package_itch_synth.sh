#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
RELEASE_DIR="${ROOT_DIR}/release"
VERSION="${1:-dev}"
STAGE_DIR="${RELEASE_DIR}/itch_synth_${VERSION}"
ZIP_PATH="${RELEASE_DIR}/hello_ymfm_wasm_${VERSION}_itch_synth.zip"

SOURCE_HTML="${ROOT_DIR}/docs/synth/index.html"
SOURCE_JS="${ROOT_DIR}/docs/synth/synth.js"
SOURCE_JS_DIR="${ROOT_DIR}/docs/js"
SOURCE_GENERATED_DIR="${ROOT_DIR}/docs/generated"
LICENSE_FILE="${ROOT_DIR}/LICENSE"
SYNTH_SUPPORT_DIR="${ROOT_DIR}/docs/synth"
SYNTH_FILES="
synth.js
synth_controls.js
synth_envelope.js
synth_input.js
synth_keyboard.js
synth_runtime.js
"
RUNTIME_FILES="
bitcrusher-worklet.js
looper.js
megasynth.js
megasynth_fx.js
megasynth_recording.js
megadrive-fm-presets.js
pitch.js
segapsg.js
segapsg_api.js
stereo-width-worklet.js
tfi.js
ym2612.js
ym2612synth.js
ym2612-worklet.js
ym2612-worklet-nuked.js
"

NUKED_LICENSE_DIR="${ROOT_DIR}/third_party/nuked-opn2"
NUKED_LICENSE_FILES="
LICENSE
README.md
"

if [ ! -f "${SOURCE_HTML}" ]; then
  echo "error: missing file: ${SOURCE_HTML}" >&2
  exit 1
fi

if [ ! -f "${SOURCE_JS}" ]; then
  echo "error: missing file: ${SOURCE_JS}" >&2
  exit 1
fi

if [ ! -d "${SOURCE_JS_DIR}" ]; then
  echo "error: missing directory: ${SOURCE_JS_DIR}" >&2
  exit 1
fi

if [ ! -d "${SOURCE_GENERATED_DIR}" ]; then
  echo "error: missing directory: ${SOURCE_GENERATED_DIR}" >&2
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

if [ ! -f "${SOURCE_GENERATED_DIR}/ym2612_wasm.js" ] || [ ! -f "${SOURCE_GENERATED_DIR}/ym2612_wasm.wasm" ]; then
  echo "error: YM2612 WASM files are missing in ${SOURCE_GENERATED_DIR}" >&2
  echo "hint: run sh scripts/build_ym2612_wasm.sh first" >&2
  exit 1
fi

if [ ! -f "${SOURCE_GENERATED_DIR}/nuked_opn2_wasm.js" ] || [ ! -f "${SOURCE_GENERATED_DIR}/nuked_opn2_wasm.wasm" ]; then
  echo "error: Nuked-OPN2 WASM files are missing in ${SOURCE_GENERATED_DIR}" >&2
  echo "hint: run sh scripts/build_nuked_opn2_wasm.sh first" >&2
  exit 1
fi

if [ ! -f "${SOURCE_GENERATED_DIR}/segapsg_wasm.js" ] || [ ! -f "${SOURCE_GENERATED_DIR}/segapsg_wasm.wasm" ]; then
  echo "error: Sega PSG WASM files are missing in ${SOURCE_GENERATED_DIR}" >&2
  echo "hint: run sh scripts/build_segapsg_wasm.sh first" >&2
  exit 1
fi

mkdir -p "${RELEASE_DIR}"
rm -rf "${STAGE_DIR}"
rm -f "${ZIP_PATH}"
mkdir -p "${STAGE_DIR}/js" "${STAGE_DIR}/generated" "${STAGE_DIR}/licenses/nuked-opn2"

cp "${SOURCE_HTML}" "${STAGE_DIR}/index.html"

for file in ${SYNTH_FILES}; do
  src="${SYNTH_SUPPORT_DIR}/${file}"
  dst="${STAGE_DIR}/${file}"

  if [ ! -f "${src}" ]; then
    echo "error: missing synth file: ${src}" >&2
    exit 1
  fi

  cp "${src}" "${dst}"
done

for file in ${RUNTIME_FILES}; do
  src="${SOURCE_JS_DIR}/${file}"
  dst="${STAGE_DIR}/js/${file}"

  if [ ! -f "${src}" ]; then
    echo "error: missing runtime file: ${src}" >&2
    exit 1
  fi

  cp "${src}" "${dst}"
done

cp "${SOURCE_GENERATED_DIR}/ym2612_wasm.js" "${STAGE_DIR}/generated/ym2612_wasm.js"
cp "${SOURCE_GENERATED_DIR}/ym2612_wasm.wasm" "${STAGE_DIR}/generated/ym2612_wasm.wasm"
cp "${SOURCE_GENERATED_DIR}/nuked_opn2_wasm.js" "${STAGE_DIR}/generated/nuked_opn2_wasm.js"
cp "${SOURCE_GENERATED_DIR}/nuked_opn2_wasm.wasm" "${STAGE_DIR}/generated/nuked_opn2_wasm.wasm"
cp "${SOURCE_GENERATED_DIR}/segapsg_wasm.js" "${STAGE_DIR}/generated/segapsg_wasm.js"
cp "${SOURCE_GENERATED_DIR}/segapsg_wasm.wasm" "${STAGE_DIR}/generated/segapsg_wasm.wasm"
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

perl -0pi -e 's#import "\\./synth\\.js";#import "./synth.js";#g' "${STAGE_DIR}/index.html"
perl -0pi -e 's#\.\./js/([A-Za-z0-9._-]+\.js)#./js/$1#g; s#\.\./generated/#./generated/#g' "${STAGE_DIR}/synth.js"
perl -0pi -e 's#\.\./js/([A-Za-z0-9._-]+\.js)#./js/$1#g' "${STAGE_DIR}/synth_keyboard.js" "${STAGE_DIR}/synth_runtime.js"
perl -0pi -e 's#\.\./js/megasynth\.js#./js/megasynth.js#g#' "${STAGE_DIR}/synth_runtime.js"
perl -0pi -e 's#\./ym2612-worklet\.js#./js/ym2612-worklet.js#g; s#\./generated/ym2612_wasm\.wasm#./generated/ym2612_wasm.wasm#g' "${STAGE_DIR}/js/megasynth.js"
perl -0pi -e 's#import ym2612ModuleFactory from "\\.\\./generated/ym2612_wasm\\.js";#import ym2612ModuleFactory from "../generated/ym2612_wasm.js";#g' "${STAGE_DIR}/js/ym2612-worklet.js"
perl -0pi -e 's#import ym2612ModuleFactory from "\\.\\./generated/nuked_opn2_wasm\\.js";#import ym2612ModuleFactory from "../generated/nuked_opn2_wasm.js";#g' "${STAGE_DIR}/js/ym2612-worklet-nuked.js"

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
