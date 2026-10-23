#!/bin/sh

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
WEB_DIR="${ROOT_DIR}/web"
DOCS_JS_DIR="${ROOT_DIR}/docs/js"

# Copy only the browser-side runtime files that are intended to stay shared
# between `web/` and `docs/js/`.
#
SYNC_FILES="
spc.js
spc_trace.js
spc_events.js
spc_performance.js
spc_pitch.js
spc_file.js
snes_brr.js
spc_audio.js
spc-worklet.js
spc_resampler.js
snessynth.js
playground_snes.js
playground_snes_audio.js
playground_snes_worklet.js
playground_spc.js
playground_spc_audio.js
soundchip_mixer.js
playground_audio_endpoint.js
playground_chip_inspector.js
playground_chip_inspector_state.js
playground_keyboard.js
playground_keyboard_channels.js
playground_native_voice_inspector.js
playground_opn_inspector.js
playground_dx7_inspector.js
playground_snes_inspector.js
playground_ym2151_inspector.js
playground_huc6280_inspector.js
playground_okim6258_inspector.js
playground_sample_edit.js
playground_sample_instrument.js
playground_chip_inspector_state.js
nesapu.js
nesapu_wasm.js
nesapusynth.js
soundchip_factory.js
soundchip.js
soundchip_worklet.js
soundchip-output-worklet.js
chip_worklet_transport.js
chip_pcm_renderer.js
wav.js
audio_decode.js
huc6280audioengine.js
okim6258audioengine.js
okim6295audioengine.js
bitcrusher-worklet.js
genesisaudioengine.js
pwm32x.js
pwm32x_wasm.js
pwm32x_playback.js
pwm32x_transport.js
playground_pwm_audio.js
playground_pwm_worklet.js
rf5c164.js
looper.js
megasynth.js
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
native_genesis_ym2203.js
native_genesis_ym2610b.js
native_genesis_x68000.js
native_genesis_master_system.js
native_genesis_segapsg.js
native_genesis_extra_segapsg.js
native_genesis_extra_ym2612.js
native_genesis_extra_ym2203.js
native_genesis_extra_ym2608.js
native_genesis_extra_ym2610.js
native_genesis_extra_ym2151.js
native_genesis_extra_ym2413.js
native_genesis_extra_ay8910.js
native_genesis_extra_register_voice.js
native_genesis_extra_opl.js
opn_ssg_retained.js
native_genesis_extra_chip.js
native_genesis_game_gear.js
native_genesis_opll.js
native_genesis_voice_endpoint.js
native_genesis_msx.js
native_genesis_msx_audio.js
native_genesis_opl.js
native_genesis_livefx.js
native_livefx_context.js
native_genesis_worker.js
native_genesis_monitor.js
megasynth_fx.js
playground_chip_port.js
playground_chip_clock.js
playground_performance_queue.js
playground_performance_processor.js
playground_performance_sender.js
playground_performance_host.js
playground_audition_guard.js
playground_worker_chip.js
playground_worker_dac.js
native_fx.js
native_noise.js
native_sample.js
playground_rf5c164.js
playground_ym2608.js
playground_gameboy.js
gameboy_runtime_synth.js
native_runtime_synth.js
playground_native_primary.js
huc6280synth.js
opl_synth.js
ym3526synth.js
ym3812synth.js
y8950synth.js
ymf262synth.js
ym2413synth.js
ay8910synth.js
playground_ay8910.js
playground_ay8910_audio.js
playground_ay8910_worklet.js
playground_ay8910_inspector.js
playground_ym2413.js
playground_ym2413_audio.js
playground_ym2413_worklet.js
playground_ym2413_inspector.js
playground_opl.js
playground_opl_audio.js
playground_opl_worklet.js
playground_opl_inspector.js
playground_huc6280.js
playground_huc6280_audio.js
playground_huc6280_worklet.js
okim6258synth.js
playground_okim6258.js
playground_okim6258_audio.js
playground_okim6258_worklet.js
playground_ym2151.js
playground_nes.js
playground_nes_audio.js
playground_nes_worklet.js
playground_dx7.js
playground_dx7_audio.js
playground_dx7_worklet.js
playground_ym2151_audio.js
playground_ym2151_worklet.js
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
megasynth_offline.js
sample_clock.js
megasynth_session.js
megasynth_pcm_looper.js
native-fx-worklet.js
custom_fx.js
audio-diagnostic-worklet.js
native_audio_effect.wasm
megasynth_looper.js
megasynth_recording.js
megasynth-fm-presets.js
opn_fm_synth.js
opn_variant.js
opn_variant_synth.js
ym3438.js
ymf276.js
ymf288.js
opn_fm_vgm.js
opn_runtime_synth.js
pitch.js
playground_runtime.js
playground_soundchips.js
playground_async_tasks.js
playground_opn.js
playground_opn_audio.js
playground_opn_worklet.js
playground_audio_scheduler.js
playground_clock.js
playground_execution.js
playground_live.js
playground_logic_worker.js
playground_midi.js
playground_duration.js
midi_song.js
midi_file.js
midi_source.js
playground_music.js
playground_noise.js
playground_sync.js
segapsg.js
segapsg_api.js
segapsgsynth.js
stereo-width-worklet.js
tfi.js
vgi.js
tetorica_audio_runtime.js
tetorica_synth.js
vgm_file.js
s98_file.js
vgm-output-worklet.js
vgmplayer.js
vgm_runtime.js
ay8910.js
ay8910audioengine.js
k051649.js
k051649audioengine.js
segapcm.js
segapcmaudioengine.js
gameboyapu.js
gameboysynth.js
gameboyapuaudioengine.js
multichipaudioengine.js
msxaudioengine.js
y8950.js
y8950audioengine.js
ymf278b.js
ymf278baudioengine.js
ym3526.js
ym3526audioengine.js
ym3812.js
ym3812audioengine.js
ymf262.js
ymf262audioengine.js
ym2151.js
ym2151synth.js
ym2151audioengine.js
playground_segapsg.js
playground_segapsg_audio.js
playground_segapsg_worklet.js
ym2413.js
ym2413audioengine.js
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
ym2610baudioengine.js
ym2610b-worklet.js
ym2610bsynth.js
ym2610bvgm.js
tetorica_synth.js
ym2203vgm.js
ym2608vgm.js
ym2612-worklet.js
ym2612-worklet-nuked.js
ym2612.js
ym2612synth.js
ym2612_dac.js
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

perl -0pi -e 's#"\./generated/ym2203_wasm\.js"#"../generated/ym2203_wasm.js"#g' "${DOCS_JS_DIR}/ym2203-worklet.js"
perl -0pi -e 's#"\./generated/ym2608_wasm\.js"#"../generated/ym2608_wasm.js"#g' "${DOCS_JS_DIR}/ym2608-worklet.js"
perl -0pi -e 's#"\./generated/ym2610b_wasm\.js"#"../generated/ym2610b_wasm.js"#g' "${DOCS_JS_DIR}/ym2610b-worklet.js"

# Synth factories also resolve their default WASM beside docs/generated/.
perl -0pi -e 's#"\./generated/#"../generated/#g' \
  "${DOCS_JS_DIR}/ym2203synth.js" "${DOCS_JS_DIR}/ym2608synth.js" "${DOCS_JS_DIR}/ym2610bsynth.js"

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

node "${ROOT_DIR}/scripts/copy_opna_rhythm.mjs" "${ROOT_DIR}/docs"
echo "done: synced shared web runtime files into docs/js"

# YM2151 WASM and static generated-loader import in the docs/js layout.
perl -0pi -e 's#\./generated/ym2151#../generated/ym2151#g' \
  "${DOCS_JS_DIR}/playground_ym2151_audio.js" "${DOCS_JS_DIR}/playground_ym2151_worklet.js"

mkdir -p "${ROOT_DIR}/docs/licenses/mame-rf5c164"
cp "${ROOT_DIR}/third_party/mame-rf5c164/LICENSE" "${ROOT_DIR}/third_party/mame-rf5c164/README.md" "${ROOT_DIR}/docs/licenses/mame-rf5c164/"

perl -0pi -e 's#\./generated/rf5c164#../generated/rf5c164#g' \
  "${DOCS_JS_DIR}/rf5c164-worklet.js" "${DOCS_JS_DIR}/playground_rf5c164_audio.js"

perl -0pi -e 's#./generated/ym2608#../generated/ym2608#g' \
  "${DOCS_JS_DIR}/playground_ym2608_audio.js" "${DOCS_JS_DIR}/playground_ym2608_worklet.js"

perl -0pi -e 's#./generated/gameboy_apu#../generated/gameboy_apu#g' \
  "${DOCS_JS_DIR}/playground_gameboy_audio.js" "${DOCS_JS_DIR}/playground_gameboy_worklet.js" "${DOCS_JS_DIR}/gameboy_runtime_synth.js" "${DOCS_JS_DIR}/playground_runtime.js"

for chip in huc6280 okim6258; do
  perl -0pi -e 's#\./generated/#../generated/#g' \
    "${DOCS_JS_DIR}/playground_${chip}_audio.js" "${DOCS_JS_DIR}/playground_${chip}_worklet.js"
  mkdir -p "${ROOT_DIR}/docs/licenses/mame-${chip}"
  cp "${ROOT_DIR}/third_party/mame-${chip}/LICENSE" "${ROOT_DIR}/third_party/mame-${chip}/README.md" "${ROOT_DIR}/docs/licenses/mame-${chip}/"
done

# Independent OPN worklets and their dynamically selected WASM binaries.
perl -0pi -e 's#\./generated/segapsg#../generated/segapsg#g' \
  "${DOCS_JS_DIR}/playground_segapsg_audio.js" "${DOCS_JS_DIR}/playground_segapsg_worklet.js"

perl -0pi -e 's#\./generated/#../generated/#g' \
  "${DOCS_JS_DIR}/playground_opn_audio.js" "${DOCS_JS_DIR}/playground_opn_worklet.js"

perl -0pi -e 's#\./generated/#../generated/#g' \
  "${DOCS_JS_DIR}/playground_opl_audio.js" "${DOCS_JS_DIR}/playground_opl_worklet.js"

perl -0pi -e 's#\./generated/#../generated/#g' \
  "${DOCS_JS_DIR}/playground_ym2413_audio.js" "${DOCS_JS_DIR}/playground_ym2413_worklet.js"

perl -0pi -e 's#\./generated/#../generated/#g' \
  "${DOCS_JS_DIR}/playground_ay8910_audio.js" "${DOCS_JS_DIR}/playground_ay8910_worklet.js"

perl -0pi -e 's#\./generated/#../generated/#g' "${DOCS_JS_DIR}/soundchip-output-worklet.js"

perl -0pi -e 's#../docs/js/nesapuaudioengine.js#./nesapuaudioengine.js#g' "${DOCS_JS_DIR}/nesapu.js"
perl -0pi -e 's#\./generated/#../generated/#g' \
  "${DOCS_JS_DIR}/playground_nes_audio.js" "${DOCS_JS_DIR}/playground_nes_worklet.js"
node "${ROOT_DIR}/scripts/copy_nes_sources.mjs" "${ROOT_DIR}/docs"
mkdir -p "${DOCS_JS_DIR}/tetorica_virtual_files"
cp -R "${ROOT_DIR}/packages/virtual-files/src/." "${DOCS_JS_DIR}/tetorica_virtual_files/"

# Pinned MSFA DX7 distribution: keep its src/ -> wasm/ layout and Apache notices.
mkdir -p "${DOCS_JS_DIR}/msfa_dx7"
cp -R "${WEB_DIR}/msfa_dx7/." "${DOCS_JS_DIR}/msfa_dx7/"
mkdir -p "${ROOT_DIR}/docs/licenses/tetorica-msfa-dx7-wasm"
cp "${WEB_DIR}/msfa_dx7/LICENSE" "${WEB_DIR}/msfa_dx7/THIRD_PARTY_NOTICES.md" \
  "${WEB_DIR}/msfa_dx7/README.vendor.md" "${ROOT_DIR}/docs/licenses/tetorica-msfa-dx7-wasm/"
cp "${WEB_DIR}/msfa_dx7/vendor/msfa/COPYING" "${WEB_DIR}/msfa_dx7/vendor/msfa/UPSTREAM.md" \
  "${ROOT_DIR}/docs/licenses/tetorica-msfa-dx7-wasm/"

perl -0pi -e 's#\./generated/#../generated/#g' \
  "${DOCS_JS_DIR}/playground_pwm_audio.js" "${DOCS_JS_DIR}/playground_pwm_worklet.js"

mkdir -p "${ROOT_DIR}/docs/licenses/mame-32x-pwm"
cp "${ROOT_DIR}/third_party/mame-32x-pwm/LICENSE" "${ROOT_DIR}/third_party/mame-32x-pwm/README.md" "${ROOT_DIR}/docs/licenses/mame-32x-pwm/"

# Cache identities belong to the website build; keep Node/package constructor identities unchanged.
perl -0pi -e 's#\./generated/spc_wasm#../generated/spc_wasm#g' \
  "${DOCS_JS_DIR}/spc-worklet.js" "${DOCS_JS_DIR}/spc_audio.js" \
  "${DOCS_JS_DIR}/playground_snes_worklet.js" "${DOCS_JS_DIR}/playground_snes_audio.js" "${DOCS_JS_DIR}/playground_spc_audio.js"
node "${ROOT_DIR}/scripts/copy_spc_sources.mjs" "${ROOT_DIR}/docs"
node "${ROOT_DIR}/scripts/copy_nuked_sources.mjs" "${ROOT_DIR}/docs"
node "${ROOT_DIR}/scripts/version_playground_runtime.mjs"
