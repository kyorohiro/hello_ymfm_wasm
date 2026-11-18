/** Exact passive Synth signal-flow presentation revision. Recover the complete
 * reviewed UI before the existing audio calibration proof chain. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createScspFmCustom2RevisionReadContext} from './mixer_calibration_scsp_fm_custom_revision.mjs';

export const SCSP_DSP_FLOW_REVISION_BASE_COMMIT='ac5024067fb9404151bf66623e0c050cdae93b6d';
export const SCSP_DSP_FLOW_REVISION_RECEIPT_PATH='docs/issues/scsp_dsp_signal_flow_source_revision_01.json';
export const SCSP_DSP_FLOW_REVISION_RECEIPT_OBJECT_SHA256='687aa8b85a7be093abac47e78c31a789abe81adf1cf75518188e8aafef1f1493';
export const SCSP_DSP_FLOW_REVISION_SOURCE_PATHS=Object.freeze([
  'docs/synth-scsp/index.html','docs/synth-scsp/synth.js','docs/synth-scsp/synth.css',
  'scripts/mixer_calibration_scsp_dsp_ui_revision.test.mjs',
]);
// These exact audio/control modules retain their base-commit bytes. The only
// changed executable source outside the three UI bodies is the passive view.
export const SCSP_DSP_FLOW_REVISION_UNCHANGED_PATHS=Object.freeze([
  ...['dsp.js','dsp_program.js','instrument.js','dsp_routing_view.js','audio.js',
    'processor.js','patch.js','preset.js','routing.js','release_guard.js',
    'dsp_examples.js','controls.js'].map(name=>'docs/synth-scsp/'+name),
  ...['scsp.js','scspsynth.js','scsp_dsp.js','scsp_dsp_program.js',
    'scsp_dsp_coefficients.js','scsp_dsp_assembler.js','soundchip_pitch.js',
    'pcm_44100_resampler.js','soundchip_mixer_presets.js']
    .flatMap(name=>['tetorica_src/runtime/'+name,'docs/js/'+name]),
  ...['scsp_wasm.js','scsp_wasm.wasm'].flatMap(name=>[
    'tetorica_src/runtime/generated/'+name,'docs/generated/'+name]),
  'docs/playground/playground_mixer_defaults.js',
  'scripts/record_scsp_dsp_routing_ui_default_parity.mjs',
  'scripts/record_playground_scsp_dsp_routing_default_parity.mjs',
]);
export const SCSP_DSP_FLOW_REVISION_RELATED_PATHS=Object.freeze([
  ...SCSP_DSP_FLOW_REVISION_UNCHANGED_PATHS,
  'docs/synth-scsp/dsp_signal_flow.js','docs/synth-scsp/dsp_signal_flow.test.mjs',
  'scripts/mixer_calibration_scsp_dsp_ui_revision.mjs',
  'scripts/mixer_calibration_scsp_dsp_flow_revision.test.mjs',
]);
export const SCSP_DSP_FLOW_REVISION_REPORT_PATHS=Object.freeze([
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
]);

const root=fileURLToPath(new URL('../',import.meta.url));
const read=url=>readFileSync(url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[0-9a-f]{64}$/.test(value.sha256);
const matches=(bytes,expected)=>record(expected)&&Buffer.byteLength(bytes)===expected.bytes&&sha(bytes)===expected.sha256;
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const fail=message=>{throw Error('Invalid exact SCSP DSP flow calibration revision: '+message);};
const predecessorReaders=new WeakSet();
function sourceName(path){
  if(typeof path!=='string')return path;
  if(path.startsWith('synth-scsp/'))return 'docs/'+path;
  return path;
}
function evidence(readSource){
  const value=JSON.parse(readSource(new URL('../'+SCSP_DSP_FLOW_REVISION_RECEIPT_PATH,import.meta.url)));
  if(sha(JSON.stringify(value))!==SCSP_DSP_FLOW_REVISION_RECEIPT_OBJECT_SHA256)fail('independently pinned receipt changed');
  if(value.schemaVersion!==1||value.scope!=='scsp-synth-passive-dsp-signal-flow-ui'||
    value.baseCommit!==SCSP_DSP_FLOW_REVISION_BASE_COMMIT||
    !keys(value.sources,SCSP_DSP_FLOW_REVISION_SOURCE_PATHS)||
    !keys(value.relatedSources,SCSP_DSP_FLOW_REVISION_RELATED_PATHS)||
    !keys(value.reports,SCSP_DSP_FLOW_REVISION_REPORT_PATHS))fail('exact source, dependency or report inventory changed');
  for(const path of SCSP_DSP_FLOW_REVISION_SOURCE_PATHS){
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
  for(const path of [...SCSP_DSP_FLOW_REVISION_RELATED_PATHS,...SCSP_DSP_FLOW_REVISION_REPORT_PATHS])
    if(!record(value.relatedSources[path]??value.reports[path]))fail('invalid dependency record: '+path);
  return value;
}
function verifyExistingEvidence(readSource){
  const synth=JSON.parse(readSource(new URL('../docs/issues/scsp_dsp_routing_ui_default_parity_01.json',import.meta.url)));
  if(synth.deviceOpened!==false||synth.cases?.length!==24||synth.cases.some(value=>
    !value.exactPcmEqual||!value.exactRamEqual||!value.legacyStateEqual||!value.exactRegistersEqual||!value.exactLegacyEffectiveWriteTraceEqual))
    fail('existing Synth audio evidence changed');
  const runtime=JSON.parse(readSource(new URL('../docs/issues/playground_scsp_dsp_routing_default_parity_01.json',import.meta.url)));
  if(runtime.deviceOpened!==false||runtime.cases?.length!==36||runtime.transportCases?.length!==15||runtime.cases.some(value=>
    !value.exactPcmEqual||!value.exactEffectiveWriteTraceEqual||!value.exactRamEqual||!value.legacyStateEqual)||runtime.transportCases.some(value=>!value.exactPacketsEqual))
    fail('existing runtime audio evidence changed');
}

function createRestorer(readSource,snapshot=false){
  let receipt,verified=false;
  return(path,bytes)=>{
    const name=sourceName(path);
    if(!SCSP_DSP_FLOW_REVISION_SOURCE_PATHS.includes(name))return bytes;
    receipt=snapshot?receipt??evidence(readSource):evidence(readSource);
    const entry=receipt.sources[name];if(!matches(bytes,entry.after))return bytes;
    if(!verified){
      for(const dependency of [...SCSP_DSP_FLOW_REVISION_SOURCE_PATHS,...SCSP_DSP_FLOW_REVISION_RELATED_PATHS,...SCSP_DSP_FLOW_REVISION_REPORT_PATHS]){
        const expected=receipt.sources[dependency]?.after??receipt.relatedSources[dependency]??receipt.reports[dependency];
        if(!matches(readSource(new URL('../'+dependency,import.meta.url)),expected))fail('pinned source/report dependency changed: '+dependency);
      }
      verifyExistingEvidence(readSource);verified=snapshot;
    }
    const current=Buffer.from(bytes),parts=[];let cursor=0;
    for(const hunk of entry.reverseHunks){parts.push(current.subarray(cursor,hunk.afterOffset),Buffer.from(hunk.beforeText));cursor=hunk.afterOffset+hunk.afterBytes;}
    parts.push(current.subarray(cursor));const before=Buffer.concat(parts);
    if(!matches(before,entry.before))fail('complete predecessor reconstruction failed: '+name);
    return before;
  };
}
export function restoreMixerCalibrationScspDspFlowRevision(path,bytes,{readSource=read}={}){
  const latest=createScspFmCustom2RevisionReadContext(readSource);
  return createRestorer(latest.readSource)(path,latest.restore(path,bytes));
}
/** Fresh owned reads prevent one proof mixing before/after filesystem states. */
export function createScspDspFlowRevisionReadContext(readSource=read){
  const latest=createScspFmCustom2RevisionReadContext(readSource);readSource=latest.readSource;
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
export function createScspDspFlowRevisionReader(readSource=read){
  if(predecessorReaders.has(readSource))return readSource;
  const reader=url=>{
    const bytes=readSource(url);
    if(!(url instanceof URL)||url.protocol!=='file:')return bytes;
    return restoreMixerCalibrationScspDspFlowRevision(relative(root,fileURLToPath(url)).replaceAll('\\','/'),bytes,{readSource});
  };
  predecessorReaders.add(reader);return reader;
}
