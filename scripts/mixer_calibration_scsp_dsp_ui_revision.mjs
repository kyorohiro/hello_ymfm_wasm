/** Exact Synth-only two-bus DSP UI revision. Recover the complete reviewed
 * predecessor before the existing routing / Delay calibration proof chain. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';

export const SCSP_DSP_UI_REVISION_BASE_COMMIT='176eb363ef9533f9d226b4e0eed6800ac1b03d6c';
export const SCSP_DSP_UI_REVISION_RECEIPT_PATH='docs/issues/scsp_dsp_routing_ui_source_revision_01.json';
export const SCSP_DSP_UI_REVISION_RECEIPT_OBJECT_SHA256='ae2b62052ea174de418643433e511d41f5b8b9885da6ff09e8ec2b1d9cdf8d63';
export const SCSP_DSP_UI_REVISION_SOURCE_PATHS=Object.freeze([
  'docs/synth-scsp/dsp.js','docs/synth-scsp/dsp_program.js','docs/synth-scsp/instrument.js',
]);
export const SCSP_DSP_UI_REVISION_RELATED_PATHS=Object.freeze([
  ...['patch.js','preset.js','routing.js','release_guard.js','code_endpoint.js',
    'processor.js','audio.js','synth.js','index.html','synth.css','controls.js',
    'dsp_examples.js','dsp_program_view.js','dsp_setup_code.js','code_declarations.js',
    'dsp_routing_view.js']
    .map(name=>'docs/synth-scsp/'+name),
  'docs/synth-scsp/examples/routing-gain-iir.scspasm',
  ...['dsp_routing.test.mjs','dsp_routing_view.test.mjs','dsp_synth_profile.test.mjs','audio.test.mjs']
    .map(name=>'docs/synth-scsp/'+name),
  ...['scsp.js','scspsynth.js','scsp_dsp.js','scsp_dsp_program.js',
    'scsp_dsp_coefficients.js','scsp_dsp_assembler.js','soundchip_pitch.js',
    'pcm_44100_resampler.js','soundchip_mixer_presets.js']
    .flatMap(name=>['tetorica_src/runtime/'+name,'docs/js/'+name]),
  ...['scsp_wasm.js','scsp_wasm.wasm'].flatMap(name=>[
    'tetorica_src/runtime/generated/'+name,'docs/generated/'+name]),
  'docs/playground/playground_mixer_defaults.js',
  'scripts/mixer_calibration_scsp_dsp_routing_revision.mjs',
  'scripts/mixer_calibration_scsp_dsp_routing_revision.test.mjs',
  'scripts/record_scsp_dsp_routing_ui_default_parity.mjs',
  'scripts/scsp_dsp_routing_ui_default_parity.test.mjs',
  'scripts/mixer_calibration_scsp_dsp_ui_revision.test.mjs',
]);
export const SCSP_DSP_UI_REVISION_REPORT_PATHS=Object.freeze([
  'docs/issues/playground_scsp_dsp_routing_source_revision_01.json',
  'docs/issues/playground_scsp_dsp_routing_default_parity_01.json',
  'docs/issues/playground_scsp_dsp_delay_default_parity_01.json',
  'docs/issues/playground_scsp_dsp_default_parity_01.json',
  'docs/issues/playground_chip_levels_01.json',
  'docs/issues/scsp_state_restore_chip_levels_01.json',
  'docs/issues/scsp_ay_single_output_chip_levels_01.json',
  'docs/issues/scsp_ay_single_output_chip_levels_verify_01.json',
  'docs/issues/scsp_dsp_routing_ui_default_parity_01.json',
]);

const root=fileURLToPath(new URL('../',import.meta.url));
const read=url=>readFileSync(url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[0-9a-f]{64}$/.test(value.sha256);
const matches=(bytes,expected)=>record(expected)&&Buffer.byteLength(bytes)===expected.bytes&&sha(bytes)===expected.sha256;
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const fail=message=>{throw Error('Invalid exact SCSP DSP UI calibration revision: '+message);};
const predecessorReaders=new WeakSet();
function sourceName(path){
  if(typeof path!=='string')return path;
  if(path.startsWith('synth-scsp/'))return 'docs/'+path;
  return path;
}
function evidence(readSource){
  const value=JSON.parse(readSource(new URL('../'+SCSP_DSP_UI_REVISION_RECEIPT_PATH,import.meta.url)));
  if(sha(JSON.stringify(value))!==SCSP_DSP_UI_REVISION_RECEIPT_OBJECT_SHA256)fail('independently pinned receipt changed');
  if(value.schemaVersion!==1||value.scope!=='scsp-synth-two-bus-dsp-ui-and-default-path'||
    value.baseCommit!==SCSP_DSP_UI_REVISION_BASE_COMMIT||
    !keys(value.sources,SCSP_DSP_UI_REVISION_SOURCE_PATHS)||
    !keys(value.relatedSources,SCSP_DSP_UI_REVISION_RELATED_PATHS)||
    !keys(value.reports,SCSP_DSP_UI_REVISION_REPORT_PATHS))fail('exact source, dependency or report inventory changed');
  for(const path of SCSP_DSP_UI_REVISION_SOURCE_PATHS){
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
  for(const path of [...SCSP_DSP_UI_REVISION_RELATED_PATHS,...SCSP_DSP_UI_REVISION_REPORT_PATHS])
    if(!record(value.relatedSources[path]??value.reports[path]))fail('invalid dependency record: '+path);
  return value;
}
function verifyDefaultParity(receipt,readSource){
  const report=JSON.parse(readSource(new URL('../docs/issues/scsp_dsp_routing_ui_default_parity_01.json',import.meta.url)));
  if(report.schemaVersion!==1||report.scope!=='scsp-synth-two-bus-ui-default-audio-parity'||
    report.baseCommit!==SCSP_DSP_UI_REVISION_BASE_COMMIT||report.deviceOpened!==false||
    !Array.isArray(report.cases)||report.cases.length!==24||
    !keys(report.sources,SCSP_DSP_UI_REVISION_SOURCE_PATHS)||
    !keys(report.predecessors,SCSP_DSP_UI_REVISION_SOURCE_PATHS))fail('default audio parity coverage changed');
  const cases=new Set();
  for(const value of report.cases){
    if(![44100,48000].includes(value.sampleRate)||!['pcm8','pcm16'].includes(value.scenario)||
      ![220,440,880].includes(value.frequencyHz)||typeof value.dspEnabled!=='boolean'||
      !value.exactPcmEqual||!value.exactRamEqual||!value.legacyStateEqual||!value.exactRegistersEqual||
      !value.exactLegacyEffectiveWriteTraceEqual)
      fail('default audio parity result changed');
    cases.add([value.sampleRate,value.scenario,value.frequencyHz,value.dspEnabled].join('/'));
  }
  if(cases.size!==24)fail('default parity case inventory changed');
  for(const [path,value]of Object.entries(report.sources??{})){
    const expected=receipt.sources[path]?.after??receipt.relatedSources[path];
    if(!expected||expected.bytes!==value.bytes||expected.sha256!==value.sha256)fail('parity source identity changed: '+path);
  }
  for(const [path,value]of Object.entries(report.predecessors??{})){
    const expected=receipt.sources[path]?.before;
    if(!expected||expected.bytes!==value.bytes||expected.sha256!==value.sha256)fail('parity predecessor identity changed: '+path);
  }
  const wasm=receipt.relatedSources['docs/generated/scsp_wasm.wasm'];
  if(report.binary?.bytes!==wasm.bytes||report.binary.sha256!==wasm.sha256)fail('parity WASM identity changed');
}
function createRestorer(readSource,snapshot=false){
  let receipt,verified=false;
  return(path,bytes)=>{
    const name=sourceName(path);
    if(!SCSP_DSP_UI_REVISION_SOURCE_PATHS.includes(name))return bytes;
    receipt=snapshot?receipt??evidence(readSource):evidence(readSource);
    const entry=receipt.sources[name];if(!matches(bytes,entry.after))return bytes;
    if(!verified){
      for(const dependency of [...SCSP_DSP_UI_REVISION_SOURCE_PATHS,...SCSP_DSP_UI_REVISION_RELATED_PATHS,...SCSP_DSP_UI_REVISION_REPORT_PATHS]){
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
export function restoreMixerCalibrationScspDspUiRevision(path,bytes,{readSource=read}={}){
  return createRestorer(readSource)(path,bytes);
}
/** Fresh owned reads prevent one proof mixing before/after filesystem states. */
export function createScspDspUiRevisionReadContext(readSource=read){
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
  predecessorReaders.add(reader);return {restore,readSource:reader};
}
export function createScspDspUiRevisionReader(readSource=read){
  if(predecessorReaders.has(readSource))return readSource;
  const reader=url=>{
    const bytes=readSource(url);
    if(!(url instanceof URL)||url.protocol!=='file:')return bytes;
    return restoreMixerCalibrationScspDspUiRevision(relative(root,fileURLToPath(url)).replaceAll('\\','/'),bytes,{readSource});
  };
  predecessorReaders.add(reader);return reader;
}
