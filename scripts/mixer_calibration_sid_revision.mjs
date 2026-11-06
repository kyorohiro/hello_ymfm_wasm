/** Exact reviewed SID integration only. This restores the complete pre-SID
 * bytes before existing calibration evidence layers run; it is not a source
 * normalizer and grants no permission for a later runtime, UI or gain edit.
 * Keep this helper dependency-free so calibration/package checks need only Node.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

export const SID_PLAYGROUND_REVISION_BASE_COMMIT='fa0d4521a75694cc8e950424d7aeb83f1724b25e';
export const SID_PLAYGROUND_REVISION_RECEIPT_PATH='docs/issues/sid_playground_source_revision_01.json';
export const SID_PLAYGROUND_REVISION_RECEIPT_OBJECT_SHA256='2d4cbe13e301e1629f6cce281b0013f40235432ebf8080ae5d8166ed370256db';
export const SID_PLAYGROUND_REVISION_REPORT_PATHS=Object.freeze([
  'docs/issues/ps1_state_restore_chip_levels_01.json',
  'docs/issues/wonderswan_state_restore_chip_levels_01.json',
  'docs/issues/pokey_state_restore_chip_levels_01.json',
  'docs/issues/scsp_state_restore_chip_levels_01.json',
]);
export const SID_PLAYGROUND_REVISION_SOURCE_PATHS=Object.freeze([
  'js/native_runtime_synth.js','js/playground_chip_clock.js','js/playground_logic_worker.js',
  'js/playground_native_primary.js','js/playground_performance_processor.js','js/playground_runtime.js',
  'js/playground_soundchip_options.js','js/playground_soundchips.js','js/tetorica_synth.js',
  'playground/index.html','playground/playground.js','playground/playground_chip_tabs.js',
  'playground/playground_declarations.js','playground/playground_example_order.js','playground/playground_examples.js',
  'playground/playground_mode.js','playground/playground_monaco_completion.js','playground/playground_monaco_definitions.js',
  'playground/playground_ui.js','playground/playground_workbench.js',
]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&digest(value.sha256);
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const fail=message=>{throw new Error('Invalid SID Playground calibration revision: '+message);};
let receipt;
function verifiedReceipt(){
  if(receipt)return receipt;
  const candidate=JSON.parse(readFileSync(new URL('../'+SID_PLAYGROUND_REVISION_RECEIPT_PATH,import.meta.url),'utf8'));
  if(sha(JSON.stringify(candidate))!==SID_PLAYGROUND_REVISION_RECEIPT_OBJECT_SHA256)fail('receipt does not match its independently pinned SHA');
  if(candidate.schemaVersion!==1||candidate.scope!=='sid-playground-routing-only'||candidate.baseCommit!==SID_PLAYGROUND_REVISION_BASE_COMMIT||
    !keys(candidate.sources,SID_PLAYGROUND_REVISION_SOURCE_PATHS)||!keys(candidate.reports,SID_PLAYGROUND_REVISION_REPORT_PATHS))fail('scope or exact path inventory mismatch');
  for(const name of SID_PLAYGROUND_REVISION_REPORT_PATHS)if(!record(candidate.reports[name]))fail('invalid historical report record');
  for(const name of SID_PLAYGROUND_REVISION_SOURCE_PATHS){
    const entry=candidate.sources[name];
    if(!record(entry?.before)||!record(entry?.after)||!Array.isArray(entry.reverseHunks)||!entry.reverseHunks.length)fail('invalid source revision: '+name);
    let cursor=0;
    for(const hunk of entry.reverseHunks){
      if(!keys(hunk,['afterOffset','afterBytes','beforeText'])||!Number.isSafeInteger(hunk.afterOffset)||hunk.afterOffset<cursor||
        !Number.isSafeInteger(hunk.afterBytes)||hunk.afterBytes<0||hunk.afterOffset+hunk.afterBytes>entry.after.bytes||typeof hunk.beforeText!=='string')fail('invalid reverse hunk: '+name);
      cursor=hunk.afterOffset+hunk.afterBytes;
    }
  }
  receipt=candidate;return receipt;
}

/** Return the original object for every unknown path or non-exact after body.
 * A matched body must reconstruct the exact complete before SHA and length.
 * Reports keep their measured hashes; older approved revisions still run next.
 */
export function restoreMixerCalibrationSidRevision(path,bytes){
  if(!SID_PLAYGROUND_REVISION_SOURCE_PATHS.includes(path))return bytes;
  const entry=verifiedReceipt().sources[path];
  if(Buffer.byteLength(bytes)!==entry.after.bytes||sha(bytes)!==entry.after.sha256)return bytes;
  const source=Buffer.from(bytes),parts=[];let cursor=0;
  for(const hunk of entry.reverseHunks){
    parts.push(source.subarray(cursor,hunk.afterOffset),Buffer.from(hunk.beforeText));
    cursor=hunk.afterOffset+hunk.afterBytes;
  }
  parts.push(source.subarray(cursor));const original=Buffer.concat(parts);
  if(original.length!==entry.before.bytes||sha(original)!==entry.before.sha256)fail('complete before reconstruction failed: '+path);
  return original;
}
