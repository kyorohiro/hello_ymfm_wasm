import {readdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

// Cache versions belong to the generated website. Keep canonical web/ and npm
// imports query-free so direct class exports retain their constructor identity.
const directory=fileURLToPath(new URL('../docs/js/',import.meta.url));
const version='chip-tabs-2';
const nativeFiles=['native_runtime_synth.js','playground_native_primary.js','tetorica_synth.js',
  'playground_runtime.js','playground_logic_worker.js','playground_soundchips.js','playground_performance_processor.js','playground_chip_clock.js',
  'nesapusynth.js','playground_nes.js','playground_nes_audio.js','playground_nes_worklet.js',
  'playground_snes.js','playground_snes_audio.js','playground_snes_worklet.js',
  'playground_ym2151.js','playground_ym2151_audio.js','playground_ym2151_worklet.js',
  ...['huc6280','okim6258'].flatMap(chip=>[`${chip}synth.js`,`playground_${chip}.js`,`playground_${chip}_audio.js`,`playground_${chip}_worklet.js`])];
const pcmFiles=['ym2203.js','ym2608.js','ym2610b.js','pwm32x.js'];
const revisions={
  'spc.js':'spc-events-1',
  'spc_events.js':'spc-events-1',
  'spc_performance.js':'spc-events-1',
  'spc_pitch.js':'spc-pitch-comments-1',
  'snes_brr.js':'spc-pitch-comments-1',
  'spc_trace.js':'spc-events-1',
  'spc_audio.js':'spc-events-1',
  'snessynth.js':'spc-song-js-1',
  'playground_snes.js':'spc-song-js-1',
  'playground_snes_worklet.js':'spc-song-js-1',
  'playground_snes_audio.js':'spc-song-js-1',
  'playground_clock.js':'spc-song-timing-1',
  'playground_runtime.js':'gameboy-mode-1',
  'playground_logic_worker.js':'gameboy-mode-1',
  'playground_worker_chip.js':'gameboy-mode-1',
  'gameboy_runtime_synth.js':'gameboy-mode-1',
  'gameboysynth.js':'gameboy-mode-1',
  'playground_gameboy.js':'gameboy-mode-1',
  'playground_gameboy_worklet.js':'gameboy-mode-1',
  'playground_chip_clock.js':'opnb-primary-1',
  'playground_performance_sender.js':'opna-primary-1',
  'opn_fm_synth.js':'opnb-primary-1',
  'opn_runtime_synth.js':'opnb-primary-1',
  'tetorica_synth.js':'gameboy-mode-1',
  'ym2203synth.js':'opn-ssg-1',
  'ym2203-worklet.js':'audio-render-3',
  'ym2608synth.js':'opnb-primary-1',
  'ym2610bsynth.js':'opnb-primary-1',
  'ym2610b-worklet.js':'audio-render-3',
  'ym2612-worklet-nuked.js':'audio-render-3',
  'ssgsynth.js':'opna-primary-1',
  'ym2608-worklet.js':'audio-render-3',
  'playground_performance_host.js':'spc-events-1',
  'playground_soundchips.js':'spc-import-1',
  'spc-worklet.js':'spc-events-1',
  'playground_spc.js':'spc-events-1',
  'playground_spc_audio.js':'spc-events-1',
  'playground_performance_processor.js':'spc-song-js-1',
  ...Object.fromEntries(nativeFiles.map(name=>[name,'native-modes-3'])),
  ...Object.fromEntries(pcmFiles.map(name=>[name,'pcm-views-1'])),
};
// A transport and its processor must roll out together. Also invalidate their
// importers so a cached parent cannot keep loading an earlier dependency URL.
const audioVersion='audio-stability-2';
const audioFiles=new Set(['chip_pcm_renderer.js','custom_fx.js','opn_fm_synth.js',
  'playground_chip_clock.js','playground_chip_port.js','playground_opn_worklet.js',
  'playground_segapsg_worklet.js','soundchip-output-worklet.js',
  'tetorica_audio_runtime.js','ym2608audioengine.js','ym2612synth.js']);
const sources=await Promise.all((await readdir(directory)).filter(name=>name.endsWith('.js'))
  .map(async name=>({name,source:await readFile(join(directory,name),'utf8')})));
const segaVersion='audio-numeric-bindings-1';
const segaFiles=new Set(['segapsg.js','segapsgsynth.js','segapsg_api.js',
  'playground_segapsg.js','playground_segapsg_audio.js','playground_segapsg_worklet.js',
  'native_runtime_synth.js','playground_native_primary.js','tetorica_synth.js',
  'playground_runtime.js','playground_logic_worker.js','playground_performance_processor.js']);
const megaCdVersion='audio-numeric-bindings-1';
const nesVersion='nes-wasm-1';
const nesFiles=new Set(['nesapu.js','nesapu_wasm.js','playground_nes_audio.js','playground_nes_worklet.js',
  'soundchip.js','soundchip-output-worklet.js']);
const megaCdFiles=new Set(['ym2612.js','segapsg.js','playground_runtime.js','playground_logic_worker.js','playground_live.js',
  'playground_chip_clock.js','playground_audition_guard.js','playground_keyboard_channels.js','playground_opn_inspector.js',
  'ym2612-worklet.js','ym2612-worklet-nuked.js','ym2203-worklet.js','ym2608-worklet.js','ym2610b-worklet.js',
  'playground_opn_worklet.js','playground_ym2608_worklet.js',
  'tetorica_audio_runtime.js',
  'playground_rf5c164.js','rf5c164-worklet.js','playground_keyboard.js',
  'playground_sample_edit.js','playground_sample_gameboy_preview.js','playground_sample_instrument.js','playground_performance_sender.js',
  'playground_chip_inspector_state.js','playground_native_voice_inspector.js',
  'playground_gameboy_worklet.js','playground_nes_worklet.js','playground_performance_processor.js',
  'playground_dx7.js','playground_dx7_audio.js','playground_dx7_worklet.js','playground_dx7_inspector.js',
  'playground_snes.js','playground_snes_worklet.js','playground_snes_inspector.js',
  'playground_ym2151_worklet.js','playground_ym2151_inspector.js',
  'playground_okim6258_worklet.js','playground_okim6258_inspector.js','okim6258synth.js','playground_okim6258.js',
  'playground_huc6280_worklet.js','playground_huc6280_inspector.js','playground_huc6280.js']);
for(const name of ['opl_synth.js','ym3526synth.js','ym3812synth.js','y8950synth.js','ymf262synth.js',
  'playground_opl.js','playground_opl_audio.js','playground_opl_worklet.js','playground_opl_inspector.js',
  'soundchip_worklet.js','chip_worklet_transport.js','soundchip.js'])megaCdFiles.add(name);
for(const name of ['ym2413synth.js','playground_ym2413.js','playground_ym2413_audio.js',
  'playground_ym2413_worklet.js','playground_ym2413_inspector.js'])megaCdFiles.add(name);
for(const name of ['ay8910synth.js','playground_ay8910.js','playground_ay8910_audio.js',
  'playground_ay8910_worklet.js','playground_ay8910_inspector.js'])megaCdFiles.add(name);
let propagated;
do {
  propagated=false;
  for(const {name,source} of sources) {
    if(audioFiles.has(name))continue;
    const imports=[...source.matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
    if(imports.some(match=>audioFiles.has(match[1]))) {audioFiles.add(name);propagated=true;}
  }
} while(propagated);
do {
  propagated=false;
  for(const {name,source} of sources) {
    if(nesFiles.has(name))continue;
    const runtimeSource=source.replace(/\/\*[\s\S]*?\*\//g,'');
    const imports=[...runtimeSource.matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
    if(imports.some(match=>nesFiles.has(match[1]))) {nesFiles.add(name);propagated=true;}
  }
} while(propagated);
nesFiles.add('playground.js');
do {
  propagated=false;
  for(const {name,source} of sources) {
    if(megaCdFiles.has(name))continue;
    const runtimeSource=source.replace(/\/\*[\s\S]*?\*\//g,'');
    const imports=[...runtimeSource.matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
    if(imports.some(match=>megaCdFiles.has(match[1]))) {megaCdFiles.add(name);propagated=true;}
  }
} while(propagated);
do {
  propagated=false;
  for(const {name,source} of sources) {
    if(segaFiles.has(name))continue;
    // Type-only JSDoc references do not make a module a runtime importer.
    const runtimeSource=source.replace(/\/\*[\s\S]*?\*\//g,'');
    const imports=[...runtimeSource.matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
    if(imports.some(match=>segaFiles.has(match[1]))) {segaFiles.add(name);propagated=true;}
  }
} while(propagated);
for(const name of ['playground.js','playground_mode.js','playground_operator_tab.js','playground_tfi_editor.js'])audioFiles.add(name);
const pageRevisions={'playground.js':megaCdVersion,'playground_audio_input.js':megaCdVersion,
  'playground_mode_keyboard.js':megaCdVersion,'playground_dx7_voice_panel.js':megaCdVersion,
  'playground_opl_voice_panel.js':megaCdVersion,
  'playground_ym2413_voice_panel.js':megaCdVersion,
  'playground_ay8910_voice_panel.js':megaCdVersion,
  'playground_chip_tabs.js':megaCdVersion,'playground_chip_tabs.css':megaCdVersion,
  'playground_gameboy_voice_panel.js':megaCdVersion,'playground_nes_voice_panel.js':megaCdVersion,
  'playground_ym2151_voice_panel.js':megaCdVersion,'playground_okim6258_voice_panel.js':megaCdVersion,'playground_huc6280_voice_panel.js':megaCdVersion,
  'playground_workbench.js':megaCdVersion,'playground_ui.js':megaCdVersion,
  'playground_sample_assets.js':megaCdVersion,'playground_sample_editor_worker.js':megaCdVersion,
  'playground_operator_keyboard.js':megaCdVersion,'synth_keyboard.js':megaCdVersion,'playground_mode_starters.js':'mode-choice-1',
  'playground_autosave.js':'mode-handoff-1','playground_mode_project.js':'mode-handoff-1',
  ...Object.fromEntries(['playground_mode.js','playground_examples.js','playground_mode_examples.js',
    'playground_monaco.js','playground_declarations.js','playground_monaco_completion.js']
    .map(name=>[name,megaCdVersion])),
  ...Object.fromEntries(['ym2612vgm.js','ym2203vgm.js','ym2608vgm.js','ym2610bvgm.js',
    'playground_vgm_import.js','rf5c164_vgm_export.js','ym2608_vgm_import.js','playground_vgm_presets.js']
    .map(name=>[name,'vgm-frequency-order-2'])),
  ...Object.fromEntries(['playground.js','playground_mode_keyboard.js','playground_operator_keyboard.js',
    'playground_chip_tabs.js','playground_nes_voice_panel.js','playground_ui.js','playground_workbench.js',
    'playground_tfi_editor.js'].map(name=>[name,'operator-tab-keyboard-1']))};
const consoleVersion='native-consoles-1';
const consoleFiles=new Set(['native_genesis_console.js','native_genesis_snes.js','native_genesis_synth.js',
  'native_genesis_worker.js','playground_native_primary.js','playground_runtime.js','playground_logic_worker.js',
  'playground_audio_engine.js','playground.js']);
do {
  propagated=false;
  for(const {name,source} of sources){
    if(consoleFiles.has(name))continue;
    const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
    if(imports.some(match=>consoleFiles.has(match[1]))){consoleFiles.add(name);propagated=true;}
  }
}while(propagated);
const pwmVersion='pwm-wasm-1';
const pwmFiles=new Set(['pwm32x.js','pwm32x_wasm.js','pwm32x_playback.js','pwm32x_transport.js',
  'playground_pwm_audio.js','playground_pwm_worklet.js','native_genesis_pwm.js','native_genesis_synth.js',
  'native_genesis_worker.js','playground_native_primary.js','playground_runtime.js','playground_logic_worker.js','playground_audio_engine.js','playground.js']);
do {propagated=false;for(const {name,source}of sources){
  if(pwmFiles.has(name))continue;
  const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
  if(imports.some(match=>pwmFiles.has(match[1]))){pwmFiles.add(name);propagated=true;}
}}while(propagated);
const pc98Version='native-pc98-1';
const pc98Files=new Set(['native_genesis_ym2608.js','native_genesis_synth.js','native_genesis_worker.js',
  'playground_runtime.js','playground_logic_worker.js','playground_sync.js','playground_audio_engine.js','playground_operator_tab.js','playground.js']);
do {propagated=false;for(const {name,source}of sources){
  if(pc98Files.has(name))continue;
  const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
  if(imports.some(match=>pc98Files.has(match[1]))){pc98Files.add(name);propagated=true;}
}}while(propagated);
const neoGeoVersion='native-neogeo-1';
const neoGeoFiles=new Set(['native_genesis_ym2610b.js','native_genesis_ym2608.js','native_genesis_synth.js','native_genesis_worker.js',
  'playground_runtime.js','playground_logic_worker.js','playground_audio_engine.js','playground.js']);
do {propagated=false;for(const {name,source}of sources){
  if(neoGeoFiles.has(name))continue;
  const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
  if(imports.some(match=>neoGeoFiles.has(match[1]))){neoGeoFiles.add(name);propagated=true;}
}}while(propagated);
const x68000Version='native-x68000-1';
const x68000Files=new Set(['native_genesis_x68000.js','native_genesis_synth.js','native_genesis_worker.js',
  'playground_runtime.js','playground_audio_engine.js','playground.js']);
do {propagated=false;for(const {name,source}of sources){
  if(x68000Files.has(name))continue;
  const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
  if(imports.some(match=>x68000Files.has(match[1]))){x68000Files.add(name);propagated=true;}
}}while(propagated);
const masterSystemVersion='native-master-system-1';
const masterSystemFiles=new Set(['native_genesis_master_system.js','native_genesis_synth.js','native_genesis_worker.js',
  'playground_runtime.js','playground_audio_engine.js','playground.js']);
do {propagated=false;for(const {name,source}of sources){
  if(masterSystemFiles.has(name))continue;
  const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
  if(imports.some(match=>masterSystemFiles.has(match[1]))){masterSystemFiles.add(name);propagated=true;}
}}while(propagated);
const msxNativeVersion='native-msx-1';
const msxNativeFiles=new Set(['native_genesis_msx.js','native_genesis_opll.js','native_genesis_voice_endpoint.js',
  'native_genesis_master_system.js','native_genesis_synth.js','native_genesis_worker.js',
  'playground_runtime.js','playground_audio_engine.js','playground.js']);
do {propagated=false;for(const {name,source}of sources){
  if(msxNativeFiles.has(name))continue;
  const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
  if(imports.some(match=>msxNativeFiles.has(match[1]))){msxNativeFiles.add(name);propagated=true;}
}}while(propagated);
const oplNativeVersion='native-opl-1';
const oplNativeFiles=new Set(['native_genesis_opl.js','native_genesis_synth.js','native_genesis_worker.js',
  'playground_runtime.js','playground_audio_engine.js','playground.js']);
do {propagated=false;for(const {name,source}of sources){
  if(oplNativeFiles.has(name))continue;
  const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
  if(imports.some(match=>oplNativeFiles.has(match[1]))){oplNativeFiles.add(name);propagated=true;}
}}while(propagated);
const gameGearNativeVersion='native-game-gear-1';
const gameGearNativeFiles=new Set(['native_genesis_game_gear.js','native_genesis_segapsg.js','native_genesis_master_system.js',
  'native_genesis_synth.js','playground_audio_engine.js','playground.js']);
do {propagated=false;for(const {name,source}of sources){
  if(gameGearNativeFiles.has(name))continue;
  const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
  if(imports.some(match=>gameGearNativeFiles.has(match[1]))){gameGearNativeFiles.add(name);propagated=true;}
}}while(propagated);
const msxAudioNativeVersion='native-msx-audio-1';
const msxAudioNativeFiles=new Set(['native_genesis_msx_audio.js','native_genesis_opl.js','native_genesis_synth.js',
  'native_genesis_worker.js','playground_runtime.js','playground_audio_engine.js','playground.js']);
do {propagated=false;for(const {name,source}of sources){
  if(msxAudioNativeFiles.has(name))continue;
  const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
  if(imports.some(match=>msxAudioNativeFiles.has(match[1]))){msxAudioNativeFiles.add(name);propagated=true;}
}}while(propagated);
const ym2203NativeVersion='native-ym2203-1';
const ym2203NativeFiles=new Set(['playground_operator_tab.js','native_genesis_ym2203.js','native_genesis_synth.js','native_genesis_worker.js',
  'playground_runtime.js','playground_worker_chip.js','playground_audio_engine.js','playground.js']);
do {propagated=false;for(const {name,source}of sources){
  if(ym2203NativeFiles.has(name))continue;
  const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
  if(imports.some(match=>ym2203NativeFiles.has(match[1]))){ym2203NativeFiles.add(name);propagated=true;}
}}while(propagated);
const nativeDesktopVersion='y8950-adpcm-ui-1';
const nativeDesktopFiles=new Set(['y8950_adpcm.js','playground_native_primary.js','playground_performance_processor.js','native_genesis_synth.js','native_genesis_extra_segapsg.js','native_genesis_extra_ym2612.js','native_genesis_extra_ym2203.js','native_genesis_extra_ym2608.js','native_genesis_extra_ym2610.js','native_genesis_extra_ym2151.js','native_genesis_extra_ym2413.js','native_genesis_extra_ay8910.js','native_genesis_extra_register_voice.js','native_genesis_extra_opl.js','native_genesis_extra_rf5c164.js','native_genesis_extra_okim6258.js','native_genesis_extra_gameboy.js','native_genesis_extra_nes.js','native_genesis_extra_huc6280.js','native_genesis_extra_dx7.js','native_genesis_extra_pwm.js','native_genesis_extra_snes.js','native_genesis_extra_spc.js','playground_spc.js','playground_performance_sender.js','native_genesis_snes.js','playground_snes.js','playground_snes_inspector.js','playground_snes_voice_panel.js','pwm32x_playback.js','playground_dx7.js','native_genesis_voice_endpoint.js','playground_huc6280.js','playground_nes.js','playground_gameboy.js','playground_okim6258.js','okim6258synth.js','playground_rf5c164.js','playground_opl.js','playground_keyboard_channels.js','playground_ym2413.js','playground_ay8910.js','playground_ym2151.js','playground_chip_tabs.js','opn_ssg_retained.js','native_genesis_extra_chip.js','playground_extra_fm_editor.js','playground_opn_ssg_editor.js','playground_opna_sample_editor.js','playground_opnb_sample_editor.js','playground_operator_tab.js','playground_operator_keyboard.js','playground_ui.js','native_genesis_worker.js','playground_runtime.js','playground_logic_worker.js','playground_worker_chip.js','soundchip_mixer.js','playground_audio_endpoint.js','playground_mixer.js','playground_mixer.css','playground_mixer_state.js','playground_audio_engine.js','playground_audio_diagnostics.js','playground.js']);
for(const name of ['y8950_adpcm_preview.js','native_genesis_y8950_inspector.js','playground_y8950_adpcm_panel.js','playground_opl_voice_panel.js','playground_audio_input.js','playground_chip_inspector.js','playground_native_sample_editor.js'])nativeDesktopFiles.add(name);
// Cleanup ordering and the shared scene catalog ship with this revision too.
for(const name of ['playground_soundchip_options.js','playground_opn.js','playground_opn_audio.js','playground_opn_worklet.js','playground_performance_processor.js','playground_live.js','playground_examples.js','playground_mode_examples.js','playground_mixer_defaults.js'])nativeDesktopFiles.add(name);
do {propagated=false;for(const {name,source}of sources){
  if(nativeDesktopFiles.has(name))continue;
  const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
  if(imports.some(match=>nativeDesktopFiles.has(match[1]))){nativeDesktopFiles.add(name);propagated=true;}
}}while(propagated);
// Roll out the fixed AY/YM profile and its importers together. Other machines
// retain their existing chip profile and calibration.
const atariVersion='atari-st-mode-3';
const atariFiles=new Set(['playground_ay8910_audio.js','playground_ay8910_worklet.js',
  'native_runtime_synth.js','playground_runtime.js','playground.js','playground_mode.js',
  'playground_mode_examples.js','playground_examples.js','playground_mode_keyboard.js',
  'playground_mode_project.js','playground_mode_starters.js','playground_declarations.js',
  'playground_monaco.js','playground_monaco_completion.js','playground_ay8910_voice_panel.js',
  'playground_chip_tabs.js','playground_audio_engine.js','playground_mixer_defaults.js']);
do {propagated=false;for(const {name,source}of sources){
  if(atariFiles.has(name))continue;
  const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
  if(imports.some(match=>atariFiles.has(match[1]))){atariFiles.add(name);propagated=true;}
}}while(propagated);
const wonderswanVersion='wonderswan-pcm-timeline-1';
const wonderswanFiles=new Set(['wonderswan.js','wonderswansynth.js','wonderswan_timeline.js','playground_wonderswan.js','playground_wonderswan_audio.js','playground_wonderswan_worklet.js','playground_wonderswan_inspector.js','playground_wonderswan_voice_panel.js','playground_keyboard_channels.js','playground_performance_processor.js','playground_native_primary.js','native_runtime_synth.js','tetorica_synth.js','playground_soundchips.js','playground_runtime.js','playground_logic_worker.js','playground_chip_clock.js','playground.js','playground_ui.js','playground_mode.js','playground_mode_examples.js','playground_examples.js','playground_mode_keyboard.js','playground_mode_project.js','playground_mode_starters.js','playground_declarations.js','playground_monaco.js','playground_monaco_completion.js','playground_chip_tabs.js','playground_operator_keyboard.js','playground_workbench.js','playground_audio_engine.js','playground_mixer_defaults.js']);
for(const name of ['native_genesis_wonderswan.js','native_genesis_extra_wonderswan.js','native_genesis_synth.js','native_genesis_worker.js','native_genesis_extra_chip.js'])wonderswanFiles.add(name);
do {propagated=false;for(const {name,source}of sources){
  if(wonderswanFiles.has(name))continue;
  const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
  if(imports.some(match=>wonderswanFiles.has(match[1]))){wonderswanFiles.add(name);propagated=true;}
}}while(propagated);
// VGM Analyzer's WonderSwan commands require the new player and parser together.
// Scope this to their two module URLs; canonical package imports stay untouched.
const vgmVersion='pokey-vgm-1';
const vgmFiles=new Set(['ym2612vgm.js','vgmplayer.js']);
// Import UI and code generation require the matching sample-timeline audio runtime.
const wonderswanImportFiles=new Set(['playground.js','playground_vgm_import.js','wonderswan_vgm_import.js']);
const pokeyVersion='pokey-mode-1';
const pokeyFiles=new Set(['pokey.js','pokeysynth.js','pokeyaudioengine.js','playground_pokey.js','playground_pokey_audio.js','playground_pokey_worklet.js','playground_pokey_inspector.js','native_genesis_pokey.js','native_genesis_extra_pokey.js','soundchip.js','soundchip_worklet.js','soundchip-output-worklet.js','chip_worklet_transport.js','native_runtime_synth.js','native_genesis_synth.js','native_genesis_worker.js','native_genesis_extra_chip.js','playground_runtime.js','playground_logic_worker.js','playground_performance_processor.js','playground_native_primary.js','playground_soundchips.js','playground_soundchip_options.js','playground_chip_clock.js','playground_keyboard_channels.js','playground_mode.js','playground_mode_examples.js','playground_mode_keyboard.js','playground_audio_engine.js','playground_mixer_defaults.js']);
do {propagated=false;for(const {name,source}of sources){
  if(pokeyFiles.has(name))continue;
  const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
  if(imports.some(match=>pokeyFiles.has(match[1]))){pokeyFiles.add(name);propagated=true;}
}}while(propagated);
const pokeyImportFiles=new Set(['pokey_timeline.js','pokey_timeline_builder.js','playground_pokey.js','playground_pokey_worklet.js','native_genesis_extra_pokey.js','native_genesis_worker.js','playground_runtime.js','playground.js','playground_vgm_import.js','pokey_vgm_import.js']);
do {propagated=false;for(const {name,source}of sources){
  if(pokeyImportFiles.has(name))continue;
  const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
  if(imports.some(match=>pokeyImportFiles.has(match[1]))){pokeyImportFiles.add(name);propagated=true;}
}}while(propagated);
// Stage, control transport and their importers must agree on the bounded upload
// protocol. Seed only changed entry points, then follow reverse dependencies.
const pokeyPrepareVersion='pokey-prepare-1';
const pokeyPrepareFiles=new Set(['pokey_timeline_upload.js','playground_pokey.js','playground_pokey_worklet.js','playground_performance_sender.js','playground_chip_clock.js','playground_native_primary.js','playground_runtime.js']);
do {propagated=false;for(const {name,source}of sources){
  if(pokeyPrepareFiles.has(name))continue;
  const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
  if(imports.some(match=>pokeyPrepareFiles.has(match[1]))){pokeyPrepareFiles.add(name);propagated=true;}
}}while(propagated);
// Roll out the Operators panel and its applied-state reader with their callers.
const pokeyVoiceVersion='pokey-voice-1';
const pokeyVoiceFiles=new Set(['playground_pokey_voice_panel.js','playground_pokey_inspector.js','playground_pokey_worklet.js','playground_chip_inspector.js','playground_chip_tabs.js','playground_workbench.js','playground_operator_keyboard.js','playground_ui.js','playground.js','playground_mode.js']);
do {propagated=false;for(const {name,source}of sources){
  if(pokeyVoiceFiles.has(name))continue;
  const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
  if(imports.some(match=>pokeyVoiceFiles.has(match[1]))){pokeyVoiceFiles.add(name);propagated=true;}
}}while(propagated);
const cddaFiles=new Set(['cdda_source.js','cdda_pcm.js','cdda_player.js','cdda_audio.js','cdda_worklet.js','cdda_native.js','cdda_offline.js','playground_runtime.js','playground_logic_worker.js','playground.js']);
const pcEngineCdFiles=new Set(['msm5205_pcm.js','msm5205_sample.js','msm5205_player.js','msm5205_audio.js','msm5205_worklet.js','msm5205_native.js','playground_runtime.js','playground_logic_worker.js','native_genesis_synth.js','playground.js','playground_mode.js','playground_audio_engine.js','playground_declarations.js','playground_mixer_defaults.js','playground_monaco_completion.js','playground_monaco.js','playground_workbench.js']);
const cdrom2PanelFiles=new Set(['playground_cdrom2_audio_panels.js','playground_ui.js','playground_workbench.js','playground_mode.js','playground_runtime.js','playground.js']);
// The Mega-CD source list and new-cassette code must arrive with its fourth tab.
// Audio processors and the shared CD-DA endpoint retain their existing versions.
const megaCdCddaFiles=new Set(['playground.js','playground_mode.js',
  'playground_mode_examples.js','playground_examples.js','playground_mode_starters.js']);
// The editor, its Worker protocol and the comparison helper ship together.
const gameboySampleFiles=new Set(['playground.js','playground_audio_input.js',
  'playground_sample_editor_worker.js','playground_sample_editor.css','playground_sample_gameboy_preview.js']);
// The new pure encoder and its Main/Worker globals must arrive together.
const brrEncoderFiles=new Set(['snes_brr_encoder.js','playground_runtime.js',
  'playground_logic_worker.js','playground.js','playground_examples.js',
  'playground_mode_examples.js','playground_monaco.js','playground_monaco_definitions.js']);
// ADPCM-A preparation is shared by the two Neo Geo modes.
const adpcmAEncoderFiles=new Set(['adpcm_a_sample.js','playground_runtime.js',
  'playground_logic_worker.js','playground.js','playground_examples.js',
  'playground_mode_examples.js','playground_monaco.js','playground_monaco_definitions.js']);
const ps1ModeFiles=new Set(['ps1_spu.js','ps1synth.js','ps1_resampler.js','playground_ps1.js','playground_ps1_audio.js','playground_ps1_worklet.js','playground_ps1_inspector.js',
  'native_runtime_synth.js','tetorica_synth.js','playground_runtime.js','playground_logic_worker.js','playground_native_primary.js','playground_soundchips.js','playground_performance_processor.js','playground_performance_sender.js','playground_performance_notes.js','playground_chip_inspector.js','playground_keyboard_channels.js',
  'playground.js','playground_ui.js','playground_workbench.js','playground_operator_keyboard.js','playground_monaco_completion.js','playground_mixer_defaults.js','playground_mode.js','playground_examples.js','playground_mode_examples.js','playground_mode_keyboard.js','playground_chip_tabs.js','playground_ps1_voice_panel.js','playground_declarations.js']);
do {propagated=false;for(const {name,source}of sources){
  if(ps1ModeFiles.has(name))continue;
  const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
  if(imports.some(match=>ps1ModeFiles.has(match[1]))){ps1ModeFiles.add(name);propagated=true;}
}}while(propagated);
const previousRevisionFor=name=>adpcmAEncoderFiles.has(name)?'adpcm-a-encoder-1':brrEncoderFiles.has(name)?'snes-brr-encoder-1':gameboySampleFiles.has(name)?'gameboy-sample-preview-1':megaCdCddaFiles.has(name)?'mega-cd-cdda-1':cdrom2PanelFiles.has(name)?'cdrom2-panels-1':pcEngineCdFiles.has(name)?'pcengine-cd-1':cddaFiles.has(name)?'cdda-pcm-1':pokeyVoiceFiles.has(name)?pokeyVoiceVersion:pokeyPrepareFiles.has(name)?pokeyPrepareVersion:pokeyImportFiles.has(name)?'pokey-import-1':pokeyFiles.has(name)?pokeyVersion:wonderswanImportFiles.has(name)?'wonderswan-import-3':vgmFiles.has(name)?vgmVersion:wonderswanFiles.has(name)?wonderswanVersion:atariFiles.has(name)?atariVersion:nativeDesktopFiles.has(name)?nativeDesktopVersion:ym2203NativeFiles.has(name)?ym2203NativeVersion:msxAudioNativeFiles.has(name)?msxAudioNativeVersion:gameGearNativeFiles.has(name)?gameGearNativeVersion:oplNativeFiles.has(name)?oplNativeVersion:msxNativeFiles.has(name)?msxNativeVersion:masterSystemFiles.has(name)?masterSystemVersion:x68000Files.has(name)?x68000Version:neoGeoFiles.has(name)?neoGeoVersion:pc98Files.has(name)?pc98Version:pwmFiles.has(name)?pwmVersion:consoleFiles.has(name)?consoleVersion:nesFiles.has(name)?nesVersion:pageRevisions[name]??(megaCdFiles.has(name)?megaCdVersion:segaFiles.has(name)?segaVersion:audioFiles.has(name)?audioVersion:revisions[name]??version);
const ps1EncoderFiles=new Set(['ps1_adpcm_encoder.js','playground_runtime.js','playground_logic_worker.js',
  'playground.js','playground_examples.js','playground_mode_examples.js','playground_monaco.js','playground_monaco_definitions.js']);
const ps1SampleFiles=new Set(['playground_sample_ps1.js','playground_sample_ps1_preview.js',
  'playground_sample_instrument.js','playground_runtime.js','playground_logic_worker.js',
  'playground.js','playground_audio_input.js','playground_sample_editor_worker.js','playground_sample_editor.css',
  'playground_examples.js','playground_mode_examples.js']);
const ps1VoiceFiles=new Set(['ps1_parameters.js','ps1synth.js','playground_ps1.js','playground_ps1_audio.js',
  'playground_ps1_worklet.js','playground_ps1_inspector.js','playground_ps1_voice_panel.js',
  'playground_chip_tabs.js','playground_chip_tabs.css','playground_performance_processor.js',
  'playground_native_primary.js','playground_runtime.js','playground_logic_worker.js','playground.js',
  'playground_sample_ps1_preview.js','playground_sample_editor_worker.js','playground_audio_input.js']);
const ps1WaveFiles=new Set(['ps1_waveform.js','ps1synth.js','playground_ps1.js','playground_ps1_audio.js',
  'playground_ps1_worklet.js','playground_ps1_inspector.js','playground_ps1_voice_panel.js',
  'playground_chip_inspector.js','playground_chip_tabs.js','playground_native_primary.js',
  'playground_runtime.js','playground_logic_worker.js','playground.js',
  'playground_sample_ps1_preview.js','playground_sample_instrument.js','playground_sample_editor_worker.js','playground_audio_input.js']);
// Native PS1 transport and the endpoint routing must be refreshed together.
const ps1NativeFiles=new Set(['native_genesis_ps1.js','native_genesis_extra_ps1.js',
  'native_genesis_synth.js','native_genesis_extra_chip.js','native_genesis_worker.js',
  'playground_ps1.js','playground_runtime.js','playground_audio_engine.js','playground.js']);
do {propagated=false;for(const {name,source}of sources){
  if(ps1NativeFiles.has(name))continue;
  const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
  if(imports.some(match=>ps1NativeFiles.has(match[1]))){ps1NativeFiles.add(name);propagated=true;}
}}while(propagated);
// UI-only envelope editing: keep renderer and measured audio-source revisions.
const ps1EnvelopeFiles=new Set(['playground_ps1_envelope.js','playground_ps1_voice_panel.js',
  'playground_chip_tabs.js','playground_chip_tabs.css','playground_workbench.js','playground_ui.js','playground.js']);
// Explicit live controls require the updated SPU ABI in every audio endpoint.
const ps1LiveVersion='ps1-deferred-release-1';
const ps1LiveFiles=new Set(['ps1_spu.js','ps1synth.js','playground_ps1_inspector.js',
  'playground_ps1_worklet.js','playground_performance_processor.js','native_genesis_ps1.js',
  'playground_ps1_voice_panel.js','playground_chip_tabs.js','playground_workbench.js',
  'playground_ui.js','playground.js']);
do {propagated=false;for(const {name,source}of sources){
  if(ps1LiveFiles.has(name))continue;
  const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
  if(imports.some(match=>ps1LiveFiles.has(match[1]))){ps1LiveFiles.add(name);propagated=true;}
}}while(propagated);
// SCSP changes shared routing and the fixed-rate converter. Existing SPU core
// revisions remain independent of this new Playground entry point.
const scspFiles=new Set(['scsp.js','scspsynth.js','scsp_sample.js','playground_scsp.js','playground_scsp_audio.js',
  'playground_scsp_worklet.js','playground_scsp_inspector.js','pcm_44100_resampler.js','ps1_resampler.js',
  'native_runtime_synth.js','tetorica_synth.js','playground_native_primary.js','playground_runtime.js','playground_soundchips.js',
  'playground_logic_worker.js','playground_performance_processor.js','playground_performance_sender.js',
  'playground_keyboard_channels.js','playground_mode.js','playground_mode_keyboard.js','playground_examples.js',
  'playground_mode_examples.js','playground_example_order.js','playground_declarations.js',
  'playground_monaco_completion.js','playground_mixer_defaults.js','playground_chip_tabs.js',
  'playground_scsp_voice_panel.js','playground_ui.js','playground.js']);
const scspEditorFiles=new Set(['playground_scsp_voice_panel.js','playground_scsp_inspector.js','playground_scsp_worklet.js','playground_mode.js','playground_chip_tabs.js','playground_ui.js','playground.js']);
const revisionFor=name=>(scspFiles.has(name)||name==='playground_workbench.js')&&name!=='playground_mixer_defaults.js'?'scsp-pcm-files-1':['playground.js','playground_mixer_defaults.js'].includes(name)?'scsp-calibration-1':scspEditorFiles.has(name)?'scsp-editor-1':['playground.js','playground_workbench.js'].includes(name)?'scsp-layout-1':scspFiles.has(name)?'scsp-playground-1':ps1LiveFiles.has(name)?ps1LiveVersion:ps1EnvelopeFiles.has(name)?'ps1-envelope-drag-1':['playground.js','playground_mixer_defaults.js'].includes(name)?'pokey-mixer-calibration-1':ps1NativeFiles.has(name)?'ps1-native-1':ps1WaveFiles.has(name)?'ps1-pcm-waveform-1':ps1VoiceFiles.has(name)?'ps1-voice-editor-1':ps1SampleFiles.has(name)?'ps1-sample-editor-1':ps1EncoderFiles.has(name)?'ps1-adpcm-encoder-1':ps1ModeFiles.has(name)?'ps1-mode-1':previousRevisionFor(name);
const targets=[...new Set([
  ...scspFiles,
  ...ps1LiveFiles,
  ...ps1EnvelopeFiles,
  ...ps1ModeFiles,
  ...ps1EncoderFiles,
  ...ps1SampleFiles,
  ...ps1VoiceFiles,
  ...ps1WaveFiles,
  ...ps1NativeFiles,
  ...cddaFiles, ...pcEngineCdFiles, ...cdrom2PanelFiles,
  ...megaCdCddaFiles,
  ...gameboySampleFiles,
  ...brrEncoderFiles,
  ...adpcmAEncoderFiles,
  ...pokeyVoiceFiles,
  ...pokeyPrepareFiles,
  ...pokeyImportFiles,
  ...pokeyFiles,
  ...vgmFiles,
  ...wonderswanImportFiles,
  ...wonderswanFiles,
  ...atariFiles,
  ...nativeDesktopFiles,
  ...ym2203NativeFiles,
  ...msxAudioNativeFiles,
  ...gameGearNativeFiles,
  ...oplNativeFiles,
  ...msxNativeFiles,
  ...masterSystemFiles,
  ...x68000Files,
  ...neoGeoFiles,
  ...pc98Files,
  ...pwmFiles,
  ...consoleFiles,
  ...Object.keys(pageRevisions),
  ...segaFiles,
  ...megaCdFiles,
  ...nesFiles,
  ...audioFiles,
  ...pcmFiles,
  ...nativeFiles,
  'soundchip_mixer.js','megasynth.js','playground_clock.js','playground_runtime.js','playground_logic_worker.js','playground_performance_sender.js','playground_performance_host.js',
  'playground_rf5c164.js','playground_chip_inspector.js','playground_chip_inspector_state.js',
  'playground_segapsg_worklet.js','rf5c164-worklet.js','playground_pwm_worklet.js',
  'ym2612-worklet.js','ym2612-worklet-nuked.js','ym2203-worklet.js','ym2608-worklet.js','ym2610b-worklet.js',
  'playground_worker_chip.js','opn_fm_synth.js','playground_chip_clock.js',
  'gameboy_runtime_synth.js','gameboysynth.js','playground_gameboy.js','playground_gameboy_worklet.js',
  'tetorica_synth.js','tetorica_audio_runtime.js','opn_runtime_synth.js',
  'ym2203synth.js','ym2608synth.js','ym2610bsynth.js','ssgsynth.js',
  'playground_segapsg_audio.js','playground_rf5c164_audio.js','playground_pwm_audio.js',
  'soundchip_worklet.js','playground_performance_processor.js',
  'spc.js','spc_trace.js','spc_events.js','spc_performance.js','spc_pitch.js','spc_audio.js','spc-worklet.js','spc_resampler.js','spc_file.js','snes_brr.js',
  'snessynth.js','playground_snes.js','playground_snes_audio.js','playground_snes_worklet.js',
  'playground_soundchips.js','playground_spc.js','playground_spc_audio.js',
])];
const filenames=targets.map(name=>name.replaceAll('.', '\\.')).join('|');
// Include bare sibling worklet filenames as well as relative module imports and
// new URL() / Worker() defaults. Custom absolute URLs remain unchanged.
const shape=/(['"])((?:(?:\.\.?\/)+)?(?:js\/)?TARGET)(?:\?[^'"\s]*)?\1/g;
const references=new RegExp(shape.source.replace('TARGET','(?:'+filenames+')'),'g');
// Page modules also contain bare filenames as Monaco definition IDs. Only
// version relative imports there; those IDs must remain canonical filenames.
const pageShape=/(['"])((?:\.\.?\/)+(?:(?:js|synth)\/)?TARGET)(?:\?[^'"\s]*)?\1/g;
const pageReferences=new RegExp(pageShape.source.replace('TARGET','(?:'+filenames+')'),'g');
let changed=0;
for(const currentDirectory of [directory,join(directory,'../playground')])for(const name of await readdir(currentDirectory)){
  if(!name.endsWith('.js')&&!name.endsWith('.html'))continue;
  const path=join(currentDirectory,name),source=await readFile(path,'utf8');
  // Type-only JSDoc imports do not fetch runtime modules. Keep their existing
  // revision policy so a new machine cannot invalidate measured renderer bytes
  // merely by changing a comment. Runtime dependencies still receive PS1's revision.
  const pattern=currentDirectory===directory?references:pageReferences;
  const rewrite=(text,revision)=>text.replace(pattern,(_match,quote,path)=>quote+path+'?v='+revision(path.split('/').at(-1))+quote);
  let cursor=0,versioned='';
  for(const comment of source.matchAll(/\/\*[\s\S]*?\*\//g)){
    versioned+=rewrite(source.slice(cursor,comment.index),revisionFor)+rewrite(comment[0],previousRevisionFor);
    cursor=comment.index+comment[0].length;
  }
  versioned+=rewrite(source.slice(cursor),revisionFor);
  const next=versioned
    .replace(/(['"])((?:\.\.?\/)+generated\/ps1_spu_wasm\.(?:js|wasm))(?:\?[^'"\s]*)?\1/g,
      (_match,quote,path)=>quote+path+'?v='+ps1LiveVersion+quote)
    .replace(/(['"])((?:(?:\.\.?\/)+generated\/)?segapsg_wasm\.(?:js|wasm))(?:\?[^'"\s]*)?\1/g,
      (_match,quote,path)=>quote+path+'?v='+segaVersion+quote)
    .replace(/(['"])((?:\.\.?\/)+generated\/spc_wasm\.(?:js|wasm))(?:\?[^'"\s]*)?\1/g,
      (_match,quote,path)=>quote+path+'?v=spc-events-1'+quote)
    .replace(/(['"])((?:\.\.?\/)+generated\/nesapu_wasm\.(?:js|wasm))(?:\?[^'"\s]*)?\1/g,
      (_match,quote,path)=>quote+path+'?v='+nesVersion+quote)
    .replace(/(['"])((?:\.\.?\/)+generated\/pwm32x_wasm\.(?:js|wasm))(?:\?[^'"\s]*)?\1/g,
      (_match,quote,path)=>quote+path+'?v='+pwmVersion+quote);
  const final=next.replace(/(['"])((?:\.\.?\/)+generated\/wonderswan_wasm\.(?:js|wasm))(?:\?[^'"\s]*)?\1/g,(_match,quote,path)=>quote+path+'?v='+wonderswanVersion+quote);
  if(final!==source){await writeFile(path,final);changed++;}
}
console.log('Versioned Playground browser runtime references in '+changed+' modules ('+version+').');
