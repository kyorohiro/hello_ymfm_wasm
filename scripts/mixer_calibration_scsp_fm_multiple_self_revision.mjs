/** Exact multiple-Self Custom4/6 revision. Recover the complete
 * reviewed Synth before the existing audio calibration proof chain. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPlaygroundScspCycle2ExamplesRevisionReadContext} from './mixer_calibration_playground_scsp_cycle2_examples_revision.mjs';

export const SCSP_FM_MULTIPLE_SELF_REVISION_BASE_COMMIT='47d9a51e61db9deb27e18f6987e9b7d699bcfbee';
export const SCSP_FM_MULTIPLE_SELF_REVISION_RECEIPT_PATH='docs/issues/scsp_fm_multiple_self_source_revision_01.json';
export const SCSP_FM_MULTIPLE_SELF_REVISION_RECEIPT_OBJECT_SHA256='81b4890696738eda52221af04b44fea955cd3e637947b2eeacfbbf521b3c036e';
export const SCSP_FM_MULTIPLE_SELF_REVISION_SOURCE_PATHS=Object.freeze([
  ...['routing.js','patch.js','instrument.js','index.html','synth.js',
    'code_declarations.js','code_declarations.test.mjs','README.md',
    'audio.js','processor.js','code_host.js','code_project.js','ssf_capture.js',
    'fm_custom_view.js','fm_custom_view.test.mjs','fm_self_feedback.test.mjs','fm_multi_self_feedback.test.mjs',
    'code_examples.js','code_self_feedback_example.test.mjs'].map(name=>'docs/synth-scsp/'+name),
  'scripts/package_itch_scsp_synth.mjs',
  'scripts/check_scsp_synth_self_feedback_browser.cjs','scripts/check_scsp_synth_multi_self_feedback_browser.cjs',
  'scripts/mixer_calibration_scsp_fm_multi_self_feedback_revision.test.mjs',
  'scripts/record_scsp_fm_multi_self_feedback_default_parity.mjs',
]);
export const SCSP_FM_MULTIPLE_SELF_REVISION_UNCHANGED_PATHS=Object.freeze([
  ...['synth.css','dsp.js','dsp_program.js','dsp_routing_view.js','dsp_signal_flow.js',
    'preset.js','release_guard.js','dsp_examples.js','dsp_program_view.js',
    'dsp_setup_code.js','code_endpoint.js','controls.js',
    'fm_custom2.test.mjs','fm_custom_multi.test.mjs'].map(name=>'docs/synth-scsp/'+name),
  ...['scsp.js','scspsynth.js','scsp_dsp.js','scsp_dsp_program.js',
    'scsp_dsp_coefficients.js','scsp_dsp_assembler.js','soundchip_pitch.js',
    'pcm_44100_resampler.js','soundchip_mixer_presets.js']
    .flatMap(name=>['tetorica_src/runtime/'+name,'docs/js/'+name]),
  ...['scsp_wasm.js','scsp_wasm.wasm'].flatMap(name=>[
    'tetorica_src/runtime/generated/'+name,'docs/generated/'+name]),
  'docs/playground/playground_mixer_defaults.js',
  'scripts/record_playground_scsp_dsp_routing_default_parity.mjs',
  'scripts/check_scsp_synth_fm_multi_browser.cjs',
  ...['ssf_player.js','ssf_player.wasm','NOTICE.txt'].map(name=>'docs/generated/ssf-player/'+name),
]);
export const SCSP_FM_MULTIPLE_SELF_REVISION_RELATED_PATHS=Object.freeze([
  ...SCSP_FM_MULTIPLE_SELF_REVISION_UNCHANGED_PATHS,
  ...['fm_multiple_self.test.mjs','fm_operator_depth.test.mjs','fm_depth_view.js','fm_depth_view.test.mjs',
    'code_project.test.mjs'].map(name=>'docs/synth-scsp/'+name),
  'docs/synth-scsp/examples/self-feedback.js','docs/synth-scsp/examples/self-feedback-6op.js',
  'docs/synth-scsp/examples/parallel-self-feedback.js',
  'docs/issues/scsp_fm_self_feedback_research_20261118.md',
  'scripts/mixer_calibration_scsp_fm_multi_self_feedback_revision.mjs',
  'scripts/record_scsp_fm_multi_self_feedback_revision.mjs',
  'scripts/mixer_calibration_scsp_fm_multiple_self_revision.test.mjs',
  'scripts/record_scsp_fm_multiple_self_default_parity.mjs',
  'scripts/scsp_fm_multiple_self_default_parity.test.mjs',
  'scripts/scsp_fm_multi_self_feedback_default_parity.test.mjs',
  'scripts/check_scsp_synth_multiple_self_browser.cjs',
]);
export const SCSP_FM_MULTIPLE_SELF_REVISION_REPORT_PATHS=Object.freeze([
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
  'docs/issues/scsp_fm_custom2_source_revision_01.json',
  'docs/issues/scsp_fm_custom2_default_parity_01.json',
  'docs/issues/scsp_fm_multi_source_revision_01.json',
  'docs/issues/scsp_fm_multi_default_parity_01.json',
  'docs/issues/scsp_fm_depth_source_revision_01.json',
  'docs/issues/scsp_fm_depth_default_parity_01.json',
  'docs/issues/scsp_ssf_dsp_source_revision_01.json',
  'docs/issues/scsp_ssf_dsp_passive_parity_01.json',
  'docs/issues/scsp_fm_self_feedback_source_revision_01.json',
  'docs/issues/scsp_fm_self_feedback_default_parity_01.json',
  'docs/issues/scsp_fm_multi_self_feedback_source_revision_01.json',
  'docs/issues/scsp_fm_multi_self_feedback_default_parity_01.json',
  'docs/issues/scsp_fm_multiple_self_default_parity_01.json',
]);

const root=fileURLToPath(new URL('../',import.meta.url));
const read=url=>readFileSync(url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[0-9a-f]{64}$/.test(value.sha256);
const matches=(bytes,expected)=>record(expected)&&Buffer.byteLength(bytes)===expected.bytes&&sha(bytes)===expected.sha256;
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const fail=message=>{throw Error('Invalid exact SCSP FM self-feedback calibration revision: '+message);};
const predecessorReaders=new WeakSet();
function sourceName(path){
  if(typeof path!=='string')return path;
  if(path.startsWith('synth-scsp/'))return 'docs/'+path;
  return path;
}
function evidence(readSource){
  const value=JSON.parse(readSource(new URL('../'+SCSP_FM_MULTIPLE_SELF_REVISION_RECEIPT_PATH,import.meta.url)));
  if(sha(JSON.stringify(value))!==SCSP_FM_MULTIPLE_SELF_REVISION_RECEIPT_OBJECT_SHA256)fail('independently pinned receipt changed');
  if(value.schemaVersion!==1||value.scope!=='scsp-synth-multiple-self-custom-four-six-operator-feedback'||
    value.baseCommit!==SCSP_FM_MULTIPLE_SELF_REVISION_BASE_COMMIT||
    !keys(value.sources,SCSP_FM_MULTIPLE_SELF_REVISION_SOURCE_PATHS)||
    !keys(value.relatedSources,SCSP_FM_MULTIPLE_SELF_REVISION_RELATED_PATHS)||
    !keys(value.reports,SCSP_FM_MULTIPLE_SELF_REVISION_REPORT_PATHS))fail('exact source, dependency or report inventory changed');
  for(const path of SCSP_FM_MULTIPLE_SELF_REVISION_SOURCE_PATHS){
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
  for(const path of [...SCSP_FM_MULTIPLE_SELF_REVISION_RELATED_PATHS,...SCSP_FM_MULTIPLE_SELF_REVISION_REPORT_PATHS])
    if(!record(value.relatedSources[path]??value.reports[path]))fail('invalid dependency record: '+path);
  return value;
}
function verifyDefaultParity(receipt,readSource){
  const report=JSON.parse(readSource(new URL('../docs/issues/scsp_fm_multiple_self_default_parity_01.json',import.meta.url)));
  if(report.schemaVersion!==1||report.scope!=='scsp-synth-multiple-self-legacy-and-single-self-parity'||
    report.baseCommit!==SCSP_FM_MULTIPLE_SELF_REVISION_BASE_COMMIT||report.deviceOpened!==false||
    !Array.isArray(report.cases)||report.cases.length!==150)fail('legacy PCM/fixed-FM/Custom2 parity coverage changed');
  const seen=new Set();
  for(const value of report.cases){
    if(![44100,48000].includes(value.sampleRate)||!value.exactPcmEqual||!value.exactRamEqual||
      !value.legacyStateEqual||!value.exactRegistersEqual||!value.exactEffectiveWriteTraceEqual||
      !value.exactPresetEqual||!value.exactRegisterSnapshotsEqual||!value.exactRawStackEqual||!value.exactStateSnapshotsEqual)fail('legacy PCM/fixed-FM/Custom2 parity result changed');
    if(value.kind==='pcm'){
      if(!['pcm8','pcm16'].includes(value.scenario)||![220,440,880].includes(value.frequencyHz)||
        typeof value.dspEnabled!=='boolean')fail('PCM parity case changed');
      seen.add([value.kind,value.sampleRate,value.scenario,value.frequencyHz,value.dspEnabled].join('/'));
    }else if(value.kind==='fm'){
      if(!['fm2','fm4','fm6'].includes(value.mode)||!['chain','pairs','branch'].includes(value.algorithm))fail('FM parity case changed');
      seen.add([value.kind,value.sampleRate,value.mode,value.algorithm].join('/'));
    }else if(value.kind==='custom2'){
      if(!['parallel','b-to-a','a-to-b'].includes(value.graph)||!['','0','1','0,1'].includes(value.outputs.join(','))||value.presetVersion!==5)fail('Custom2 parity case changed');
      seen.add([value.kind,value.sampleRate,value.graph,value.outputs.join(',')].join('/'));
    }else if(value.kind==='self2'){
      if(!['self-a','self-a-to-b','self-b','self-b-to-a'].includes(value.graph)||!['','0','1','0,1'].includes(value.outputs.join(','))||value.presetVersion!==8||value.selfRetriggerTested!==true||value.selfRetriggerOwner!=='code')fail('legacy self2 parity case changed');
      seen.add([value.kind,value.sampleRate,value.graph,value.outputs.join(',')].join('/'));
    }else if(value.kind==='custom-multi'){
      if(!['fm4','fm6'].includes(value.mode)||!['merge-fanout','reverse-merge','disconnected-pairs','disconnected-chains'].includes(value.graph)||![6,7].includes(value.presetVersion))fail('legacy four/six-OP parity case changed');
      seen.add([value.kind,value.sampleRate,value.mode,value.graph].join('/'));
    }else if(value.kind==='single-self-multi'){
      const count=value.mode==='fm4'?4:value.mode==='fm6'?6:0;
      if(!count||!Number.isInteger(value.selfTarget)||value.selfTarget<0||value.selfTarget>=count||
        !['isolated','merge-fanout'].includes(value.graph)||value.presetVersion!==9||value.selfRetriggerTested!==true||value.selfRetriggerOwner!=='code')fail('legacy single-Self four/six-OP parity changed');
      seen.add([value.kind,value.sampleRate,value.mode,value.selfTarget,value.graph].join('/'));
    }else fail('unknown parity scenario');
  }
  if(seen.size!==150)fail('duplicate or missing legacy parity case');
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
    if(!SCSP_FM_MULTIPLE_SELF_REVISION_SOURCE_PATHS.includes(name))return bytes;
    receipt=snapshot?receipt??evidence(readSource):evidence(readSource);
    const entry=receipt.sources[name];if(!matches(bytes,entry.after))return bytes;
    if(!verified){
      for(const dependency of [...SCSP_FM_MULTIPLE_SELF_REVISION_SOURCE_PATHS,...SCSP_FM_MULTIPLE_SELF_REVISION_RELATED_PATHS,...SCSP_FM_MULTIPLE_SELF_REVISION_REPORT_PATHS]){
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
export function restoreMixerCalibrationScspFmMultipleSelfRevision(path,bytes,{readSource=read}={}){
  const latest=createPlaygroundScspCycle2ExamplesRevisionReadContext(readSource);
  return createRestorer(latest.readSource)(path,latest.restore(path,bytes));
}
/** Fresh owned reads prevent one proof mixing before/after filesystem states. */
export function createScspFmMultipleSelfRevisionReadContext(readSource=read){
  const latest=createPlaygroundScspCycle2ExamplesRevisionReadContext(readSource);readSource=latest.readSource;
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
export function createScspFmMultipleSelfRevisionReader(readSource=read){
  if(predecessorReaders.has(readSource))return readSource;
  const reader=url=>{
    const bytes=readSource(url);
    if(!(url instanceof URL)||url.protocol!=='file:')return bytes;
    return restoreMixerCalibrationScspFmMultipleSelfRevision(relative(root,fileURLToPath(url)).replaceAll('\\','/'),bytes,{readSource});
  };
  predecessorReaders.add(reader);return reader;
}
