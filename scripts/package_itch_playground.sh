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
playground_git.js
playground_page_lifecycle.js
playground_audio_input.js
playground_sample_assets.js
playground_sample_editor.css
playground_sample_editor_worker.js
playground_fx_monitor.js
playground_audio_monitor.js
playground_audio_diagnostics.js
playground_audio_engine.js
playground_monitor_scale.js
playground_mixer.js
playground_mixer.css
playground_chip_tabs.js
playground_chip_tabs.css
playground_gameboy_voice_panel.js
playground_nes_voice_panel.js
playground_ym2151_voice_panel.js
playground_okim6258_voice_panel.js
playground_huc6280_voice_panel.js
playground_dx7_voice_panel.js
playground_opl_voice_panel.js
playground_ym2413_voice_panel.js
playground_ay8910_voice_panel.js
playground_mode_keyboard.js
playground_workbench.js
playground_cassette.js
playground_examples.js
playground_monaco.js
playground_monaco_definitions.js
playground_monaco_completion.js
playground_operator_tab.js
playground_operator_visual.js
playground_operator_keyboard.js
playground_query.js
playground_sync.js
playground_ui.js
playground_virtual_files.js
playground_shell.js
playground_shell_check.js
playground_shell_modules.js
playground_shell_session.js
playground_shell_runner.js
playground_shell_diagnostics.js
playground_shell_worker.js
playground_autosave.js
playground_mode.js
playground_mode_project.js
playground_mode_starters.js
playground_mode_examples.js
playground_declarations.js
playground_file_tree.js
playground_file_menu.js
playground_example_order.js
playground_file_resize.js
playground_tfi_editor.js
playground_midi_import.js
playground_spc_import.js
playground_spc_source.js
playground_spc_song_source.js
playground_spc_trace.js
playground_spc_trace_worker.js
playground_vgm_presets.js
playground_vgm_import.js
ym2203_high.js
ym2608_vgm_import.js
ym2608_high.js
rf5c164_vgm_export.js
tetorica-playground-globals.d.ts
tetorica-shell.d.ts
tetorica-playground-ym2203.d.ts
tetorica-playground-ym2608.d.ts
tetorica-playground-ym2610.d.ts
tetorica-playground-ym2610b.d.ts
tetorica-playground-ym2612.d.ts
tetorica-playground-gameboy.d.ts
tetorica-playground-nes.d.ts
tetorica-playground-snes.d.ts
tetorica-playground-x68000.d.ts
tetorica-playground-huc6280.d.ts
tetorica-playground-ym3526.d.ts
tetorica-playground-ym3812.d.ts
tetorica-playground-y8950.d.ts
tetorica-playground-ymf262.d.ts
tetorica-playground-dx7.d.ts
tetorica-playground-game-gear.d.ts
tetorica-playground-master-system.d.ts
tetorica-playground-msx.d.ts
tetorica-playground-msx-audio.d.ts
tetorica-playground-mega-cd.d.ts
"

RUNTIME_FILES="
spc.js
spc_trace.js
spc_events.js
spc_performance.js
spc_pitch.js
spc-worklet.js
playground_spc.js
playground_spc_audio.js
spc_file.js
snes_brr.js
wav.js
spc_resampler.js
snessynth.js
playground_snes.js
playground_snes_audio.js
playground_snes_worklet.js
soundchip_mixer.js
playground_chip_inspector.js
playground_keyboard_channels.js
playground_opn_inspector.js
playground_chip_inspector_state.js
pwm32x.js
pwm32x_wasm.js
pwm32x_playback.js
playground_pwm_audio.js
playground_pwm_worklet.js
rf5c164.js
bitcrusher-worklet.js
looper.js
megasynth.js
megasynth_fx.js
playground_chip_port.js
playground_performance_sender.js
playground_performance_host.js
playground_performance_queue.js
playground_performance_processor.js
playground_native_voice_inspector.js
playground_ym2151_inspector.js
playground_okim6258_inspector.js
playground_huc6280_inspector.js
playground_audition_guard.js
playground_worker_chip.js
playground_worker_dac.js
native_fx.js
native_noise.js
native_sample.js
playground_rf5c164.js
playground_ym2608.js
ym2151.js
ym2151synth.js
opl_synth.js
ym3526synth.js
ym3812synth.js
y8950synth.js
ymf262synth.js
ym2413synth.js
ay8910synth.js
ay8910.js
ay8910audioengine.js
playground_ay8910.js
playground_ay8910_audio.js
playground_ay8910_worklet.js
playground_ay8910_inspector.js
ym2413.js
ym2413audioengine.js
playground_ym2413.js
playground_ym2413_audio.js
playground_ym2413_worklet.js
playground_ym2413_inspector.js
ym3526.js
ym3812.js
y8950.js
ymf262.js
ym3526audioengine.js
ym3812audioengine.js
y8950audioengine.js
ymf262audioengine.js
playground_opl.js
playground_opl_audio.js
playground_opl_worklet.js
playground_opl_inspector.js
nesapu.js
nesapu_wasm.js
nesapusynth.js
nesapuaudioengine.js
fds_audio.js
chip_worklet_transport.js
playground_ym2151.js
playground_nes.js
playground_nes_audio.js
playground_nes_worklet.js
playground_dx7.js
playground_dx7_audio.js
playground_dx7_worklet.js
playground_dx7_inspector.js
playground_snes_inspector.js
playground_ym2151_audio.js
playground_ym2151_worklet.js
playground_segapsg.js
playground_segapsg_audio.js
playground_segapsg_worklet.js
playground_gameboy.js
gameboysynth.js
gameboy_runtime_synth.js
native_runtime_synth.js
playground_native_primary.js
gameboyapu.js
playground_huc6280.js
playground_huc6280_audio.js
playground_huc6280_worklet.js
huc6280synth.js
huc6280audioengine.js
playground_okim6258.js
playground_okim6258_audio.js
playground_okim6258_worklet.js
okim6258synth.js
okim6258audioengine.js
playground_gameboy_audio.js
playground_gameboy_worklet.js
playground_ym2608_audio.js
playground_ym2608_worklet.js
playground_ym2608_timeline.js
rf5c164synth.js
rf5c164_pcm.js
playground_rf5c164_audio.js
rf5c164-worklet.js
native_sample_processor.js
native_fx_rack.js
native_fx_graph.js
native_fx_engine.js
native-fx-worklet.js
custom_fx.js
audio-diagnostic-worklet.js
native_audio_effect.wasm
megasynth_looper.js
megasynth_recording.js
megasynth-fm-presets.js
opn_fm_synth.js
opn_runtime_synth.js
opn_fm_vgm.js
pitch.js
playground_audio_scheduler.js
playground_clock.js
playground_chip_clock.js
soundchip_pitch.js
playground_execution.js
playground_live.js
playground_logic_worker.js
playground_log.js
playground_midi.js
playground_duration.js
midi_song.js
midi_file.js
midi_source.js
playground_music.js
playground_noise.js
playground_runtime.js
native_genesis_synth.js
native_genesis_media.js
native_genesis_fx.js
native_genesis_noise.js
native_genesis_rf5c164.js
native_genesis_dx7.js
native_genesis_nes.js
native_genesis_console.js
native_genesis_snes.js
native_genesis_pwm.js
native_genesis_ym2608.js
native_genesis_ym2610b.js
native_genesis_x68000.js
native_genesis_master_system.js
native_genesis_opll.js
native_genesis_voice_endpoint.js
native_genesis_msx.js
native_genesis_opl.js
native_genesis_livefx.js
native_livefx_context.js
native_genesis_worker.js
native_genesis_monitor.js
playground_keyboard.js
playground_sample_edit.js
playground_sample_instrument.js
playground_soundchips.js
playground_async_tasks.js
playground_opn.js
playground_opn_audio.js
playground_opn_worklet.js
playground_sync.js
segapsg.js
segapsg_api.js
segapsgsynth.js
stereo-width-worklet.js
tfi.js
vgi.js
tetorica_audio_runtime.js
audio_decode.js
tetorica_synth.js
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
ym2610b.js
ym2610bsynth.js
ym2610bvgm.js
ym2610b-worklet.js
vgm_file.js
s98_file.js
ym2612vgm.js
ym2203vgm.js
ym2608vgm.js
ym2612-worklet.js
ym2612-worklet-nuked.js
ym2612.js
ym2612synth.js
ym2612_dac.js
"

SYNTH_SUPPORT_FILES="
synth_controls.js
synth_envelope.js
synth_operator_envelope.js
synth_keyboard.js
"

GENERATED_FILES="
nesapu_wasm.js
nesapu_wasm.wasm
pwm32x_wasm.js
pwm32x_wasm.wasm
ay8910_wasm.js
ay8910_wasm.wasm
ym2413_wasm.js
ym2413_wasm.wasm
ym3526_wasm.js
ym3526_wasm.wasm
ym3812_wasm.js
ym3812_wasm.wasm
y8950_wasm.js
y8950_wasm.wasm
ymf262_wasm.js
ymf262_wasm.wasm
spc_wasm.js
spc_wasm.wasm
ym2151_wasm.js
ym2151_wasm.wasm
gameboy_apu_wasm.js
gameboy_apu_wasm.wasm
huc6280_wasm.js
huc6280_wasm.wasm
okim6258_wasm.js
okim6258_wasm.wasm
rf5c164_wasm.js
rf5c164_wasm.wasm
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

node "${ROOT_DIR}/scripts/build_playground_examples.mjs"

mkdir -p "${RELEASE_DIR}"
rm -rf "${STAGE_DIR}"
rm -f "${ZIP_PATH}"
mkdir -p "${STAGE_DIR}/js" "${STAGE_DIR}/synth" "${STAGE_DIR}/generated" "${STAGE_DIR}/samples" "${STAGE_DIR}/vendor" "${STAGE_DIR}/licenses/nuked-opn2" "${STAGE_DIR}/vgm_analyzer"
cp "${ROOT_DIR}/docs/vgm_analyzer/spc_brr_candidates.js" "${STAGE_DIR}/vgm_analyzer/spc_brr_candidates.js"

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

cp -R "${DOCS_JS_DIR}/nes_apu_vendor" "${STAGE_DIR}/js/nes_apu_vendor"
cp -R "${DOCS_JS_DIR}/msfa_dx7" "${STAGE_DIR}/js/msfa_dx7"
cp -R "${ROOT_DIR}/packages/virtual-files/src" "${STAGE_DIR}/js/tetorica_virtual_files"
for file in git.bundle.js GIT_LICENSES.txt; do
  src="${DOCS_JS_DIR}/tetorica_virtual_files/${file}"
  if [ ! -f "${src}" ]; then
    echo "error: missing browser Git asset: ${src}; run npm run build:virtual-files" >&2
    exit 1
  fi
  cp "${src}" "${STAGE_DIR}/js/tetorica_virtual_files/${file}"
done
for chip in jsnes fixnes-fds; do
  mkdir -p "${STAGE_DIR}/licenses/${chip}"
  cp "${ROOT_DIR}/third_party/${chip}/LICENSE" "${ROOT_DIR}/third_party/${chip}/README.md" "${STAGE_DIR}/licenses/${chip}/"
done

cp "${ROOT_DIR}/third_party/jsnes/AUTHORS.md" "${STAGE_DIR}/licenses/jsnes/"
node "${ROOT_DIR}/scripts/copy_nes_sources.mjs" "${STAGE_DIR}"
node "${ROOT_DIR}/scripts/copy_pwm_sources.mjs" "${STAGE_DIR}"

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

for chip in ym2203 ym2608 ym2610b; do
  if [ -f "${DOCS_GENERATED_DIR}/${chip}_wasm.js" ] && [ -f "${DOCS_GENERATED_DIR}/${chip}_wasm.wasm" ]; then
    cp "${DOCS_GENERATED_DIR}/${chip}_wasm.js" "${STAGE_DIR}/generated/${chip}_wasm.js"
    cp "${DOCS_GENERATED_DIR}/${chip}_wasm.wasm" "${STAGE_DIR}/generated/${chip}_wasm.wasm"
  fi
done

mkdir -p "${STAGE_DIR}/licenses/mame-32x-pwm"
cp "${ROOT_DIR}/third_party/mame-32x-pwm/LICENSE" "${ROOT_DIR}/third_party/mame-32x-pwm/README.md" "${STAGE_DIR}/licenses/mame-32x-pwm/"
mkdir -p "${STAGE_DIR}/licenses/mame-rf5c164"
mkdir -p "${STAGE_DIR}/licenses/mame-gameboy"
cp "${ROOT_DIR}/third_party/mame-gameboy/LICENSE" "${ROOT_DIR}/third_party/mame-gameboy/README.md" "${STAGE_DIR}/licenses/mame-gameboy/"
cp "${ROOT_DIR}/third_party/mame-rf5c164/LICENSE" "${ROOT_DIR}/third_party/mame-rf5c164/README.md" "${STAGE_DIR}/licenses/mame-rf5c164/"
for chip in mame-huc6280 mame-okim6258 mame-ay8910; do
  mkdir -p "${STAGE_DIR}/licenses/${chip}"
  cp "${ROOT_DIR}/third_party/${chip}/LICENSE" "${ROOT_DIR}/third_party/${chip}/README.md" "${STAGE_DIR}/licenses/${chip}/"
done

cp -R "${PLAYGROUND_DIR}/examples" "${STAGE_DIR}/examples"
cp -R "${PLAYGROUND_DIR}/defaults" "${STAGE_DIR}/defaults"
cp -R "${PLAYGROUND_SAMPLES_DIR}/." "${STAGE_DIR}/samples/"
cp -R "${PLAYGROUND_VENDOR_DIR}/." "${STAGE_DIR}/vendor/"

cp "${LICENSE_FILE}" "${STAGE_DIR}/LICENSE"
cp "${ROOT_DIR}/docs/llms.txt" "${STAGE_DIR}/llms.txt"
cp "${ROOT_DIR}/docs/playground-favicon.ico" "${STAGE_DIR}/favicon.ico"

for file in ${NUKED_LICENSE_FILES}; do
  cp "${NUKED_LICENSE_DIR}/${file}" "${STAGE_DIR}/licenses/nuked-opn2/${file}"
done

node "${ROOT_DIR}/scripts/copy_spc_sources.mjs" "${STAGE_DIR}"
cat > "${STAGE_DIR}/THIRD_PARTY_LICENSES.txt" <<EOF
SNES S-DSP: snes_spc, LGPL-2.1-or-later. See licenses/snes-spc and sources/SNES-SPC.md for source and rebuilding.
JavaScript import parser: es-module-lexer 3.0.3, MIT. See vendor/es-module-lexer-LICENSE.

Browser Git: isomorphic-git and bundled dependencies. See js/tetorica_virtual_files/GIT_LICENSES.txt.

NES APU: JSNES, Apache-2.0. See licenses/jsnes/.
FDS: fixNES-derived, MIT. See licenses/fixnes-fds/.
The default NES/FDS WASM uses the shared C++ port. See licenses/tetorica-nes/ and sources/NES-FDS.md for source and rebuilding.

DX7: tetorica-msfa-dx7-wasm 0.1.0 / Google MSFA, Apache-2.0.
See js/msfa_dx7/LICENSE, THIRD_PARTY_NOTICES.md and README.vendor.md.

32X PWM: MAME-derived FIFO/timer core, BSD-3-Clause. See licenses/mame-32x-pwm/.

Game Boy DMG APU: MAME adaptation, BSD-3-Clause. See licenses/mame-gameboy/.

PC Engine HuC6280 PSG: MAME adaptation by Charles MacDonald, BSD-3-Clause. See licenses/mame-huc6280/.
X68000 OKIM6258 ADPCM: MAME adaptation by Barry Rodewald, BSD-3-Clause. See licenses/mame-okim6258/.
MSX AY-3-8910 PSG: MAME adaptation, BSD-3-Clause. See licenses/mame-ay8910/.

RF5C164: MAME adaptation, BSD-3-Clause.
See ./licenses/mame-rf5c164/LICENSE and README.md.

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
perl -0pi -e 's#\s*<link rel="manifest" href="\.\./[^\"]+\.webmanifest">##g; s#href="../llms.txt"#href="./llms.txt"#g; s#href="\.\./playground-favicon\.ico"#href="./favicon.ico"#g; s#\s*<script src="\.\./sw-register\.js"></script>##g' "${STAGE_DIR}/index.html"
perl -0pi -e 's#<a class="link-button" href="\.\./index\.html">Back</a>##g' \
  "${STAGE_DIR}/index.html"
perl -0pi -e 's#"\./playground\.js"#"./playground.js"#g; s#\.\./js/#./js/#g; s#\.\./synth/#./synth/#g; s#\.\./generated/#./generated/#g' \
  "${STAGE_DIR}/index.html" \
  "${STAGE_DIR}/playground.js" \
  "${STAGE_DIR}/playground_audio_input.js" \
  "${STAGE_DIR}/playground_audio_diagnostics.js" \
  "${STAGE_DIR}/playground_sample_editor_worker.js" \
  "${STAGE_DIR}/playground_mode.js" \
  "${STAGE_DIR}/playground_mode_keyboard.js" \
  "${STAGE_DIR}/playground_opl_voice_panel.js" \
  "${STAGE_DIR}/playground_ym2413_voice_panel.js" \
  "${STAGE_DIR}/playground_ay8910_voice_panel.js" \
  "${STAGE_DIR}/playground_git.js" \
  "${STAGE_DIR}/playground_virtual_files.js" \
  "${STAGE_DIR}/playground_shell.js" \
  "${STAGE_DIR}/playground_shell_session.js" \
  "${STAGE_DIR}/playground_shell_modules.js" \
  "${STAGE_DIR}/playground_monaco.js" \
  "${STAGE_DIR}/playground_monaco_definitions.js" \
  "${STAGE_DIR}/playground_monaco_completion.js" \
  "${STAGE_DIR}/playground_sync.js" \
  "${STAGE_DIR}/playground_operator_tab.js" \
  "${STAGE_DIR}/playground_operator_visual.js" \
  "${STAGE_DIR}/playground_operator_keyboard.js" \
  "${STAGE_DIR}/playground_tfi_editor.js" \
  "${STAGE_DIR}/playground_midi_import.js" \
  "${STAGE_DIR}/playground_spc_source.js" \
  "${STAGE_DIR}/playground_spc_import.js" \
  "${STAGE_DIR}/playground_spc_song_source.js" \
  "${STAGE_DIR}/playground_spc_trace_worker.js" \
  "${STAGE_DIR}/playground_vgm_presets.js" \
  "${STAGE_DIR}/playground_vgm_import.js" \
  "${STAGE_DIR}/ym2608_vgm_import.js" \
  "${STAGE_DIR}/rf5c164_vgm_export.js" \
  "${STAGE_DIR}/playground_query.js" \
  "${STAGE_DIR}/playground_examples.js" \
  "${STAGE_DIR}/playground_ui.js" \
  "${STAGE_DIR}/playground_audio_monitor.js" \
  "${STAGE_DIR}/playground_workbench.js"
perl -0pi -e 's#\.\./vgm_analyzer/#./vgm_analyzer/#g' "${STAGE_DIR}/playground_spc_source.js"

node "${ROOT_DIR}/scripts/copy_opna_rhythm.mjs" "${STAGE_DIR}"
node --experimental-vm-modules "${ROOT_DIR}/scripts/check_playground_package.mjs" "${STAGE_DIR}"

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
