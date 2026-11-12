/** Exact reviewed pure VAB helpers, additive bindings and passive cache/UI
 * rollout. Reconstruct complete predecessor bytes before older evidence layers.
 * Original calibration reports, DSP and gains are never rewritten or skipped.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

export const VAB_API_REVISION_BASE_COMMIT='1ec321b014a67a757bfa7c847c998f3e47584203';
export const VAB_API_REVISION_RECEIPT_PATH='docs/issues/ps1_vab_public_api_source_revision_01.json';
export const VAB_API_REVISION_RECEIPT_OBJECT_SHA256='c6acbc62409a143a87b559c0e255395e294338fe19f1067eb664a947ce34c6c3';
export const VAB_API_REVISION_REPORT_PATHS=Object.freeze([
  'docs/issues/soundchip_psg_levels_05.json',
  ...['ps1','wonderswan','pokey','scsp'].map(kind=>`docs/issues/${kind}_state_restore_chip_levels_01.json`),
]);
export const VAB_API_REVISION_SOURCE_PATHS=Object.freeze([
  'docs/js/playground_logic_worker.js','docs/js/playground_ps1.js','docs/js/playground_ps1_inspector.js',
  'docs/js/playground_ps1_worklet.js','docs/js/playground_runtime.js',
  'docs/playground/index.html','docs/playground/playground.js','docs/playground/playground_examples.js',
  'docs/playground/playground_monaco.js','docs/playground/playground_monaco_definitions.js',
  'docs/playground/playground_ps1_psf.js','docs/playground/playground_ps1_vab.js',
  'docs/playground/playground_ps1_vab_panel.js','tetorica_src/runtime/soundchip.js',
]);
export const VAB_API_REVISION_RELATED_PATHS=Object.freeze([
  'tetorica_src/runtime/ps1_vab.js','docs/js/ps1_vab.js','docs/js/soundchip.js',
  'tetorica_src/runtime/playground_runtime.js','tetorica_src/runtime/playground_logic_worker.js',
  'tetorica_src/runtime/playground_ps1.js',
  'tetorica_src/runtime/playground_code_runtime.js','docs/js/playground_code_runtime.js',
  'docs/js/megasynth_offline.js','docs/js/sid_soundchip.js','docs/js/soundchip-output-worklet.js','docs/js/soundchip_worklet.js',
  'docs/playground/tetorica-playground-globals.d.ts','docs/playground/playground_mode_examples.js',
  'docs/playground/examples/ps1/ps1-vab-tone.js',
  'docs/generated/ps1_spu_wasm.wasm','docs/generated/segapsg_wasm.wasm','docs/generated/ay8910_wasm.wasm','docs/generated/nesapu_wasm.wasm',
  'tetorica_src/runtime/soundchip_mixer_presets.js',
]);
export const VAB_API_PRIOR_EXPORT_BEFORE_COMMIT='f84e5455b1fe89699ab86d7d4b42aad97ebd5aa0';
export const VAB_API_PRIOR_EXPORT_AFTER_COMMIT='f26d8412cdb86a55fc1689baca1a7d090c563872';
export const VAB_API_PRIOR_EXPORT_PATHS=Object.freeze(['docs/playground/playground_ps1_vab.js','docs/playground/playground_ps1_psf.js']);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[0-9a-f]{64}$/.test(value.sha256);
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const fail=message=>{throw Error('Invalid VAB public API calibration revision; remeasure or review a new exact revision: '+message);};
let receipt;
function verifiedReceipt() {
  if(receipt)return receipt;
  const value=JSON.parse(readFileSync(new URL('../'+VAB_API_REVISION_RECEIPT_PATH,import.meta.url),'utf8'));
  if(sha(JSON.stringify(value))!==VAB_API_REVISION_RECEIPT_OBJECT_SHA256)fail('receipt does not match its independently pinned SHA');
  if(value.schemaVersion!==1||value.scope!=='ps1-vab-pure-api-and-passive-routing'||value.baseCommit!==VAB_API_REVISION_BASE_COMMIT||
    !keys(value.sources,VAB_API_REVISION_SOURCE_PATHS)||!keys(value.relatedSources,VAB_API_REVISION_RELATED_PATHS)||!keys(value.reports,VAB_API_REVISION_REPORT_PATHS))fail('scope or exact inventory mismatch');
  for(const path of VAB_API_REVISION_REPORT_PATHS)if(!record(value.reports[path]))fail('invalid original report record: '+path);
  for(const path of VAB_API_REVISION_RELATED_PATHS) {
    const entry=value.relatedSources[path];if(!record(entry?.after)||entry.before!==null&&!record(entry.before))fail('invalid related source record: '+path);
  }
  function validateSources(entries,paths) {
    if(!keys(entries,paths))fail('exact source-pair inventory mismatch');
    for(const path of paths) {
      const entry=entries[path];
      if(!record(entry?.before)||!record(entry.after)||!Array.isArray(entry.reverseHunks)||!entry.reverseHunks.length)fail('invalid complete source pair: '+path);
      let cursor=0;
      for(const hunk of entry.reverseHunks) {
        if(!keys(hunk,['afterOffset','afterBytes','beforeText'])||!Number.isSafeInteger(hunk.afterOffset)||hunk.afterOffset<cursor||
          !Number.isSafeInteger(hunk.afterBytes)||hunk.afterBytes<0||hunk.afterOffset+hunk.afterBytes>entry.after.bytes||typeof hunk.beforeText!=='string')fail('invalid reverse hunk: '+path);
        cursor=hunk.afterOffset+hunk.afterBytes;
      }
    }
  }
  validateSources(value.sources,VAB_API_REVISION_SOURCE_PATHS);
  const prior=value.priorSourceExport;
  if(prior?.beforeCommit!==VAB_API_PRIOR_EXPORT_BEFORE_COMMIT||prior.afterCommit!==VAB_API_PRIOR_EXPORT_AFTER_COMMIT)fail('prior source-export identity mismatch');
  validateSources(prior.sources,VAB_API_PRIOR_EXPORT_PATHS);
  receipt=value;return receipt;
}
function restore(bytes,entry,path) {
  if(bytes.length!==entry.after.bytes||sha(bytes)!==entry.after.sha256)return bytes;
  const source=Buffer.from(bytes),parts=[];let cursor=0;
  for(const hunk of entry.reverseHunks){parts.push(source.subarray(cursor,hunk.afterOffset),Buffer.from(hunk.beforeText));cursor=hunk.afterOffset+hunk.afterBytes;}
  parts.push(source.subarray(cursor));const original=Buffer.concat(parts);
  if(original.length!==entry.before.bytes||sha(original)!==entry.before.sha256)fail('complete predecessor reconstruction failed: '+path);
  return original;
}

/** Only exact named after bodies are reversible. The two historical paths
 * refer to the same canonical factory through its existing layout adapter.
 * readSource is a test seam; the pinned receipt and inventories never vary.
 */
export function restoreMixerCalibrationVabApiRevision(path,bytes,{readSource=url=>readFileSync(url)}={}) {
  const name=path==='web/soundchip.js'?'tetorica_src/runtime/soundchip.js':path.startsWith('js/')||path.startsWith('playground/')?'docs/'+path:path;
  if(!VAB_API_REVISION_SOURCE_PATHS.includes(name))return bytes;
  const evidence=verifiedReceipt(),entry=evidence.sources[name],prior=evidence.priorSourceExport.sources[name];
  const matches=pair=>pair&&bytes.length===pair.after.bytes&&sha(bytes)===pair.after.sha256;
  if(!matches(entry)&&!matches(prior))return bytes;
  for(const source of [...VAB_API_REVISION_REPORT_PATHS,...VAB_API_REVISION_RELATED_PATHS]) {
    const expected=evidence.reports[source]??evidence.relatedSources[source].after,current=readSource(new URL('../'+source,import.meta.url));
    if(current.length!==expected.bytes||sha(current)!==expected.sha256)fail('pinned report/helper/cache dependency changed: '+source);
  }
  bytes=restore(bytes,entry,name);
  return prior?restore(bytes,prior,name):bytes;
}
