/** Exact empty-slot draft restoration UI revision. No sample or RAM is written.
 * Restore the complete reviewed checkpoint predecessor, then its earlier layer
 * authenticates the original, unchanged audio measurements.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {SCSP_DRAFT_REVISION_PATH,SCSP_DRAFT_REVISION_RECEIPT_PATH,
  SCSP_DRAFT_REVISION_RECEIPT_OBJECT_SHA256,restoreMixerCalibrationScspDraftRevision}
  from './mixer_calibration_scsp_draft_revision.mjs';

export const SCSP_EMPTY_DRAFT_REVISION_PATH=SCSP_DRAFT_REVISION_PATH;
export const SCSP_EMPTY_DRAFT_REVISION_RECEIPT_PATH='docs/issues/scsp_empty_draft_checkpoint_ui_revision_01.json';
export const SCSP_EMPTY_DRAFT_REVISION_RECEIPT_OBJECT_SHA256='7aa620ba7095a6d9c3d13e7e70d6b9edfc5e1a94b4be67e5e08f08fde77786c3';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[0-9a-f]{64}$/.test(value.sha256);
const fail=message=>{throw Error('Invalid SCSP empty-draft UI revision: '+message);};
let cached;
function verifiedReceipt(){
  if(cached)return cached;
  const value=JSON.parse(readFileSync(new URL('../'+SCSP_EMPTY_DRAFT_REVISION_RECEIPT_PATH,import.meta.url),'utf8'));
  if(sha(JSON.stringify(value))!==SCSP_EMPTY_DRAFT_REVISION_RECEIPT_OBJECT_SHA256)fail('independent receipt pin mismatch');
  const previous=JSON.parse(readFileSync(new URL('../'+SCSP_DRAFT_REVISION_RECEIPT_PATH,import.meta.url),'utf8'));
  if(sha(JSON.stringify(previous))!==SCSP_DRAFT_REVISION_RECEIPT_OBJECT_SHA256)fail('predecessor receipt pin mismatch');
  if(value.schemaVersion!==1||value.scope!=='scsp-empty-slot-draft-checkpoint'||value.path!==SCSP_EMPTY_DRAFT_REVISION_PATH
    ||!record(value.before)||!record(value.after)||value.predecessor?.path!==SCSP_DRAFT_REVISION_RECEIPT_PATH
    ||value.predecessor?.objectSha256!==SCSP_DRAFT_REVISION_RECEIPT_OBJECT_SHA256
    ||JSON.stringify(value.before)!==JSON.stringify(previous.after)
    ||JSON.stringify(value.reports)!==JSON.stringify(previous.reports)
    ||!Array.isArray(value.edits)||value.edits.length!==2)fail('exact predecessor/report inventory mismatch');
  let end=0;
  for(const edit of value.edits){
    if(!Number.isSafeInteger(edit.afterOffset)||edit.afterOffset<end||typeof edit.oldText!=='string'
      ||typeof edit.newText!=='string'||!edit.oldText.length||!edit.newText.length)fail('invalid exact edit');
    end=edit.afterOffset+Buffer.byteLength(edit.newText);
    if(end>value.after.bytes)fail('edit outside complete source');
  }
  cached=value;return value;
}
export function restoreMixerCalibrationScspEmptyDraftRevision(path,bytes,{readSource=url=>readFileSync(url)}={}){
  if(path!==SCSP_EMPTY_DRAFT_REVISION_PATH)return bytes;
  const evidence=verifiedReceipt();
  if(bytes.length!==evidence.after.bytes||sha(bytes)!==evidence.after.sha256)return bytes;
  let original=Buffer.from(bytes);
  for(const edit of [...evidence.edits].reverse()){
    const start=edit.afterOffset,end=start+Buffer.byteLength(edit.newText);
    if(original.subarray(start,end).toString()!==edit.newText)fail('exact passive edit changed');
    original=Buffer.concat([original.subarray(0,start),Buffer.from(edit.oldText),original.subarray(end)]);
  }
  if(original.length!==evidence.before.bytes||sha(original)!==evidence.before.sha256)fail('complete predecessor reconstruction failed');
  // This verifies all eight complete original reports and their source hashes;
  // the caller still receives the exact immediate predecessor for layer order.
  if(restoreMixerCalibrationScspDraftRevision(path,original,{readSource})===original)
    fail('reviewed predecessor is not authenticated');
  return original;
}
