#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
node "${ROOT_DIR}/scripts/runtime_artifact_profiles.mjs" synth --check
RELEASE_DIR="${ROOT_DIR}/release"
VERSION="${1:-dev}"
STAGE_DIR="${RELEASE_DIR}/itch_synth_${VERSION}"
ZIP_PATH="${RELEASE_DIR}/hello_ymfm_wasm_${VERSION}_itch_synth.zip"

SOURCE_HTML="${ROOT_DIR}/docs/synth/index.html"
SOURCE_JS="${ROOT_DIR}/docs/synth/synth.js"
SOURCE_JS_DIR="${ROOT_DIR}/docs/js"
LICENSE_FILE="${ROOT_DIR}/LICENSE"
SYNTH_SUPPORT_DIR="${ROOT_DIR}/docs/synth"
SYNTH_FILES="
CODE.md
synth.js
synth_code_controls.js
synth_code_project.js
synth_code_audio.js
synth_fm_mute.js
synth_fm_worklet.js
synth_fm_worklet_nuked.js
synth_pcm_mute.js
synth_code_output.js
synth_code_declarations.js
synth_controls.js
synth_envelope.js
synth_operator_envelope.js
synth_input.js
synth_keyboard.js
synth_runtime.js
synth_preset_import.js
synth_menu.js
synth_output_visualizer.js
synth_modulation.js
synth_pitch_bend.js
synth_project.js
synth_files.js
synth_recovery.js
synth_song_controls.js
synth_psg.js
synth_psg_audio.js
synth_psg_controls.js
synth_psg_preset.js
synth_psg_envelope.js
synth_psg_worklet.js
synth_psg_recording.js
synth_psg_recording_player.js
synth_psg_loop_render.js
synth_psg_loop_player.js
synth_psg_looper.js
synth_layer_looper.js
synth_audio_loop_player.js
synth_pcm.js
synth_pcm_audio.js
synth_pcm_worklet.js
synth_pcm_release.js
synth_pcm_controls.js
synth_pcm_wave_edit.js
synth_pcm_recording.js
synth_pcm_recording_prepare.js
synth_pcm_recording_player.js
synth_pcm_recording_audio.js
synth_pcm_recording_worklet.js
synth_pcm_looper.js
synth_pcm_loop_render.js
synth_pcm_loop_player.js
synth_pcm_loop_audio.js
synth_pcm_loop_worklet.js
synth_song_seek_controls.js
synth_song_preview.js
synth_song_state.js
synth_song_psg_state.js
synth_song_psg_voice.js
synth_song_pcm_state.js
synth_song_pcm_voice.js
synth_song_voice.js
synth_song_copy.js
synth_song_mix.js
synth_song_mix_defaults.js
synth_song_mix_controls.js
synth_song_output_mix.js
synth_live_highlight.js
synth_performance.js
synth_recording.js
synth_looper.js
"
RUNTIME_FILES="
playground_code_runtime.js
playground_clock.js
playground_live.js
playground_music.js
playground_async_tasks.js
playground_execution.js
playground_log.js
playground_duration.js
pwm32x.js
pwm32x_wasm.js
pwm32x_playback.js
playground_pwm_audio.js
playground_pwm_worklet.js
vgm_file.js
vgmplayer.js
genesisaudioengine.js
s98_file.js
ym2612vgm.js
opn_fm_vgm.js
bitcrusher-worklet.js
looper.js
megasynth.js
soundchip_mixer.js
soundchip_mixer_presets.js
playground_audio_endpoint.js
playground_chip_inspector_state.js
playground_native_voice_inspector.js
playground_opn_inspector.js
playground_keyboard_channels.js
playground_gameboy.js
gameboysynth.js
gameboyapu.js
ym2610bsynth.js
ym2610b.js
nesapusynth.js
chip_worklet_transport.js
audio_decode.js
soundchip_pitch.js
playground_chip_clock.js
nesapu.js
nesapu_wasm.js
nesapuaudioengine.js
fds_audio.js
rf5c164.js
rf5c164synth.js
rf5c164_notes.js
rf5c164_pcm.js
playground_rf5c164.js
playground_rf5c164_audio.js
rf5c164-worklet.js
megasynth_fx.js
playground_chip_port.js
playground_performance_queue.js
playground_performance_processor.js
playground_audition_guard.js
playground_worker_chip.js
playground_worker_dac.js
native_fx.js
native_noise.js
native_sample.js
native_sample_processor.js
native_fx_rack.js
native_fx_graph.js
native_fx_engine.js
native-fx-worklet.js
custom_fx.js
megasynth_recording.js
megasynth_looper.js
megasynth-fm-presets.js
opn_fm_synth.js
opn_runtime_synth.js
pitch.js
segapsg.js
segapsg_api.js
playground_segapsg_audio.js
playground_segapsg_worklet.js
segapsgsynth.js
stereo-width-worklet.js
tfi.js
vgi.js
tetorica_audio_runtime.js
ym2203.js
ym2203audioengine.js
ym2203synth.js
ssgsynth.js
ym2203-worklet.js
ym2608.js
ym2608audioengine.js
ym2608synth.js
adpcm_b_sample.js
ym2608-worklet.js
ym2612.js
ym2612_dac.js
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

cp "${SOURCE_HTML}" "${STAGE_DIR}/index.html"
mkdir -p "${STAGE_DIR}/playground"
mkdir -p "${STAGE_DIR}/playground/vendor"
mkdir -p "${STAGE_DIR}/js/tetorica_virtual_files"
mkdir -p "${STAGE_DIR}/vgm_analyzer"
for file in opm_export.js opm_tfi.js opm_monitor.js stored_zip.js; do
  cp "${ROOT_DIR}/docs/vgm_analyzer/${file}" "${STAGE_DIR}/vgm_analyzer/${file}"
done
cp "${ROOT_DIR}/docs/vgm_analyzer/seek_playback.js" "${STAGE_DIR}/vgm_analyzer/"
cp "${ROOT_DIR}/docs/playground/playground_vgm_presets.js" "${STAGE_DIR}/playground/"
cp "${ROOT_DIR}/docs/playground/playground_vgm_import.js" "${STAGE_DIR}/playground/"
cp "${ROOT_DIR}/docs/playground/wonderswan_vgm_import.js" "${STAGE_DIR}/playground/"
cp "${ROOT_DIR}/docs/playground/pokey_vgm_import.js" "${STAGE_DIR}/playground/"
cp "${ROOT_DIR}/docs/playground/playground_cassette.js" "${STAGE_DIR}/playground/"
for file in playground_virtual_files.js playground_monaco.js playground_monaco_completion.js playground_monaco_definitions.js playground_declarations.js tetorica-playground-globals.d.ts tetorica-playground-ym2612.d.ts tetorica-shell.d.ts; do
  cp "${ROOT_DIR}/docs/playground/${file}" "${STAGE_DIR}/playground/"
done
cp "${ROOT_DIR}/docs/playground/playground_file_tree.js" "${ROOT_DIR}/docs/playground/playground_example_order.js" "${STAGE_DIR}/playground/"
cp "${ROOT_DIR}/docs/playground/vendor/fflate.js" "${ROOT_DIR}/docs/playground/vendor/fflate-LICENSE" "${STAGE_DIR}/playground/vendor/"
# Synth uses the memory filesystem only; Git and its optional dependencies are
# deliberately excluded from this standalone sound editor.
for file in filesystem.js path.js reader.js sync.js; do
  cp "${ROOT_DIR}/docs/js/tetorica_virtual_files/${file}" "${STAGE_DIR}/js/tetorica_virtual_files/"
done
mkdir -p "${STAGE_DIR}/licenses/tetorica-virtual-files"
cp "${ROOT_DIR}/packages/virtual-files/LICENSE" "${STAGE_DIR}/licenses/tetorica-virtual-files/"
cp "${ROOT_DIR}/docs/playground/ym2203_high.js" "${STAGE_DIR}/playground/"
cp "${ROOT_DIR}/docs/playground/rf5c164_vgm_export.js" "${STAGE_DIR}/playground/"
perl -0pi -e 's#\s*<link rel="manifest" href="\.\./[^\"]+\.webmanifest">##g; s#\s*<link rel="icon" href="\.\./[^\"]+\.ico" sizes="any">##g; s#\s*<script src="\.\./sw-register\.js"></script>##g' "${STAGE_DIR}/index.html"

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

cp -R "${SOURCE_JS_DIR}/nes_apu_vendor" "${STAGE_DIR}/js/nes_apu_vendor"
for chip in jsnes fixnes-fds; do
  mkdir -p "${STAGE_DIR}/licenses/${chip}"
  cp "${ROOT_DIR}/third_party/${chip}/LICENSE" "${ROOT_DIR}/third_party/${chip}/README.md" "${STAGE_DIR}/licenses/${chip}/"
done
cp "${ROOT_DIR}/third_party/jsnes/AUTHORS.md" "${STAGE_DIR}/licenses/jsnes/"
node "${ROOT_DIR}/scripts/copy_nes_sources.mjs" "${STAGE_DIR}"
node "${ROOT_DIR}/scripts/copy_pwm_sources.mjs" "${STAGE_DIR}"

node "${ROOT_DIR}/scripts/runtime_artifact_profiles.mjs" synth --copy "${STAGE_DIR}"

cp "${LICENSE_FILE}" "${STAGE_DIR}/LICENSE"
mkdir -p "${STAGE_DIR}/licenses/mame-32x-pwm"
cp "${ROOT_DIR}/third_party/mame-32x-pwm/LICENSE" "${ROOT_DIR}/third_party/mame-32x-pwm/README.md" "${STAGE_DIR}/licenses/mame-32x-pwm/"
mkdir -p "${STAGE_DIR}/licenses/mame-rf5c164"
cp "${ROOT_DIR}/third_party/mame-rf5c164/LICENSE" "${ROOT_DIR}/third_party/mame-rf5c164/README.md" "${STAGE_DIR}/licenses/mame-rf5c164/"

node "${ROOT_DIR}/scripts/copy_nuked_sources.mjs" "${STAGE_DIR}"

node "${ROOT_DIR}/scripts/copy_segapsg_sources.mjs" "${STAGE_DIR}"

cat > "${STAGE_DIR}/THIRD_PARTY_LICENSES.txt" <<EOF
Sega PSG: original Tetorica implementation, BSD-3-Clause. See licenses/tetorica_sega_psg/ and sources/SegaPSG.md. Hardware reference: SMS Power! SN76489 documentation by Maxim and contributors.
32X PWM: MAME-derived FIFO/timer core, BSD-3-Clause. See licenses/mame-32x-pwm/.
NES APU: JSNES, Apache-2.0. See licenses/jsnes/.
FDS: fixNES-derived, MIT. See licenses/fixnes-fds/.
NES/FDS shared WASM port: Apache-2.0 and MIT. See licenses/tetorica-nes/ and sources/NES-FDS.md for source, authors and rebuilding.
Virtual filesystem: tetorica-virtual-files core, BSD-3-Clause. See licenses/tetorica-virtual-files/.
Cassette ZIP: fflate, MIT. See playground/vendor/fflate-LICENSE.

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
  - Corresponding source and rebuild recipe: ./sources/Nuked-OPN2.md
EOF

perl -0pi -e 's#import "\\./synth\\.js";#import "./synth.js";#g' "${STAGE_DIR}/index.html"
perl -0pi -e 's#\.\./js/([A-Za-z0-9._-]+\.js)#./js/$1#g; s#\.\./generated/#./generated/#g' "${STAGE_DIR}/synth.js"
perl -0pi -e 's#\.\./js/#./js/#g; s#\.\./generated/#./generated/#g; s#\.\./vgm_analyzer/#./vgm_analyzer/#g' \
  "${STAGE_DIR}/synth_song_controls.js" "${STAGE_DIR}/synth_song_preview.js" "${STAGE_DIR}/synth_song_state.js" \
  "${STAGE_DIR}/synth_recording.js" "${STAGE_DIR}/synth_looper.js" "${STAGE_DIR}/synth_performance.js" \
  "${STAGE_DIR}/synth_song_mix_defaults.js" "${STAGE_DIR}/synth_psg_audio.js" "${STAGE_DIR}/synth_psg_worklet.js" "${STAGE_DIR}/synth_song_psg_voice.js" "${STAGE_DIR}/synth_psg_loop_render.js" "${STAGE_DIR}/synth_pcm_audio.js" "${STAGE_DIR}/synth_pcm.js" \
  "${STAGE_DIR}/synth_pcm_recording_audio.js" "${STAGE_DIR}/synth_pcm_recording_worklet.js" "${STAGE_DIR}/synth_pcm_worklet.js" "${STAGE_DIR}/synth_pcm_release.js" \
  "${STAGE_DIR}/synth_pcm_loop_audio.js" "${STAGE_DIR}/synth_pcm_loop_render.js" \
  "${STAGE_DIR}/synth_fm_worklet.js" "${STAGE_DIR}/synth_fm_worklet_nuked.js"
perl -0pi -e 's#\.\./js/#./js/#g; s#\.\./playground/#./playground/#g' \
  "${STAGE_DIR}/synth_code_controls.js" "${STAGE_DIR}/synth_code_project.js" "${STAGE_DIR}/synth_code_audio.js"
perl -0pi -e 's#\.\./js/([A-Za-z0-9._-]+\.js)#./js/$1#g' "${STAGE_DIR}/synth_keyboard.js" "${STAGE_DIR}/synth_runtime.js"
perl -0pi -e 's#\.\./js/#./js/#g; s#\.\./playground/#./playground/#g' "${STAGE_DIR}/synth_project.js" "${STAGE_DIR}/synth_files.js" "${STAGE_DIR}/synth_recovery.js"
perl -0pi -e 's#\.\./js/#./js/#g; s#\.\./playground/#./playground/#g; s#\.\./vgm_analyzer/#./vgm_analyzer/#g' "${STAGE_DIR}/synth_preset_import.js"
perl -0pi -e 's#\.\./js/megasynth\.js#./js/megasynth.js#g#' "${STAGE_DIR}/synth_runtime.js"
perl -0pi -e 's#\./ym2612-worklet\.js#./js/ym2612-worklet.js#g; s#\./generated/ym2612_wasm\.wasm#./generated/ym2612_wasm.wasm#g' "${STAGE_DIR}/js/megasynth.js"
perl -0pi -e 's#import ym2612ModuleFactory from "\\.\\./generated/ym2612_wasm\\.js";#import ym2612ModuleFactory from "../generated/ym2612_wasm.js";#g' "${STAGE_DIR}/js/ym2612-worklet.js"
perl -0pi -e 's#import ym2612ModuleFactory from "\\.\\./generated/nuked_opn2_wasm\\.js";#import ym2612ModuleFactory from "../generated/nuked_opn2_wasm.js";#g' "${STAGE_DIR}/js/ym2612-worklet-nuked.js"

(
  cd "${STAGE_DIR}"
  node "${ROOT_DIR}/scripts/copy_opna_rhythm.mjs" "${STAGE_DIR}"
  node --experimental-vm-modules "${ROOT_DIR}/scripts/check_synth_package.mjs" "${STAGE_DIR}"
  zip -r "${ZIP_PATH}" .
)

echo "created stage: ${STAGE_DIR}"
echo "created zip: ${ZIP_PATH}"
echo "itch.io upload:"
echo "  1. Create/Edit project"
echo "  2. Set Kind of project to HTML"
echo "  3. Upload ${ZIP_PATH}"
echo "  4. Ensure index.html is the entry file"
