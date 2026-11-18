/** Exact SSF slot overview UI revision. Restore complete reviewed predecessors
 * before the existing native/audio calibration chain; no sound is generated. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';

export const SCSP_SSF_SLOT_MAP_BASE='e585c87940abc257842f3e0faa37c24902fda9eb';
export const SCSP_SSF_SLOT_MAP_RECEIPT='docs/issues/scsp_ssf_slot_map_source_revision_01.json';
export const SCSP_SSF_SLOT_MAP_PIN='25144c7b141e9983a750c3c7a0349c20167ce368734d4f3145377a4d42802571';
export const SCSP_SSF_SLOT_MAP_SOURCES=Object.freeze([
  ...['synth.js','index.html','synth.css','channel_view.js','channel_view.test.mjs','README.md'].map(name=>'docs/synth-scsp/'+name),
  'scripts/mixer_calibration_scsp_cycle2_ui_revision.mjs',
  'scripts/mixer_calibration_scsp_cycle2_ui_revision.test.mjs',
  'scripts/record_scsp_cycle2_ui_revision.mjs',
]);
export const SCSP_SSF_SLOT_MAP_UNCHANGED=Object.freeze([
  ...['scsp.js','scspsynth.js','scsp_dsp.js','scsp_dsp_program.js','scsp_dsp_coefficients.js','scsp_dsp_assembler.js','soundchip_pitch.js','pcm_44100_resampler.js','soundchip_mixer_presets.js'].flatMap(name=>['tetorica_src/runtime/'+name,'docs/js/'+name]),
  ...['scsp_wasm.js','scsp_wasm.wasm'].flatMap(name=>['tetorica_src/runtime/generated/'+name,'docs/generated/'+name]),
  'third_party/tetorica-soundchip-native/vendor/mame-scsp/scsp.cpp','third_party/tetorica-soundchip-native/vendor/mame-scsp/scsp.h',
  'docs/generated/ssf-player/ssf_player.js','docs/generated/ssf-player/ssf_player.wasm',
  'tetorica_src/wasm/ssf_player/ssf_player.cpp','tetorica_src/wasm/ssf_player/ssf_observer.inc',
  'docs/playground/playground_mixer_defaults.js',
  'docs/playground/playground_examples.js','docs/playground/playground_mode_examples.js','docs/playground/playground.js',
  ...['routing.js','patch.js','instrument.js','processor.js','audio.js','preset.js','release_guard.js','dsp.js','code_declarations.js','code_endpoint.js','fm_custom_view.js','fm_depth_view.js','fm_cycle2_view.js','code_examples.js','code_project.js','code_host.js','code_files.js','ssf_snapshot.js','ssf_renderer.js','ssf_live_history.js','ssf_live_view.js','ssf_capture.js','ssf_voice_parameters.js','ssf_voice_edits.js','ssf_dsp_view.js','song_player.js'].map(name=>'docs/synth-scsp/'+name),
  'scripts/package_itch_scsp_synth.mjs','scripts/package_itch_scsp_synth.test.mjs',
  'scripts/mixer_calibration_scsp_cycle2_presets_revision.mjs',
  'scripts/mixer_calibration_scsp_cycle2_presets_revision.test.mjs',
  'scripts/record_scsp_cycle2_presets_revision.mjs',
  'scripts/record_scsp_cycle2_presets_parity.mjs','scripts/scsp_cycle2_presets_parity.test.mjs',
]);
export const SCSP_SSF_SLOT_MAP_RELATED=Object.freeze([
  ...SCSP_SSF_SLOT_MAP_UNCHANGED,
  'docs/synth-scsp/ssf_slot_routes_view.js','docs/synth-scsp/ssf_slot_routes_view.test.mjs',
  'scripts/check_scsp_synth_ssf_slot_map_browser.cjs',
  'scripts/mixer_calibration_scsp_ssf_slot_map_revision.test.mjs',
  'scripts/record_scsp_ssf_slot_map_revision.mjs',
]);
export const SCSP_SSF_SLOT_MAP_REPORTS=Object.freeze([
  'docs/issues/scsp_cycle2_ui_source_revision_01.json',
  'docs/issues/scsp_cycle2_presets_source_revision_01.json',
  'docs/issues/scsp_cycle2_presets_parity_01.json',
  'docs/issues/scsp_synth_cycle2_source_revision_01.json',
  'docs/issues/scsp_synth_cycle2_default_parity_01.json',
  'docs/issues/scsp_fm_multiple_self_source_revision_01.json',
  'docs/issues/scsp_ssf_dsp_source_revision_01.json',
  'docs/issues/scsp_ssf_dsp_passive_parity_01.json',
]);
const root=fileURLToPath(new URL('../',import.meta.url)),read=url=>readFileSync(url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[0-9a-f]{64}$/.test(value.sha256);
const matches=(bytes,expected)=>record(expected)&&bytes.length===expected.bytes&&sha(bytes)===expected.sha256;
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const fail=message=>{throw Error('Invalid exact SCSP SSF slot map revision: '+message);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const nameOf=path=>typeof path==='string'&&path.startsWith('synth-scsp/')?'docs/'+path:path;

function evidence(readSource){
  const receipt=JSON.parse(readSource(new URL('../'+SCSP_SSF_SLOT_MAP_RECEIPT,import.meta.url)));
  if(sha(JSON.stringify(receipt))!==SCSP_SSF_SLOT_MAP_PIN)fail('independently pinned receipt changed');
  if(receipt.schemaVersion!==1||receipt.scope!=='scsp-ssf-slot-activity-and-selected-configured-routes'||receipt.baseCommit!==SCSP_SSF_SLOT_MAP_BASE||
    !keys(receipt.sources,SCSP_SSF_SLOT_MAP_SOURCES)||!keys(receipt.relatedSources,SCSP_SSF_SLOT_MAP_RELATED)||!keys(receipt.reports,SCSP_SSF_SLOT_MAP_REPORTS))fail('exact source, dependency or report inventory changed');
  for(const name of SCSP_SSF_SLOT_MAP_SOURCES){
    const entry=receipt.sources[name];
    if(entry?.beforeCommit!==SCSP_SSF_SLOT_MAP_BASE||!record(entry.before)||!record(entry.after)||!Array.isArray(entry.reverseHunks)||!entry.reverseHunks.length)fail('incomplete predecessor pair: '+name);
    let cursor=0;
    for(const h of entry.reverseHunks){
      if(!keys(h,['afterOffset','afterBytes','beforeText'])||!Number.isSafeInteger(h.afterOffset)||h.afterOffset<cursor||!Number.isSafeInteger(h.afterBytes)||h.afterBytes<0||h.afterOffset+h.afterBytes>entry.after.bytes||typeof h.beforeText!=='string')fail('invalid exact source recipe: '+name);
      cursor=h.afterOffset+h.afterBytes;
    }
  }
  for(const name of [...SCSP_SSF_SLOT_MAP_RELATED,...SCSP_SSF_SLOT_MAP_REPORTS])if(!record(receipt.relatedSources[name]??receipt.reports[name]))fail('invalid dependency record: '+name);
  return receipt;
}
function restoreBody(bytes,entry){
  const parts=[];let cursor=0;
  for(const h of entry.reverseHunks){parts.push(bytes.subarray(cursor,h.afterOffset),Buffer.from(h.beforeText));cursor=h.afterOffset+h.afterBytes;}
  parts.push(bytes.subarray(cursor));const previous=Buffer.concat(parts);
  if(!matches(previous,entry.before))fail('complete predecessor reconstruction mismatch');
  return previous;
}
function verifyNativeEvidence(receipt,readSource){
  const parity=JSON.parse(readSource(new URL('../docs/issues/scsp_cycle2_presets_parity_01.json',import.meta.url)));
  if(parity.cases?.length!==206||parity.deviceOpened!==false)fail('existing native parity scope changed');
  for(const name of ['docs/synth-scsp/routing.js','docs/synth-scsp/patch.js','docs/synth-scsp/instrument.js'])
    if(!same(parity.sources[name],receipt.relatedSources[name]))fail('native parity source changed: '+name);
  if(!same(parity.binary,receipt.relatedSources['docs/generated/scsp_wasm.wasm']))fail('native parity binary changed');
  const passive=JSON.parse(readSource(new URL('../docs/issues/scsp_ssf_dsp_passive_parity_01.json',import.meta.url)));
  if(passive.scope!=='scsp-ssf-dsp-passive-observation-parity'||passive.deviceOpened!==false||passive.cases?.length!==8||
    !same(passive.after.factory,receipt.relatedSources['docs/generated/ssf-player/ssf_player.js'])||
    !same(passive.after.wasm,receipt.relatedSources['docs/generated/ssf-player/ssf_player.wasm']))fail('unchanged SSF passive observation evidence changed');
}
function createRestorer(readSource,snapshot=false){
  let receipt,verified=false;
  return(path,bytes)=>{
    const name=nameOf(path);if(!SCSP_SSF_SLOT_MAP_SOURCES.includes(name))return bytes;
    receipt=snapshot?receipt??evidence(readSource):evidence(readSource);
    const entry=receipt.sources[name];if(!matches(bytes,entry.after))return bytes;
    if(!verified){
      for(const dependency of [...SCSP_SSF_SLOT_MAP_SOURCES,...SCSP_SSF_SLOT_MAP_RELATED,...SCSP_SSF_SLOT_MAP_REPORTS]){
        const data=readSource(new URL('../'+dependency,import.meta.url)),expected=receipt.sources[dependency]?.after??receipt.relatedSources[dependency]??receipt.reports[dependency];
        if(!matches(data,expected))fail('pinned source/report dependency changed: '+dependency);
      }
      verifyNativeEvidence(receipt,readSource);verified=snapshot;
    }
    return restoreBody(Buffer.from(bytes),entry);
  };
}
export function restoreMixerCalibrationScspSsfSlotMapRevision(path,bytes,{readSource=read}={}){return createRestorer(readSource)(path,bytes);}
export function createScspSsfSlotMapRevisionReadContext(readSource=read){
  const originals=new Map(),predecessors=new Map();
  const original=url=>{const key=url instanceof URL?url.href:url;if(!originals.has(key))originals.set(key,Buffer.from(readSource(url)));return originals.get(key);};
  const restore=createRestorer(original,true);
  const reader=url=>{const key=url instanceof URL?url.href:url;if(!predecessors.has(key)){const bytes=original(url),name=url instanceof URL&&url.protocol==='file:'?relative(root,fileURLToPath(url)).replaceAll('\\','/'):null;predecessors.set(key,name===null?bytes:restore(name,bytes));}return predecessors.get(key);};
  return {restore,readSource:reader};
}
