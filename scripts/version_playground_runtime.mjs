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
  'playground_sample_edit.js','playground_sample_instrument.js','playground_performance_sender.js',
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
const nativeDesktopVersion='native-extra-okim6258-1';
const nativeDesktopFiles=new Set(['native_genesis_synth.js','native_genesis_extra_segapsg.js','native_genesis_extra_ym2612.js','native_genesis_extra_ym2203.js','native_genesis_extra_ym2608.js','native_genesis_extra_ym2610.js','native_genesis_extra_ym2151.js','native_genesis_extra_ym2413.js','native_genesis_extra_ay8910.js','native_genesis_extra_register_voice.js','native_genesis_extra_opl.js','native_genesis_extra_rf5c164.js','native_genesis_extra_okim6258.js','playground_okim6258.js','okim6258synth.js','playground_rf5c164.js','playground_opl.js','playground_keyboard_channels.js','playground_ym2413.js','playground_ay8910.js','playground_ym2151.js','playground_chip_tabs.js','opn_ssg_retained.js','native_genesis_extra_chip.js','playground_extra_fm_editor.js','playground_opn_ssg_editor.js','playground_opna_sample_editor.js','playground_opnb_sample_editor.js','playground_operator_tab.js','playground_operator_keyboard.js','playground_ui.js','native_genesis_worker.js','playground_runtime.js','playground_logic_worker.js','playground_worker_chip.js','soundchip_mixer.js','playground_audio_endpoint.js','playground_mixer.js','playground_mixer.css','playground_mixer_state.js','playground_audio_engine.js','playground_audio_diagnostics.js','playground.js']);
do {propagated=false;for(const {name,source}of sources){
  if(nativeDesktopFiles.has(name))continue;
  const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
  if(imports.some(match=>nativeDesktopFiles.has(match[1]))){nativeDesktopFiles.add(name);propagated=true;}
}}while(propagated);
const revisionFor=name=>nativeDesktopFiles.has(name)?nativeDesktopVersion:ym2203NativeFiles.has(name)?ym2203NativeVersion:msxAudioNativeFiles.has(name)?msxAudioNativeVersion:gameGearNativeFiles.has(name)?gameGearNativeVersion:oplNativeFiles.has(name)?oplNativeVersion:msxNativeFiles.has(name)?msxNativeVersion:masterSystemFiles.has(name)?masterSystemVersion:x68000Files.has(name)?x68000Version:neoGeoFiles.has(name)?neoGeoVersion:pc98Files.has(name)?pc98Version:pwmFiles.has(name)?pwmVersion:consoleFiles.has(name)?consoleVersion:nesFiles.has(name)?nesVersion:pageRevisions[name]??(megaCdFiles.has(name)?megaCdVersion:segaFiles.has(name)?segaVersion:audioFiles.has(name)?audioVersion:revisions[name]??version);
const targets=[...new Set([
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
  const next=source.replace(currentDirectory===directory?references:pageReferences,(_match,quote,path)=>quote+path+'?v='+revisionFor(path.split('/').at(-1))+quote)
    .replace(/(['"])((?:(?:\.\.?\/)+generated\/)?segapsg_wasm\.(?:js|wasm))(?:\?[^'"\s]*)?\1/g,
      (_match,quote,path)=>quote+path+'?v='+segaVersion+quote)
    .replace(/(['"])((?:\.\.?\/)+generated\/spc_wasm\.(?:js|wasm))(?:\?[^'"\s]*)?\1/g,
      (_match,quote,path)=>quote+path+'?v=spc-events-1'+quote)
    .replace(/(['"])((?:\.\.?\/)+generated\/nesapu_wasm\.(?:js|wasm))(?:\?[^'"\s]*)?\1/g,
      (_match,quote,path)=>quote+path+'?v='+nesVersion+quote)
    .replace(/(['"])((?:\.\.?\/)+generated\/pwm32x_wasm\.(?:js|wasm))(?:\?[^'"\s]*)?\1/g,
      (_match,quote,path)=>quote+path+'?v='+pwmVersion+quote);
  if(next!==source){await writeFile(path,next);changed++;}
}
console.log('Versioned Playground browser runtime references in '+changed+' modules ('+version+').');
