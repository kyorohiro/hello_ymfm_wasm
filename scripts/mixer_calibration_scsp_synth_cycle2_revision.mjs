/** Exact bounded Cycle2 instrument/Code revision. Restores complete reviewed
 * predecessor bodies before the older Synth and Playground proof layers. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';
export const SCSP_SYNTH_CYCLE2_BASE='b92ee48e146a011d10e383dcbc2954626cccec1c';
export const SCSP_SYNTH_CYCLE2_RECEIPT='docs/issues/scsp_synth_cycle2_source_revision_01.json';
export const SCSP_SYNTH_CYCLE2_PIN='9a90620b202cca12c72e3198bc0c33577a6b498d461f38b2c3b1030f0efe27f8';
export const SCSP_SYNTH_CYCLE2_SOURCES=Object.freeze([
  ...['routing.js','patch.js','instrument.js','processor.js','code_declarations.js','code_declarations.test.mjs','synth.js','audio.js','audio.test.mjs','code_host.js','code_files.js','code_files.test.mjs','code_project.js','index.html','ssf_capture.js'].map(name=>'docs/synth-scsp/'+name),
  'scripts/mixer_calibration_playground_scsp_cycle2_examples_revision.mjs',
  'scripts/mixer_calibration_scsp_fm_multiple_self_revision.test.mjs',
  'scripts/record_scsp_fm_multiple_self_default_parity.mjs',
  'scripts/record_scsp_fm_multiple_self_revision.mjs',
]);
export const SCSP_SYNTH_CYCLE2_UNCHANGED=Object.freeze([
  ...['scsp.js','scspsynth.js','scsp_dsp.js','scsp_dsp_program.js','scsp_dsp_coefficients.js','scsp_dsp_assembler.js','soundchip_pitch.js','pcm_44100_resampler.js','soundchip_mixer_presets.js'].flatMap(name=>['tetorica_src/runtime/'+name,'docs/js/'+name]),
  ...['scsp_wasm.js','scsp_wasm.wasm'].flatMap(name=>['tetorica_src/runtime/generated/'+name,'docs/generated/'+name]),
  'third_party/tetorica-soundchip-native/vendor/mame-scsp/scsp.cpp','third_party/tetorica-soundchip-native/vendor/mame-scsp/scsp.h',
  'docs/playground/playground_mixer_defaults.js',
  'docs/playground/playground_examples.js','docs/playground/playground_mode_examples.js','docs/playground/playground.js',
  ...['synth.css','preset.js','release_guard.js','dsp.js','code_endpoint.js','fm_custom_view.js'].map(name=>'docs/synth-scsp/'+name),
]);
export const SCSP_SYNTH_CYCLE2_RELATED=Object.freeze([
  ...SCSP_SYNTH_CYCLE2_UNCHANGED,
  'scripts/record_scsp_synth_cycle2_default_parity.mjs',
  'scripts/scsp_synth_cycle2_default_parity.test.mjs',
  'scripts/mixer_calibration_scsp_synth_cycle2_revision.test.mjs',
  'scripts/check_scsp_synth_cycle2_browser.cjs',
  'docs/synth-scsp/fm_cycle2.test.mjs','docs/synth-scsp/fm_cycle2_config.test.mjs',
]);
export const SCSP_SYNTH_CYCLE2_REPORTS=Object.freeze([
  'docs/issues/playground_scsp_cycle2_examples_source_revision_01.json',
  'docs/issues/scsp_fm_multiple_self_source_revision_01.json',
  'docs/issues/scsp_fm_multiple_self_default_parity_01.json',
  'docs/issues/scsp_synth_cycle2_default_parity_01.json',
]);
const root=fileURLToPath(new URL('../',import.meta.url));
const read=url=>readFileSync(url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[0-9a-f]{64}$/.test(value.sha256);
const matches=(bytes,expected)=>record(expected)&&Buffer.byteLength(bytes)===expected.bytes&&sha(bytes)===expected.sha256;
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const fail=message=>{throw Error('Invalid exact SCSP Synth Cycle2 calibration revision: '+message);};
const predecessorReaders=new WeakSet();
function sourceName(path){
  if(typeof path!=='string')return path;
  if(path.startsWith('synth-scsp/'))return 'docs/'+path;
  return path;
}
function evidence(readSource){
  const value=JSON.parse(readSource(new URL('../'+SCSP_SYNTH_CYCLE2_RECEIPT,import.meta.url)));
  if(sha(JSON.stringify(value))!==SCSP_SYNTH_CYCLE2_PIN)fail('independently pinned receipt changed');
  if(value.schemaVersion!==1||value.scope!=='scsp-synth-cycle2-instrument-and-code'||
    value.baseCommit!==SCSP_SYNTH_CYCLE2_BASE||
    !keys(value.sources,SCSP_SYNTH_CYCLE2_SOURCES)||
    !keys(value.relatedSources,SCSP_SYNTH_CYCLE2_RELATED)||
    !keys(value.reports,SCSP_SYNTH_CYCLE2_REPORTS))fail('exact source, dependency or report inventory changed');
  for(const path of SCSP_SYNTH_CYCLE2_SOURCES){
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
  for(const path of [...SCSP_SYNTH_CYCLE2_RELATED,...SCSP_SYNTH_CYCLE2_REPORTS])
    if(!record(value.relatedSources[path]??value.reports[path]))fail('invalid dependency record: '+path);
  return value;
}
function verifyDefaultParity(receipt,readSource){
  const report=JSON.parse(readSource(new URL('../docs/issues/scsp_synth_cycle2_default_parity_01.json',import.meta.url)));
  if(report.schemaVersion!==1||report.scope!=='scsp-synth-cycle2-prior-default-and-multiple-self-parity'||report.baseCommit!==SCSP_SYNTH_CYCLE2_BASE||report.deviceOpened!==false||!Array.isArray(report.cases)||report.cases.length!==166)fail('prior-default parity coverage changed');
  const counts={pcm:24,fm:18,custom2:24,self2:32,'custom-multi':12,'single-self-multi':40,'multiple-self-multi':16},seen=new Set();
  for(const value of report.cases){
    if(![44100,48000].includes(value.sampleRate)||!Object.hasOwn(counts,value.kind)||!value.exactPcmEqual||!value.exactRamEqual||!value.legacyStateEqual||!value.exactRegistersEqual||!value.exactEffectiveWriteTraceEqual||!value.exactPresetEqual||!value.exactRegisterSnapshotsEqual||!value.exactRawStackEqual||!value.exactStateSnapshotsEqual)fail('prior-default parity result changed');
    counts[value.kind]--;
    const key=JSON.stringify([value.kind,value.sampleRate,value.scenario,value.frequencyHz,value.dspEnabled,value.mode,value.algorithm,value.graph,value.outputs,value.selfTarget]);
    if(seen.has(key))fail('duplicate parity case');seen.add(key);
    if(value.kind==='multiple-self-multi'&&(value.presetVersion!==10||value.selfRetriggerTested!==true||value.selfRetriggerOwner!=='code'))fail('prior multiple-Self parity changed');
  }
  if(Object.values(counts).some(count=>count!==0))fail('missing parity cases');
  const names=['docs/synth-scsp/routing.js','docs/synth-scsp/patch.js','docs/synth-scsp/instrument.js'];
  if(!keys(report.sources,names)||!keys(report.predecessors,names))fail('parity source inventory changed');
  for(const name of names){const entry=receipt.sources[name];for(const [key,side]of [['sources','after'],['predecessors','before']])if(report[key][name].bytes!==entry[side].bytes||report[key][name].sha256!==entry[side].sha256)fail('parity source changed: '+name);}
  const wasm=receipt.relatedSources['docs/generated/scsp_wasm.wasm'];
  if(report.binary?.bytes!==wasm.bytes||report.binary.sha256!==wasm.sha256)fail('parity WASM changed');
}

function createRestorer(readSource,snapshot=false){
  let receipt,verified=false;
  return(path,bytes)=>{
    const name=sourceName(path);
    if(!SCSP_SYNTH_CYCLE2_SOURCES.includes(name))return bytes;
    receipt=snapshot?receipt??evidence(readSource):evidence(readSource);
    const entry=receipt.sources[name];if(!matches(bytes,entry.after))return bytes;
    if(!verified){
      for(const dependency of [...SCSP_SYNTH_CYCLE2_SOURCES,...SCSP_SYNTH_CYCLE2_RELATED,...SCSP_SYNTH_CYCLE2_REPORTS]){
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
export function restoreMixerCalibrationScspSynthCycle2Revision(path,bytes,{readSource=read}={}){return createRestorer(readSource)(path,bytes);}
export function createScspSynthCycle2RevisionReadContext(readSource=read){
  const originals=new Map(),predecessors=new Map();
  const original=url=>{const key=url instanceof URL?url.href:url;if(!originals.has(key))originals.set(key,Buffer.from(readSource(url)));return originals.get(key);};
  const restore=createRestorer(original,true);
  const reader=url=>{const key=url instanceof URL?url.href:url;if(!predecessors.has(key)){const bytes=original(url),name=url instanceof URL&&url.protocol==='file:'?relative(root,fileURLToPath(url)).replaceAll('\\','/'):null;predecessors.set(key,name===null?bytes:restore(name,bytes));}return predecessors.get(key);};
  return {restore,readSource:reader};
}
