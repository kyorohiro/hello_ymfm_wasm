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
let propagated;
do {
  propagated=false;
  for(const {name,source} of sources) {
    if(audioFiles.has(name))continue;
    const imports=[...source.matchAll(/['"](?:\.\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
    if(imports.some(match=>audioFiles.has(match[1]))) {audioFiles.add(name);propagated=true;}
  }
} while(propagated);
for(const name of ['playground.js','playground_mode.js','playground_operator_tab.js','playground_tfi_editor.js'])audioFiles.add(name);
const pageRevisions={'playground.js':'vgm-frequency-order-1','playground_mode_starters.js':'mode-choice-1',
  ...Object.fromEntries(['ym2612vgm.js','ym2203vgm.js','ym2608vgm.js','ym2610bvgm.js',
    'playground_vgm_import.js','rf5c164_vgm_export.js','ym2608_vgm_import.js','playground_vgm_presets.js']
    .map(name=>[name,'vgm-frequency-order-1']))};
const revisionFor=name=>pageRevisions[name]??(audioFiles.has(name)?audioVersion:revisions[name]??version);
const targets=[...new Set([
  ...Object.keys(pageRevisions),
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
const pageShape=/(['"])((?:\.\.?\/)+(?:js\/)?TARGET)(?:\?[^'"\s]*)?\1/g;
const pageReferences=new RegExp(pageShape.source.replace('TARGET','(?:'+filenames+')'),'g');
let changed=0;
for(const currentDirectory of [directory,join(directory,'../playground')])for(const name of await readdir(currentDirectory)){
  if(!name.endsWith('.js')&&!name.endsWith('.html'))continue;
  const path=join(currentDirectory,name),source=await readFile(path,'utf8');
  const next=source.replace(currentDirectory===directory?references:pageReferences,(_match,quote,path)=>quote+path+'?v='+revisionFor(path.split('/').at(-1))+quote)
    .replace(/(['"])((?:\.\.?\/)+generated\/spc_wasm\.(?:js|wasm))(?:\?[^'"\s]*)?\1/g,
      (_match,quote,path)=>quote+path+'?v=spc-events-1'+quote);
  if(next!==source){await writeFile(path,next);changed++;}
}
console.log('Versioned Playground browser runtime references in '+changed+' modules ('+version+').');
