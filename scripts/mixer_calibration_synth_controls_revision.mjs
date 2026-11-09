/** Exact reviewed UI-only changes to the shared FM controls. This is not a
 * general UI normalizer: only one complete after source may reconstruct the
 * complete measured source. Original measurements and DSP fingerprints remain
 * untouched; a future source edit still requires review or remeasurement.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

export const SYNTH_CONTROLS_REVISION_RECEIPT_PATH='docs/issues/fm2612_synth_controls_source_revision_01.json';
export const SYNTH_CONTROLS_REVISION_RECEIPT_OBJECT_SHA256='58eba3421112b9352d15bac08a1406a4b28e560c52e00ddb44166c3c2335b76b';
export const SYNTH_CONTROLS_REVISION_SOURCE_PATH='synth/synth_controls.js';
const beforeCommit='4a38654c4c91e02a05612b6a7b8f0fcf5b8c4dac';
const afterCommit='d6d722449487e3abd64e8a539eac6f7370afd8d4';
const reportPaths=['ps1','wonderswan','pokey','scsp'].map(kind=>`docs/issues/${kind}_state_restore_chip_levels_01.json`);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&digest(value.sha256);
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const fail=message=>{throw new Error('Invalid FM controls calibration revision: '+message);};
let receipt;
function verifiedReceipt() {
  if(receipt)return receipt;
  const candidate=JSON.parse(readFileSync(new URL('../'+SYNTH_CONTROLS_REVISION_RECEIPT_PATH,import.meta.url),'utf8'));
  if(sha(JSON.stringify(candidate))!==SYNTH_CONTROLS_REVISION_RECEIPT_OBJECT_SHA256)fail('receipt does not match its independently pinned SHA');
  if(candidate.schemaVersion!==1||candidate.scope!=='fm2612-shared-controls-ui-only'||candidate.feature!=='Live text refresh and optional Synth OP gate buttons'||
    candidate.beforeCommit!==beforeCommit||candidate.afterCommit!==afterCommit||!keys(candidate.reports,reportPaths))fail('scope or report inventory mismatch');
  for(const path of reportPaths)if(!record(candidate.reports[path]))fail('invalid historical report record');
  const source=candidate.source;
  if(source?.path!==SYNTH_CONTROLS_REVISION_SOURCE_PATH||!record(source.before)||!record(source.after)||!Array.isArray(source.reverseHunks)||!source.reverseHunks.length)fail('invalid source revision');
  let cursor=0;
  for(const hunk of source.reverseHunks) {
    if(!keys(hunk,['afterOffset','afterBytes','beforeText'])||!Number.isSafeInteger(hunk.afterOffset)||hunk.afterOffset<cursor||
      !Number.isSafeInteger(hunk.afterBytes)||hunk.afterBytes<0||hunk.afterOffset+hunk.afterBytes>source.after.bytes||typeof hunk.beforeText!=='string')fail('invalid reverse hunk');
    cursor=hunk.afterOffset+hunk.afterBytes;
  }
  receipt=candidate;return receipt;
}

/** Unknown paths and non-exact current bytes are returned unchanged. A matched
 * revision must reproduce the whole authenticated measured body, not just the
 * changed sections. The caller still checks its original report fingerprint.
 */
export function restoreMixerCalibrationSynthControlsRevision(path,bytes) {
  if(path!==SYNTH_CONTROLS_REVISION_SOURCE_PATH)return bytes;
  const entry=verifiedReceipt().source;
  if(Buffer.byteLength(bytes)!==entry.after.bytes||sha(bytes)!==entry.after.sha256)return bytes;
  const current=Buffer.from(bytes),parts=[];let cursor=0;
  for(const hunk of entry.reverseHunks) {
    parts.push(current.subarray(cursor,hunk.afterOffset),Buffer.from(hunk.beforeText));
    cursor=hunk.afterOffset+hunk.afterBytes;
  }
  parts.push(current.subarray(cursor));const original=Buffer.concat(parts);
  if(original.length!==entry.before.bytes||sha(original)!==entry.before.sha256)fail('complete measured source reconstruction failed');
  return original;
}
