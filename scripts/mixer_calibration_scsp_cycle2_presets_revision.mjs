/** Exact Cycle2 v11 portable-preset revision. Restores complete reviewed
 * predecessor bodies before the older Synth and Playground proof layers. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createScspCycle2UiRevisionReadContext} from './mixer_calibration_scsp_cycle2_ui_revision.mjs';
export const SCSP_CYCLE2_PRESETS_BASE='6ca7c946bba5c8a84610dd4b3b7542e71562f89f';
export const SCSP_CYCLE2_PRESETS_RECEIPT='docs/issues/scsp_cycle2_presets_source_revision_01.json';
export const SCSP_CYCLE2_PRESETS_PIN='f221eecece92dc69b6e5a41d5ffa3155d310325538807369ca66f1afd479d823';
export const SCSP_CYCLE2_PRESETS_SOURCES=Object.freeze([
  ...['patch.js','synth.js','code_declarations.js','code_declarations.test.mjs','code_files.js','code_files.test.mjs','code_project.js','code_host.js','audio.js','instrument.js','processor.js','ssf_capture.js','index.html','fm_cycle2_config.test.mjs','fm_cycle2.test.mjs'].map(name=>'docs/synth-scsp/'+name),
  'scripts/check_scsp_synth_cycle2_browser.cjs',
  'scripts/mixer_calibration_scsp_synth_cycle2_revision.mjs',
  'scripts/mixer_calibration_scsp_synth_cycle2_revision.test.mjs',
  'scripts/record_scsp_synth_cycle2_revision.mjs',
  'scripts/record_scsp_synth_cycle2_default_parity.mjs',
  'scripts/scsp_synth_cycle2_default_parity.test.mjs',
]);
export const SCSP_CYCLE2_PRESETS_UNCHANGED=Object.freeze([
  ...['scsp.js','scspsynth.js','scsp_dsp.js','scsp_dsp_program.js','scsp_dsp_coefficients.js','scsp_dsp_assembler.js','soundchip_pitch.js','pcm_44100_resampler.js','soundchip_mixer_presets.js'].flatMap(name=>['tetorica_src/runtime/'+name,'docs/js/'+name]),
  ...['scsp_wasm.js','scsp_wasm.wasm'].flatMap(name=>['tetorica_src/runtime/generated/'+name,'docs/generated/'+name]),
  'third_party/tetorica-soundchip-native/vendor/mame-scsp/scsp.cpp','third_party/tetorica-soundchip-native/vendor/mame-scsp/scsp.h',
  'docs/playground/playground_mixer_defaults.js',
  'docs/playground/playground_examples.js','docs/playground/playground_mode_examples.js','docs/playground/playground.js',
  ...['synth.css','preset.js','release_guard.js','dsp.js','code_endpoint.js','fm_custom_view.js','routing.js'].map(name=>'docs/synth-scsp/'+name),
]);
export const SCSP_CYCLE2_PRESETS_RELATED=Object.freeze([
  ...SCSP_CYCLE2_PRESETS_UNCHANGED,
  'scripts/record_scsp_cycle2_presets_parity.mjs','scripts/scsp_cycle2_presets_parity.test.mjs',
  'scripts/mixer_calibration_scsp_cycle2_presets_revision.test.mjs',
  'docs/synth-scsp/fm_cycle2_presets.test.mjs',
]);
export const SCSP_CYCLE2_PRESETS_REPORTS=Object.freeze([
  'docs/issues/playground_scsp_cycle2_examples_source_revision_01.json',
  'docs/issues/scsp_synth_cycle2_source_revision_01.json',
  'docs/issues/scsp_synth_cycle2_default_parity_01.json',
  'docs/issues/scsp_cycle2_presets_parity_01.json',
]);
const root=fileURLToPath(new URL('../',import.meta.url));
const read=url=>readFileSync(url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[0-9a-f]{64}$/.test(value.sha256);
const matches=(bytes,expected)=>record(expected)&&Buffer.byteLength(bytes)===expected.bytes&&sha(bytes)===expected.sha256;
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const fail=message=>{throw Error('Invalid exact SCSP Cycle2 preset calibration revision: '+message);};
const predecessorReaders=new WeakSet();
function sourceName(path){
  if(typeof path!=='string')return path;
  if(path.startsWith('synth-scsp/'))return 'docs/'+path;
  return path;
}
function evidence(readSource){
  const value=JSON.parse(readSource(new URL('../'+SCSP_CYCLE2_PRESETS_RECEIPT,import.meta.url)));
  if(sha(JSON.stringify(value))!==SCSP_CYCLE2_PRESETS_PIN)fail('independently pinned receipt changed');
  if(value.schemaVersion!==1||value.scope!=='scsp-cycle2-v11-portable-presets'||
    value.baseCommit!==SCSP_CYCLE2_PRESETS_BASE||
    !keys(value.sources,SCSP_CYCLE2_PRESETS_SOURCES)||
    !keys(value.relatedSources,SCSP_CYCLE2_PRESETS_RELATED)||
    !keys(value.reports,SCSP_CYCLE2_PRESETS_REPORTS))fail('exact source, dependency or report inventory changed');
  for(const path of SCSP_CYCLE2_PRESETS_SOURCES){
    const entry=value.sources[path];
    if(!record(entry?.before)||!record(entry.after)||!Array.isArray(entry.reverseHunks)||!entry.reverseHunks.length)fail('incomplete predecessor pair: '+path);
    let cursor=0;
    for(const hunk of entry.reverseHunks){
      if(!keys(hunk,['afterOffset','afterBytes','beforeText'])||!Number.isSafeInteger(hunk.afterOffset)||
        hunk.afterOffset<cursor||!Number.isSafeInteger(hunk.afterBytes)||hunk.afterBytes<0||
        hunk.afterOffset+hunk.afterBytes>entry.after.bytes||typeof hunk.beforeText!=='string')fail('invalid reverse hunk: '+path);
      cursor=hunk.afterOffset+hunk.afterBytes;
    }
  }
  for(const path of [...SCSP_CYCLE2_PRESETS_RELATED,...SCSP_CYCLE2_PRESETS_REPORTS])
    if(!record(value.relatedSources[path]??value.reports[path]))fail('invalid dependency record: '+path);
  return value;
}
function verifyDefaultParity(receipt,readSource){
  const report=JSON.parse(readSource(new URL('../docs/issues/scsp_cycle2_presets_parity_01.json',import.meta.url)));
  if(report.schemaVersion!==1||report.scope!=='scsp-cycle2-presets-legacy-and-cycle-sound-parity'||report.baseCommit!==SCSP_CYCLE2_PRESETS_BASE||report.deviceOpened!==false||!Array.isArray(report.cases)||report.cases.length!==206)fail('prior-default parity coverage changed');
  const counts={pcm:24,fm:18,custom2:24,self2:32,'custom-multi':12,'single-self-multi':40,'multiple-self-multi':16,cycle2:40},seen=new Set();
  for(const value of report.cases){
    if(![44100,48000].includes(value.sampleRate)||!Object.hasOwn(counts,value.kind)||!value.exactPcmEqual||!value.exactRamEqual||!value.legacyStateEqual||!value.exactRegistersEqual||!value.exactEffectiveWriteTraceEqual||(value.kind!=='cycle2'&&!value.exactPresetEqual)||!value.exactRegisterSnapshotsEqual||!value.exactRawStackEqual||!value.exactStateSnapshotsEqual)fail('prior-default parity result changed');
    if(value.kind==='cycle2'&&(value.portableComparison!=='new-v11-predecessor-refused-export'||value.cyclePresetVersion!==11||value.portableExportDidNotWrite!==true))fail('new Cycle portable export scope changed');
    counts[value.kind]--;
    const key=JSON.stringify([value.kind,value.sampleRate,value.scenario,value.frequencyHz,value.dspEnabled,value.mode,value.algorithm,value.graph,value.outputs,value.selfTarget,value.depth,value.depths]);
    if(seen.has(key))fail('duplicate parity case');seen.add(key);
    if(value.kind==='multiple-self-multi'&&(value.presetVersion!==10||value.selfRetriggerTested!==true||value.selfRetriggerOwner!=='code'))fail('prior multiple-Self parity changed');
  }
  if(Object.values(counts).some(count=>count!==0))fail('missing parity cases');
  const names=['docs/synth-scsp/routing.js','docs/synth-scsp/patch.js','docs/synth-scsp/instrument.js'];
  if(!keys(report.sources,names)||!keys(report.predecessors,names))fail('parity source inventory changed');
  for(const name of names){const entry=receipt.sources[name];for(const [key,side]of [['sources','after'],['predecessors','before']]){const expected=entry?.[side]??receipt.relatedSources[name];if(report[key][name].bytes!==expected.bytes||report[key][name].sha256!==expected.sha256)fail('parity source changed: '+name);}}
  const wasm=receipt.relatedSources['docs/generated/scsp_wasm.wasm'];
  if(report.binary?.bytes!==wasm.bytes||report.binary.sha256!==wasm.sha256)fail('parity WASM changed');
}

function createRestorer(readSource,snapshot=false){
  let receipt,verified=false;
  return(path,bytes)=>{
    const name=sourceName(path);
    if(!SCSP_CYCLE2_PRESETS_SOURCES.includes(name))return bytes;
    receipt=snapshot?receipt??evidence(readSource):evidence(readSource);
    const entry=receipt.sources[name];if(!matches(bytes,entry.after))return bytes;
    if(!verified){
      for(const dependency of [...SCSP_CYCLE2_PRESETS_SOURCES,...SCSP_CYCLE2_PRESETS_RELATED,...SCSP_CYCLE2_PRESETS_REPORTS]){
        const expected=receipt.sources[dependency]?.after??receipt.relatedSources[dependency]??receipt.reports[dependency];
        if(!matches(readSource(new URL('../'+dependency,import.meta.url)),expected))fail('pinned source/report dependency changed: '+dependency);
      }
      verifyDefaultParity(receipt,readSource);verified=snapshot;
    }
    const current=Buffer.from(bytes),parts=[];let cursor=0;
    for(const hunk of entry.reverseHunks){parts.push(current.subarray(cursor,hunk.afterOffset),Buffer.from(hunk.beforeText));cursor=hunk.afterOffset+hunk.afterBytes;}
    parts.push(current.subarray(cursor));const before=Buffer.concat(parts);
    if(!matches(before,entry.before))fail('complete predecessor reconstruction failed: '+name);
    return before;
  };
}
export function restoreMixerCalibrationScspCycle2PresetsRevision(path,bytes,{readSource=read}={}){const latest=createScspCycle2UiRevisionReadContext(readSource);return createRestorer(latest.readSource)(path,latest.restore(path,bytes));}
export function createScspCycle2PresetsRevisionReadContext(readSource=read){
  const latest=createScspCycle2UiRevisionReadContext(readSource);readSource=latest.readSource;
  const originals=new Map(),predecessors=new Map();
  const original=url=>{const key=url instanceof URL?url.href:url;if(!originals.has(key))originals.set(key,Buffer.from(readSource(url)));return originals.get(key);};
  const restore=createRestorer(original,true);
  const reader=url=>{const key=url instanceof URL?url.href:url;if(!predecessors.has(key)){const bytes=original(url),name=url instanceof URL&&url.protocol==='file:'?relative(root,fileURLToPath(url)).replaceAll('\\','/'):null;predecessors.set(key,name===null?bytes:restore(name,bytes));}return predecessors.get(key);};
  return {restore:(path,bytes)=>restore(path,latest.restore(path,bytes)),readSource:reader};
}
