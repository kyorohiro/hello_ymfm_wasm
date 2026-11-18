/** Exact read-only SSF DSP observation revision. Recover the complete
 * reviewed Synth before the existing audio calibration proof chain. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createScspFmSelfFeedbackRevisionReadContext} from './mixer_calibration_scsp_fm_self_feedback_revision.mjs';

export const SCSP_SSF_DSP_REVISION_BASE_COMMIT='3ec3405625ad6007e87e1163c97b6b995dfb07b5';
export const SCSP_SSF_DSP_REVISION_RECEIPT_PATH='docs/issues/scsp_ssf_dsp_source_revision_01.json';
export const SCSP_SSF_DSP_REVISION_RECEIPT_OBJECT_SHA256='325b1c52489ec484368344f7da71134cbd569ea417f94f457ab3a7217dbe12a3';
export const SCSP_SSF_DSP_REVISION_SOURCE_PATHS=Object.freeze([
  'docs/synth-scsp/index.html','docs/synth-scsp/synth.js','docs/synth-scsp/synth.css','docs/synth-scsp/README.md',
  'scripts/mixer_calibration_scsp_fm_depth_revision.test.mjs',
]);
export const SCSP_SSF_DSP_REVISION_ASSET_PATHS=Object.freeze([
  'docs/generated/ssf-player/ssf_player.js','docs/generated/ssf-player/ssf_player.wasm',
]);
export const SCSP_SSF_DSP_REVISION_UNCHANGED_PATHS=Object.freeze([
  ...['routing.js','patch.js','instrument.js','code_declarations.js','code_declarations.test.mjs',
    'audio.js','processor.js','code_host.js','code_project.js','ssf_capture.js','ssf_source.js','ssf_source.test.mjs',
    'dsp.js','dsp_program.js','dsp_routing_view.js','dsp_signal_flow.js',
    'preset.js','release_guard.js','dsp_examples.js','dsp_program_view.js',
    'dsp_setup_code.js','code_endpoint.js','controls.js',
    'fm_custom_view.js','fm_custom_view.test.mjs','fm_custom2.test.mjs','fm_custom_multi.test.mjs'].map(name=>'docs/synth-scsp/'+name),
  ...['scsp.js','scspsynth.js','scsp_dsp.js','scsp_dsp_program.js',
    'scsp_dsp_coefficients.js','scsp_dsp_assembler.js','soundchip_pitch.js',
    'pcm_44100_resampler.js','soundchip_mixer_presets.js']
    .flatMap(name=>['tetorica_src/runtime/'+name,'docs/js/'+name]),
  ...['scsp_wasm.js','scsp_wasm.wasm'].flatMap(name=>[
    'tetorica_src/runtime/generated/'+name,'docs/generated/'+name]),
  'docs/playground/playground_mixer_defaults.js',
  'scripts/record_playground_scsp_dsp_routing_default_parity.mjs',
  'tetorica_src/wasm/ssf_player/CMakeLists.txt','tetorica_src/wasm/ssf_player/config.wasm.h',
  'third_party/ssfplay/UPSTREAM.json','test/helpers/scsp_ssf_fixture.mjs',
]);
export const SCSP_SSF_DSP_REVISION_RELATED_PATHS=Object.freeze([
  ...SCSP_SSF_DSP_REVISION_UNCHANGED_PATHS,
  ...SCSP_SSF_DSP_REVISION_ASSET_PATHS,
  'docs/generated/ssf-player/NOTICE.txt',
  ...['ssf_snapshot.js','ssf_snapshot.test.mjs','ssf_dsp_snapshot.test.mjs',
    'ssf_renderer.js','ssf_renderer.test.mjs','ssf_live_history.js','ssf_live_history.test.mjs',
    'ssf_live_view.js','ssf_live_view.test.mjs','ssf_dsp_view.js','ssf_dsp_view.test.mjs',
    'song_controls.js','song_player.js',
    'fm_operator_depth.test.mjs','fm_depth_view.js','fm_depth_view.test.mjs',
  ].map(name=>'docs/synth-scsp/'+name),
  'tetorica_src/wasm/ssf_player/ssf_observer.inc',
  'tetorica_src/wasm/ssf_player/ssf_player.cpp',
  'scripts/build_ssf_player.mjs','test/helpers/scsp_ssf_dsp_fixture.mjs',
  'scripts/record_scsp_ssf_dsp_passive_parity.mjs',
  'scripts/mixer_calibration_scsp_fm_depth_revision.mjs',
  'scripts/record_scsp_fm_depth_revision.mjs',
  'scripts/mixer_calibration_scsp_ssf_dsp_revision.test.mjs',
  'scripts/record_scsp_fm_depth_default_parity.mjs',
  'scripts/scsp_fm_depth_default_parity.test.mjs',
  'scripts/check_scsp_synth_dsp_flow_browser.cjs',
  'scripts/check_scsp_synth_ssf_dsp_browser.cjs',
]);
export const SCSP_SSF_DSP_REVISION_REPORT_PATHS=Object.freeze([
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
  'docs/issues/scsp_ssf_dsp_passive_parity_01.json',
]);

const root=fileURLToPath(new URL('../',import.meta.url));
const read=url=>readFileSync(url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[0-9a-f]{64}$/.test(value.sha256);
const matchesRecord=(a,b)=>record(a)&&record(b)&&a.bytes===b.bytes&&a.sha256===b.sha256;
const matches=(bytes,expected)=>record(expected)&&Buffer.byteLength(bytes)===expected.bytes&&sha(bytes)===expected.sha256;
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const fail=message=>{throw Error('Invalid exact SCSP SSF DSP calibration revision: '+message);};
const predecessorReaders=new WeakSet();
function sourceName(path){
  if(typeof path!=='string')return path;
  if(path.startsWith('synth-scsp/'))return 'docs/'+path;
  return path;
}
function evidence(readSource){
  const value=JSON.parse(readSource(new URL('../'+SCSP_SSF_DSP_REVISION_RECEIPT_PATH,import.meta.url)));
  if(sha(JSON.stringify(value))!==SCSP_SSF_DSP_REVISION_RECEIPT_OBJECT_SHA256)fail('independently pinned receipt changed');
  if(value.schemaVersion!==1||value.scope!=='scsp-synth-read-only-ssf-dsp-observation'||
    value.baseCommit!==SCSP_SSF_DSP_REVISION_BASE_COMMIT||
    !keys(value.sources,SCSP_SSF_DSP_REVISION_SOURCE_PATHS)||
    !keys(value.assets,SCSP_SSF_DSP_REVISION_ASSET_PATHS)||
    !keys(value.relatedSources,SCSP_SSF_DSP_REVISION_RELATED_PATHS)||
    !keys(value.reports,SCSP_SSF_DSP_REVISION_REPORT_PATHS))fail('exact source, dependency or report inventory changed');
  for(const path of SCSP_SSF_DSP_REVISION_SOURCE_PATHS){
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
  for(const path of SCSP_SSF_DSP_REVISION_ASSET_PATHS){
    const asset=value.assets[path];
    if(!keys(asset,['before','after'])||!record(asset.before)||!record(asset.after)||
      !matchesRecord(asset.after,value.relatedSources[path]))fail('invalid separately observed SSF asset: '+path);
  }
  for(const path of [...SCSP_SSF_DSP_REVISION_RELATED_PATHS,...SCSP_SSF_DSP_REVISION_REPORT_PATHS])
    if(!record(value.relatedSources[path]??value.reports[path]))fail('invalid dependency record: '+path);
  return value;
}
function verifyExistingEvidence(receipt,readSource){
  const report=JSON.parse(readSource(new URL('../docs/issues/scsp_fm_depth_default_parity_01.json',import.meta.url)));
  if(report.scope!=='scsp-synth-operator-depth-legacy-pcm-fixed-fm-custom2-parity'||
    report.deviceOpened!==false||report.cases?.length!==66||report.cases.some(value=>
      !value.exactPcmEqual||!value.exactRamEqual||!value.legacyStateEqual||
      !value.exactRegistersEqual||!value.exactEffectiveWriteTraceEqual||!value.exactPresetEqual))
    fail('existing unchanged SCSP Synth audio evidence changed');
  for(const path of ['docs/synth-scsp/routing.js','docs/synth-scsp/patch.js','docs/synth-scsp/instrument.js'])
    if(!matchesRecord(report.sources?.[path],receipt.relatedSources[path]))fail('SCSP Synth audio owner changed: '+path);
  if(!matchesRecord(report.binary,receipt.relatedSources['docs/generated/scsp_wasm.wasm']))fail('SCSP core WASM changed');
  verifySsfPassiveEvidence(receipt,readSource);
}
function verifySsfPassiveEvidence(receipt,readSource){
  const report=JSON.parse(readSource(new URL('../docs/issues/scsp_ssf_dsp_passive_parity_01.json',import.meta.url)));
  if(report.schemaVersion!==1||report.scope!=='scsp-ssf-dsp-passive-observation-parity'||
    report.baseCommit!==SCSP_SSF_DSP_REVISION_BASE_COMMIT||report.deviceOpened!==false||
    report.cpuStateDirectlyObserved!==false||typeof report.cpuNoninterferenceEvidence!=='string'||
    !report.cpuNoninterferenceEvidence.includes('No CPU register export is claimed.'))fail('SSF passive parity schema or CPU claim changed');
  for(const [name,key,abi] of [['before','before',3],['after','after',4]]){
    const value=report[name];
    if(value?.abi!==abi||!matchesRecord(value.factory,receipt.assets[SCSP_SSF_DSP_REVISION_ASSET_PATHS[0]][key])||
      !matchesRecord(value.wasm,receipt.assets[SCSP_SSF_DSP_REVISION_ASSET_PATHS[1]][key]))fail('SSF predecessor/current loader or WASM identity changed');
  }
  const schema=report.schema;
  if(schema?.slotWords!==1040||schema.dspWords!==632||schema.magic!=='0x53445031'||schema.version!==1||
    schema.tempAndMemsExported!==false||schema.program?.type!=='Uint16Array'||schema.program.length!==512||
    schema.coefficients?.type!=='Int16Array'||schema.coefficients.length!==64||schema.coefficients.min!==-4096||schema.coefficients.max!==4095||
    schema.addresses?.type!=='Uint16Array'||schema.addresses.length!==32||schema.outputs?.type!=='Int16Array'||schema.outputs.length!==16)
    fail('SSF passive observation schema changed');
  if(!Array.isArray(report.cases)||report.cases.length!==8)fail('SSF passive parity case inventory changed');
  const seen=new Set(),flags=['exactPcmEqual','exactRamEqual','exactSlotStateEqual','exactSlotWordsEqual',
    'exactNativeFrameEqual','exactUnobservedPcmEqual','exactUnobservedFinalSnapshotEqual',
    'repeatedDspReadUnchanged','sameFrameDsp','detachedDspBuffers'];
  for(const value of report.cases){
    if(!['pcm-sine','live-cpu-writes','capture-voices','nonzero-dsp'].includes(value.fixture)||
      ![257,1024].includes(value.blockFrames)||value.blocks!==(value.blockFrames===257?160:48)||
      !Number.isSafeInteger(value.frames)||value.frames<=0||!Number.isSafeInteger(value.nativeFrame)||value.nativeFrame<0||
      flags.some(name=>value[name]!==true)||['pcmLeftSha256','pcmRightSha256','ramSha256','slotWordsTraceSha256','slotStateTraceSha256']
        .some(name=>!/^[0-9a-f]{64}$/.test(value[name])))fail('SSF passive parity result changed');
    if(value.fixture==='nonzero-dsp'&&['exactFixtureProgramEqual','exactFixtureCoefficientsEqual','exactFixtureAddressesEqual','exactFixtureOutputsEqual']
      .some(name=>value[name]!==true))fail('nonzero DSP fixture evidence changed');
    seen.add(value.fixture+'/'+value.blockFrames);
  }
  if(seen.size!==8)fail('duplicate or missing SSF passive parity case');
}

function createRestorer(readSource,snapshot=false){
  let receipt,verified=false;
  return(path,bytes)=>{
    const name=sourceName(path);
    if(!SCSP_SSF_DSP_REVISION_SOURCE_PATHS.includes(name))return bytes;
    receipt=snapshot?receipt??evidence(readSource):evidence(readSource);
    const entry=receipt.sources[name];if(!matches(bytes,entry.after))return bytes;
    if(!verified){
      for(const dependency of [...SCSP_SSF_DSP_REVISION_SOURCE_PATHS,...SCSP_SSF_DSP_REVISION_RELATED_PATHS,...SCSP_SSF_DSP_REVISION_REPORT_PATHS]){
        const expected=receipt.sources[dependency]?.after??receipt.relatedSources[dependency]??receipt.reports[dependency];
        if(!matches(readSource(new URL('../'+dependency,import.meta.url)),expected))fail('pinned source/report dependency changed: '+dependency);
      }
      verifyExistingEvidence(receipt,readSource);verified=snapshot;
    }
    const current=Buffer.from(bytes),parts=[];let cursor=0;
    for(const hunk of entry.reverseHunks){parts.push(current.subarray(cursor,hunk.afterOffset),Buffer.from(hunk.beforeText));cursor=hunk.afterOffset+hunk.afterBytes;}
    parts.push(current.subarray(cursor));const before=Buffer.concat(parts);
    if(!matches(before,entry.before))fail('complete predecessor reconstruction failed: '+name);
    return before;
  };
}
export function restoreMixerCalibrationScspSsfDspRevision(path,bytes,{readSource=read}={}){
  const latest=createScspFmSelfFeedbackRevisionReadContext(readSource);
  return createRestorer(latest.readSource)(path,latest.restore(path,bytes));
}
/** Fresh owned reads prevent one proof mixing before/after filesystem states. */
export function createScspSsfDspRevisionReadContext(readSource=read){
  const latest=createScspFmSelfFeedbackRevisionReadContext(readSource);readSource=latest.readSource;
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
export function createScspSsfDspRevisionReader(readSource=read){
  if(predecessorReaders.has(readSource))return readSource;
  const reader=url=>{
    const bytes=readSource(url);
    if(!(url instanceof URL)||url.protocol!=='file:')return bytes;
    return restoreMixerCalibrationScspSsfDspRevision(relative(root,fileURLToPath(url)).replaceAll('\\','/'),bytes,{readSource});
  };
  predecessorReaders.add(reader);return reader;
}
