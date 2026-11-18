/** Exact passive Synth acyclic two-operator FM revision. Recover the complete
 * reviewed Synth before the existing audio calibration proof chain. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createScspFmMultiRevisionReadContext} from './mixer_calibration_scsp_fm_multi_revision.mjs';

export const SCSP_FM_CUSTOM2_REVISION_BASE_COMMIT='62da69d00511f66e2db7aca69b258f96b6726438';
export const SCSP_FM_CUSTOM2_REVISION_RECEIPT_PATH='docs/issues/scsp_fm_custom2_source_revision_01.json';
export const SCSP_FM_CUSTOM2_REVISION_RECEIPT_OBJECT_SHA256='facd3fe15248f94a620a90f449025f0fd06ef9d16e28de09cd3b459845f094a8';
export const SCSP_FM_CUSTOM2_REVISION_SOURCE_PATHS=Object.freeze([
  ...['routing.js','patch.js','instrument.js','index.html','synth.js','synth.css',
    'code_declarations.js','audio.js','processor.js','code_host.js','code_project.js','ssf_capture.js']
    .map(name=>'docs/synth-scsp/'+name),
  'scripts/mixer_calibration_scsp_dsp_flow_revision.test.mjs',
  'scripts/record_scsp_dsp_routing_ui_default_parity.mjs',
]);
export const SCSP_FM_CUSTOM2_REVISION_UNCHANGED_PATHS=Object.freeze([
  ...['dsp.js','dsp_program.js','dsp_routing_view.js','dsp_signal_flow.js',
    'preset.js','release_guard.js','dsp_examples.js','dsp_program_view.js',
    'dsp_setup_code.js','code_endpoint.js','controls.js'].map(name=>'docs/synth-scsp/'+name),
  ...['scsp.js','scspsynth.js','scsp_dsp.js','scsp_dsp_program.js',
    'scsp_dsp_coefficients.js','scsp_dsp_assembler.js','soundchip_pitch.js',
    'pcm_44100_resampler.js','soundchip_mixer_presets.js']
    .flatMap(name=>['tetorica_src/runtime/'+name,'docs/js/'+name]),
  ...['scsp_wasm.js','scsp_wasm.wasm'].flatMap(name=>[
    'tetorica_src/runtime/generated/'+name,'docs/generated/'+name]),
  'docs/playground/playground_mixer_defaults.js',
  'scripts/record_playground_scsp_dsp_routing_default_parity.mjs',
]);
export const SCSP_FM_CUSTOM2_REVISION_RELATED_PATHS=Object.freeze([
  ...SCSP_FM_CUSTOM2_REVISION_UNCHANGED_PATHS,
  'docs/synth-scsp/fm_custom_view.js','docs/synth-scsp/fm_custom_view.test.mjs',
  'docs/synth-scsp/fm_custom2.test.mjs','docs/synth-scsp/code_declarations.test.mjs',
  'scripts/mixer_calibration_scsp_dsp_flow_revision.mjs',
  'scripts/mixer_calibration_scsp_fm_custom_revision.test.mjs',
  'scripts/record_scsp_fm_custom2_default_parity.mjs',
  'scripts/scsp_fm_custom2_default_parity.test.mjs',
]);
export const SCSP_FM_CUSTOM2_REVISION_REPORT_PATHS=Object.freeze([
  'docs/issues/scsp_dsp_signal_flow_source_revision_01.json',
  'docs/issues/scsp_dsp_routing_ui_source_revision_01.json',
  'docs/issues/scsp_dsp_routing_ui_default_parity_01.json',
  'docs/issues/playground_scsp_dsp_routing_source_revision_01.json',
  'docs/issues/playground_scsp_dsp_routing_default_parity_01.json',
  'docs/issues/playground_scsp_dsp_delay_default_parity_01.json',
  'docs/issues/playground_scsp_dsp_default_parity_01.json',
  'docs/issues/playground_chip_levels_01.json',
  'docs/issues/scsp_state_restore_chip_levels_01.json',
  'docs/issues/scsp_ay_single_output_chip_levels_01.json',
  'docs/issues/scsp_ay_single_output_chip_levels_verify_01.json',
  'docs/issues/scsp_fm_custom2_default_parity_01.json',
]);

const root=fileURLToPath(new URL('../',import.meta.url));
const read=url=>readFileSync(url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[0-9a-f]{64}$/.test(value.sha256);
const matches=(bytes,expected)=>record(expected)&&Buffer.byteLength(bytes)===expected.bytes&&sha(bytes)===expected.sha256;
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const fail=message=>{throw Error('Invalid exact SCSP FM custom2 calibration revision: '+message);};
const predecessorReaders=new WeakSet();
function sourceName(path){
  if(typeof path!=='string')return path;
  if(path.startsWith('synth-scsp/'))return 'docs/'+path;
  return path;
}
function evidence(readSource){
  const value=JSON.parse(readSource(new URL('../'+SCSP_FM_CUSTOM2_REVISION_RECEIPT_PATH,import.meta.url)));
  if(sha(JSON.stringify(value))!==SCSP_FM_CUSTOM2_REVISION_RECEIPT_OBJECT_SHA256)fail('independently pinned receipt changed');
  if(value.schemaVersion!==1||value.scope!=='scsp-synth-acyclic-custom-two-operator-fm'||
    value.baseCommit!==SCSP_FM_CUSTOM2_REVISION_BASE_COMMIT||
    !keys(value.sources,SCSP_FM_CUSTOM2_REVISION_SOURCE_PATHS)||
    !keys(value.relatedSources,SCSP_FM_CUSTOM2_REVISION_RELATED_PATHS)||
    !keys(value.reports,SCSP_FM_CUSTOM2_REVISION_REPORT_PATHS))fail('exact source, dependency or report inventory changed');
  for(const path of SCSP_FM_CUSTOM2_REVISION_SOURCE_PATHS){
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
  for(const path of [...SCSP_FM_CUSTOM2_REVISION_RELATED_PATHS,...SCSP_FM_CUSTOM2_REVISION_REPORT_PATHS])
    if(!record(value.relatedSources[path]??value.reports[path]))fail('invalid dependency record: '+path);
  return value;
}
function verifyDefaultParity(receipt,readSource){
  const report=JSON.parse(readSource(new URL('../docs/issues/scsp_fm_custom2_default_parity_01.json',import.meta.url)));
  if(report.schemaVersion!==1||report.scope!=='scsp-synth-custom2-legacy-pcm-fm-parity'||
    report.baseCommit!==SCSP_FM_CUSTOM2_REVISION_BASE_COMMIT||report.deviceOpened!==false||
    !Array.isArray(report.cases)||report.cases.length!==42)fail('legacy PCM/FM parity coverage changed');
  const seen=new Set();
  for(const value of report.cases){
    if(![44100,48000].includes(value.sampleRate)||!value.exactPcmEqual||!value.exactRamEqual||
      !value.legacyStateEqual||!value.exactRegistersEqual||!value.exactEffectiveWriteTraceEqual||
      !value.exactPresetEqual)fail('legacy PCM/FM parity result changed');
    if(value.kind==='pcm'){
      if(!['pcm8','pcm16'].includes(value.scenario)||![220,440,880].includes(value.frequencyHz)||
        typeof value.dspEnabled!=='boolean')fail('PCM parity case changed');
      seen.add([value.kind,value.sampleRate,value.scenario,value.frequencyHz,value.dspEnabled].join('/'));
    }else if(value.kind==='fm'){
      if(!['fm2','fm4','fm6'].includes(value.mode)||!['chain','pairs','branch'].includes(value.algorithm))fail('FM parity case changed');
      seen.add([value.kind,value.sampleRate,value.mode,value.algorithm].join('/'));
    }else fail('unknown parity scenario');
  }
  if(seen.size!==42)fail('duplicate or missing legacy parity case');
  for(const [name,value]of Object.entries(report.sources??{})){
    const expected=receipt.sources[name]?.after;
    if(!expected||expected.bytes!==value.bytes||expected.sha256!==value.sha256)fail('parity source changed: '+name);
  }
  if(!keys(report.sources,['docs/synth-scsp/routing.js','docs/synth-scsp/patch.js','docs/synth-scsp/instrument.js'])||
    !keys(report.predecessors,['docs/synth-scsp/routing.js','docs/synth-scsp/patch.js','docs/synth-scsp/instrument.js']))fail('parity source inventory changed');
  for(const [name,value]of Object.entries(report.predecessors)){
    const expected=receipt.sources[name]?.before;
    if(expected.bytes!==value.bytes||expected.sha256!==value.sha256)fail('parity predecessor changed: '+name);
  }
  const wasm=receipt.relatedSources['docs/generated/scsp_wasm.wasm'];
  if(report.binary?.bytes!==wasm.bytes||report.binary.sha256!==wasm.sha256)fail('parity WASM changed');
}

function createRestorer(readSource,snapshot=false){
  let receipt,verified=false;
  return(path,bytes)=>{
    const name=sourceName(path);
    if(!SCSP_FM_CUSTOM2_REVISION_SOURCE_PATHS.includes(name))return bytes;
    receipt=snapshot?receipt??evidence(readSource):evidence(readSource);
    const entry=receipt.sources[name];if(!matches(bytes,entry.after))return bytes;
    if(!verified){
      for(const dependency of [...SCSP_FM_CUSTOM2_REVISION_SOURCE_PATHS,...SCSP_FM_CUSTOM2_REVISION_RELATED_PATHS,...SCSP_FM_CUSTOM2_REVISION_REPORT_PATHS]){
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
export function restoreMixerCalibrationScspFmCustom2Revision(path,bytes,{readSource=read}={}){
  const latest=createScspFmMultiRevisionReadContext(readSource);
  return createRestorer(latest.readSource)(path,latest.restore(path,bytes));
}
/** Fresh owned reads prevent one proof mixing before/after filesystem states. */
export function createScspFmCustom2RevisionReadContext(readSource=read){
  const latest=createScspFmMultiRevisionReadContext(readSource);readSource=latest.readSource;
  const originals=new Map(),predecessors=new Map();
  const original=url=>{const key=url instanceof URL?url.href:url;if(!originals.has(key))originals.set(key,Buffer.from(readSource(url)));return originals.get(key);};
  const restore=createRestorer(original,true);
  const reader=url=>{
    const key=url instanceof URL?url.href:url;
    if(!predecessors.has(key)){
      const bytes=original(url),path=url instanceof URL&&url.protocol==='file:'?relative(root,fileURLToPath(url)).replaceAll('\\','/'):null;
      predecessors.set(key,path===null?bytes:restore(path,bytes));
    }
    return predecessors.get(key);
  };
  predecessorReaders.add(reader);return {restore:(path,bytes)=>restore(path,latest.restore(path,bytes)),readSource:reader};
}
export function createScspFmCustom2RevisionReader(readSource=read){
  if(predecessorReaders.has(readSource))return readSource;
  const reader=url=>{
    const bytes=readSource(url);
    if(!(url instanceof URL)||url.protocol!=='file:')return bytes;
    return restoreMixerCalibrationScspFmCustom2Revision(relative(root,fileURLToPath(url)).replaceAll('\\','/'),bytes,{readSource});
  };
  predecessorReaders.add(reader);return reader;
}
