/** Two exact passive draft-checkpoint UI insertions. Audio and measured report
 * bytes stay unchanged; no future panel edit is authorized by this receipt.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {MEASURED_POLICY_REVISION_RECEIPT_PATH,MEASURED_POLICY_REVISION_RECEIPT_OBJECT_SHA256,
  MEASURED_POLICY_REVISION_REPORT_PATHS} from './mixer_calibration_measured_policy_revision.mjs';

export const SCSP_DRAFT_REVISION_PATH='playground/playground_scsp_voice_panel.js';
export const SCSP_DRAFT_REVISION_RECEIPT_PATH='docs/issues/scsp_draft_checkpoint_ui_revision_01.json';
export const SCSP_DRAFT_REVISION_RECEIPT_OBJECT_SHA256='55eb13d7fda360ffd8dffb3e6ddf44a5c58cf20e775dda5db223607fa5acae37';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[0-9a-f]{64}$/.test(value.sha256);
const fail=message=>{throw Error('Invalid SCSP draft-checkpoint UI revision: '+message);};
let cached;

function verifiedReceipt(){
  if(cached)return cached;
  const value=JSON.parse(readFileSync(new URL('../'+SCSP_DRAFT_REVISION_RECEIPT_PATH,import.meta.url),'utf8'));
  if(sha(JSON.stringify(value))!==SCSP_DRAFT_REVISION_RECEIPT_OBJECT_SHA256)fail('independent receipt pin mismatch');
  const measured=JSON.parse(readFileSync(new URL('../'+MEASURED_POLICY_REVISION_RECEIPT_PATH,import.meta.url),'utf8'));
  if(sha(JSON.stringify(measured))!==MEASURED_POLICY_REVISION_RECEIPT_OBJECT_SHA256)fail('measurement receipt pin mismatch');
  if(value.schemaVersion!==1||value.scope!=='scsp-passive-ui-draft-checkpoint'||value.path!==SCSP_DRAFT_REVISION_PATH
    ||!record(value.before)||!record(value.after)||!Array.isArray(value.edits)||value.edits.length!==2
    ||JSON.stringify(Object.keys(value.reports??{}))!==JSON.stringify(MEASURED_POLICY_REVISION_REPORT_PATHS)
    ||JSON.stringify(value.reports)!==JSON.stringify(measured.reports))fail('exact source/report inventory mismatch');
  let end=0;
  for(const edit of value.edits){
    if(!Number.isSafeInteger(edit.afterOffset)||edit.afterOffset<end||typeof edit.oldText!=='string'
      ||typeof edit.newText!=='string'||!edit.newText.length)fail('invalid exact edit');
    end=edit.afterOffset+Buffer.byteLength(edit.newText);
    if(end>value.after.bytes)fail('edit outside complete source');
  }
  cached=value;return value;
}

export function restoreMixerCalibrationScspDraftRevision(path,bytes,{readSource=url=>readFileSync(url)}={}){
  if(path!==SCSP_DRAFT_REVISION_PATH)return bytes;
  const evidence=verifiedReceipt();
  if(bytes.length!==evidence.after.bytes||sha(bytes)!==evidence.after.sha256)return bytes;
  for(const name of MEASURED_POLICY_REVISION_REPORT_PATHS){
    const actual=readSource(new URL('../'+name,import.meta.url)),expected=evidence.reports[name];
    if(!record(expected)||actual.length!==expected.bytes||sha(actual)!==expected.sha256)fail('original measurement changed: '+name);
    const report=JSON.parse(actual),source=report.sources?.[path];
    if(source?.bytes!==evidence.before.bytes||source?.sha256!==evidence.before.sha256)fail('measurement source detached: '+name);
  }
  let original=Buffer.from(bytes);
  for(const edit of [...evidence.edits].reverse()){
    const start=edit.afterOffset,end=start+Buffer.byteLength(edit.newText);
    if(original.subarray(start,end).toString()!==edit.newText)fail('exact passive insertion changed');
    original=Buffer.concat([original.subarray(0,start),Buffer.from(edit.oldText),original.subarray(end)]);
  }
  if(original.length!==evidence.before.bytes||sha(original)!==evidence.before.sha256)fail('complete predecessor reconstruction failed');
  return original;
}
