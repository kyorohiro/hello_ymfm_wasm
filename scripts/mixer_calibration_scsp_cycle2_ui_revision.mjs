/** Exact Cycle 2OP UI/example revision. No sound source or example is executed.
 * Restore complete reviewed predecessors before the existing calibration chain. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';

export const SCSP_CYCLE2_UI_BASE='ce9ffdf6206c12c176054b0c95d0cdf863e974e8';
// V11 documentation landed after its receipt was frozen. Recover only its
// exact previously pinned document body; no historical report is rewritten.
export const SCSP_CYCLE2_UI_PREDECESSORS=Object.freeze({
  'docs/synth-scsp/README.md':'6ca7c946bba5c8a84610dd4b3b7542e71562f89f',
});
export const SCSP_CYCLE2_UI_RECEIPT='docs/issues/scsp_cycle2_ui_source_revision_01.json';
export const SCSP_CYCLE2_UI_PIN='191cf181551d6f75b2e1a7a03a31c7c2e84de36b934abfdb6012e37285e82a44';
export const SCSP_CYCLE2_UI_SOURCES=Object.freeze([
  ...['synth.js','index.html','synth.css','code_examples.js','code_project.js','code_host.js','code_files.js','README.md'].map(name=>'docs/synth-scsp/'+name),
  'scripts/mixer_calibration_scsp_cycle2_presets_revision.mjs',
  'scripts/mixer_calibration_scsp_cycle2_presets_revision.test.mjs',
  'scripts/record_scsp_cycle2_presets_revision.mjs',
  'scripts/package_itch_scsp_synth.mjs','scripts/package_itch_scsp_synth.test.mjs',
]);
export const SCSP_CYCLE2_UI_UNCHANGED=Object.freeze([
  ...['scsp.js','scspsynth.js','scsp_dsp.js','scsp_dsp_program.js','scsp_dsp_coefficients.js','scsp_dsp_assembler.js','soundchip_pitch.js','pcm_44100_resampler.js','soundchip_mixer_presets.js'].flatMap(name=>['tetorica_src/runtime/'+name,'docs/js/'+name]),
  ...['scsp_wasm.js','scsp_wasm.wasm'].flatMap(name=>['tetorica_src/runtime/generated/'+name,'docs/generated/'+name]),
  'third_party/tetorica-soundchip-native/vendor/mame-scsp/scsp.cpp','third_party/tetorica-soundchip-native/vendor/mame-scsp/scsp.h',
  'docs/playground/playground_mixer_defaults.js',
  'docs/playground/playground_examples.js','docs/playground/playground_mode_examples.js','docs/playground/playground.js',
  ...['routing.js','patch.js','instrument.js','processor.js','audio.js','code_declarations.js','preset.js','release_guard.js','dsp.js','code_endpoint.js','fm_custom_view.js','fm_depth_view.js'].map(name=>'docs/synth-scsp/'+name),
  'docs/synth-scsp/examples/self-feedback.js','docs/synth-scsp/examples/self-feedback-6op.js','docs/synth-scsp/examples/parallel-self-feedback.js','docs/synth-scsp/examples/dsp-iir-motion.js',
]);
export const SCSP_CYCLE2_UI_RELATED=Object.freeze([
  ...SCSP_CYCLE2_UI_UNCHANGED,
  'docs/synth-scsp/fm_cycle2_view.js','docs/synth-scsp/fm_cycle2_view.test.mjs',
  'docs/synth-scsp/examples/cycle2.js','docs/synth-scsp/code_cycle2_example.test.mjs',
  'scripts/check_scsp_synth_cycle2_ui_browser.cjs',
  'scripts/mixer_calibration_scsp_cycle2_ui_revision.test.mjs',
]);
export const SCSP_CYCLE2_UI_REPORTS=Object.freeze([
  'docs/issues/scsp_cycle2_presets_source_revision_01.json',
  'docs/issues/scsp_cycle2_presets_parity_01.json',
  'docs/issues/scsp_synth_cycle2_source_revision_01.json',
  'docs/issues/scsp_synth_cycle2_default_parity_01.json',
  'docs/issues/scsp_fm_multiple_self_source_revision_01.json',
]);
const root=fileURLToPath(new URL('../',import.meta.url)),read=url=>readFileSync(url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const matches=(bytes,record)=>record&&bytes.length===record.bytes&&sha(bytes)===record.sha256;
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const fail=message=>{throw Error('Invalid exact SCSP Cycle2 UI revision: '+message);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const nameOf=path=>typeof path==='string'&&path.startsWith('synth-scsp/')?'docs/'+path:path;

/** Parse JSON source strings only; importing an example is never part of proof. */
export function parseScspSynthExampleConstants(bytes){
  const source=bytes.toString('utf8'),values={},raw={},order=[];
  const declaration=/export const (SCSP_[A-Z0-9_]+) = ("(?:[^"\\]|\\.)*");/g;
  const scaffold=source.replace(declaration,(text,name,literal)=>{
    if(Object.hasOwn(values,name))fail('duplicate example constant');
    values[name]=JSON.parse(literal);raw[name]=text;order.push(name);
    return '<'+name+'>';
  });
  return {values,raw,order,scaffold};
}
/** This validates only the added example/seed data, not the interactive UI. */
export function verifyScspCycle2UiExampleData(before,after,example){
  const examples='docs/synth-scsp/code_examples.js',project='docs/synth-scsp/code_project.js',host='docs/synth-scsp/code_host.js';
  const a=parseScspSynthExampleConstants(before[examples]),b=parseScspSynthExampleConstants(after[examples]);
  if(!same(b.order,[...a.order,'SCSP_CYCLE2_CODE']))fail('old example names/order changed');
  for(const name of a.order)if(b.values[name]!==a.values[name]||b.raw[name]!==a.raw[name])fail('old example body changed: '+name);
  if(b.values.SCSP_CYCLE2_CODE!==example.toString('utf8'))fail('Cycle example constant differs from canonical file');
  if(b.scaffold.replace('<SCSP_CYCLE2_CODE>','').trimEnd()!==a.scaffold.trimEnd())fail('example executable scaffold changed');
  const stripQueries=source=>source.replace(/(\.\/[A-Za-z0-9_]+\.js)\?v=[A-Za-z0-9-]+/g,'$1');
  let next=after[project].toString('utf8');
  const seed=/^[\t ]*fs\.writeText\('\/examples\/cycle2\.js',\s*SCSP_CYCLE2_CODE\);\r?\n/gm;
  if([...next.matchAll(seed)].length!==1)fail('expected exactly one Cycle seed');
  next=next.replace(seed,'').replace(/,\s*SCSP_CYCLE2_CODE(?=\s*})/,'');
  if(stripQueries(next)!==stripQueries(before[project].toString('utf8')))fail('project changes beyond example seed/import/cache query');
  if(stripQueries(after[host].toString('utf8'))!==stripQueries(before[host].toString('utf8')))fail('Code host changes beyond cache query');
  return {oldExamples:a.order.length,addedPath:'/examples/cycle2.js',canonicalExact:true,oldBodiesExact:true,oldStarterAndRestoreExact:true,exampleExecuted:false};
}
function restoreBody(bytes,entry){
  const parts=[];let cursor=0;
  if(!Array.isArray(entry.reverseHunks)||!entry.reverseHunks.length)fail('missing exact source recipe');
  for(const h of entry.reverseHunks){
    if(!keys(h,['afterOffset','afterBytes','beforeText'])||!Number.isSafeInteger(h.afterOffset)||h.afterOffset<cursor||!Number.isSafeInteger(h.afterBytes)||h.afterBytes<0||h.afterOffset+h.afterBytes>bytes.length||typeof h.beforeText!=='string')fail('invalid exact source recipe');
    parts.push(bytes.subarray(cursor,h.afterOffset),Buffer.from(h.beforeText));cursor=h.afterOffset+h.afterBytes;
  }
  parts.push(bytes.subarray(cursor));const previous=Buffer.concat(parts);
  if(!matches(previous,entry.before))fail('complete predecessor reconstruction mismatch');
  return previous;
}
function createRestorer(readSource,snapshot=false){
  let receipt,verified=false;
  return(path,bytes)=>{
    const name=nameOf(path);if(!SCSP_CYCLE2_UI_SOURCES.includes(name))return bytes;
    if(!receipt||!snapshot){
      receipt=JSON.parse(readSource(new URL('../'+SCSP_CYCLE2_UI_RECEIPT,import.meta.url)));
      if(sha(JSON.stringify(receipt))!==SCSP_CYCLE2_UI_PIN)fail('independently pinned receipt changed');
      if(receipt.schemaVersion!==1||receipt.scope!=='scsp-cycle2-selectable-ui-and-example'||receipt.baseCommit!==SCSP_CYCLE2_UI_BASE||!keys(receipt.sources,SCSP_CYCLE2_UI_SOURCES)||!keys(receipt.relatedSources,SCSP_CYCLE2_UI_RELATED)||!keys(receipt.reports,SCSP_CYCLE2_UI_REPORTS))fail('receipt inventory changed');
      for(const source of SCSP_CYCLE2_UI_SOURCES)if(receipt.sources[source].beforeCommit!==(SCSP_CYCLE2_UI_PREDECESSORS[source]??SCSP_CYCLE2_UI_BASE))fail('source predecessor commit changed: '+source);
    }
    const entry=receipt.sources[name];if(!matches(bytes,entry.after))return bytes;
    if(!verified){
      const current={},previous={};
      for(const dependency of [...SCSP_CYCLE2_UI_SOURCES,...SCSP_CYCLE2_UI_RELATED,...SCSP_CYCLE2_UI_REPORTS]){
        const data=Buffer.from(readSource(new URL('../'+dependency,import.meta.url))),expected=receipt.sources[dependency]?.after??receipt.relatedSources[dependency]??receipt.reports[dependency];
        if(!matches(data,expected))fail('pinned source/report dependency changed: '+dependency);
        if(SCSP_CYCLE2_UI_SOURCES.includes(dependency)){current[dependency]=data;previous[dependency]=restoreBody(data,receipt.sources[dependency]);}
      }
      if(!same(verifyScspCycle2UiExampleData(previous,current,readSource(new URL('../docs/synth-scsp/examples/cycle2.js',import.meta.url))),receipt.exampleData))fail('example data proof changed');
      const parity=JSON.parse(readSource(new URL('../docs/issues/scsp_cycle2_presets_parity_01.json',import.meta.url)));
      if(parity.cases.length!==206||parity.deviceOpened!==false)fail('unchanged native parity record scope changed');
      for(const path of ['docs/synth-scsp/routing.js','docs/synth-scsp/patch.js','docs/synth-scsp/instrument.js']){
        const record=receipt.relatedSources[path];
        if(!same(parity.sources[path],record))fail('native parity source no longer matches UI input: '+path);
      }
      if(!same(parity.binary,receipt.relatedSources['docs/generated/scsp_wasm.wasm']))fail('native parity binary changed');
      const old=JSON.parse(readSource(new URL('../docs/issues/scsp_fm_multiple_self_source_revision_01.json',import.meta.url)));
      if(!same(receipt.sources['docs/synth-scsp/README.md'].before,old.sources['docs/synth-scsp/README.md'].after))fail('README predecessor differs from its original native receipt');
      verified=snapshot;
    }
    return restoreBody(Buffer.from(bytes),entry);
  };
}
export function restoreMixerCalibrationScspCycle2UiRevision(path,bytes,{readSource=read}={}){return createRestorer(readSource)(path,bytes);}
export function createScspCycle2UiRevisionReadContext(readSource=read){
  const originals=new Map(),predecessors=new Map();
  const original=url=>{const key=url instanceof URL?url.href:url;if(!originals.has(key))originals.set(key,Buffer.from(readSource(url)));return originals.get(key);};
  const restore=createRestorer(original,true);
  const reader=url=>{const key=url instanceof URL?url.href:url;if(!predecessors.has(key)){const bytes=original(url),name=url instanceof URL&&url.protocol==='file:'?relative(root,fileURLToPath(url)).replaceAll('\\','/'):null;predecessors.set(key,name===null?bytes:restore(name,bytes));}return predecessors.get(key);};
  return {restore,readSource:reader};
}
