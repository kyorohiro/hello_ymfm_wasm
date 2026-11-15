/** One exact passive SCSP Code link insertion, chained over the reviewed viewer.
 * Complete source and measurement fingerprints remain independently pinned.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {MEASURED_POLICY_REVISION_RECEIPT_PATH,MEASURED_POLICY_REVISION_RECEIPT_OBJECT_SHA256,
  MEASURED_POLICY_REVISION_REPORT_PATHS} from './mixer_calibration_measured_policy_revision.mjs';

export const SCSP_NAVIGATION_REVISION_PATH='playground/playground_monaco_definitions.js';
export const SCSP_NAVIGATION_REVISION_BASE_COMMIT='201bfcb0da583e1726dfad47f054af9293ef462e';
export const SCSP_NAVIGATION_REVISION_RECEIPT_PATH='docs/issues/scsp_shared_client_navigation_ui_revision_01.json';
export const SCSP_NAVIGATION_REVISION_RECEIPT_OBJECT_SHA256='bd2a7face11e59781fb7f6b890912aaae43f1cd396fba0189ee9dbe1e8d1c4b9';
export const SCSP_NAVIGATION_REVISION_INSERTION="  if(owner==='ScspCodeClient')\n"+
  "    return {file:'synth-scsp/code_endpoint.js',symbol:'createScspCodeClient'};\n";
export const SCSP_NAVIGATION_PREDECESSOR_RECEIPT_PATH='docs/issues/nes_shared_client_navigation_ui_revision_01.json';
export const SCSP_NAVIGATION_PREDECESSOR_RECEIPT_OBJECT_SHA256='3f15d552364074d096509e2e08caa4ba8496cc8088fcda6911ca77ed44cb6d72';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[0-9a-f]{64}$/.test(value.sha256);
const fail=message=>{throw Error('Invalid SCSP source-navigation revision: '+message);};
let cached;

function verifiedReceipt(){
  if(cached)return cached;
  const value=JSON.parse(readFileSync(new URL('../'+SCSP_NAVIGATION_REVISION_RECEIPT_PATH,import.meta.url),'utf8'));
  if(sha(JSON.stringify(value))!==SCSP_NAVIGATION_REVISION_RECEIPT_OBJECT_SHA256)fail('independent receipt pin mismatch');
  const predecessor=JSON.parse(readFileSync(new URL('../'+SCSP_NAVIGATION_PREDECESSOR_RECEIPT_PATH,import.meta.url),'utf8'));
  if(sha(JSON.stringify(predecessor))!==SCSP_NAVIGATION_PREDECESSOR_RECEIPT_OBJECT_SHA256)fail('predecessor receipt pin mismatch');
  const measured=JSON.parse(readFileSync(new URL('../'+MEASURED_POLICY_REVISION_RECEIPT_PATH,import.meta.url),'utf8'));
  if(sha(JSON.stringify(measured))!==MEASURED_POLICY_REVISION_RECEIPT_OBJECT_SHA256)fail('measurement receipt pin mismatch');
  if(value.schemaVersion!==1||value.scope!=='scsp-passive-shared-client-source-navigation'
    ||value.path!==SCSP_NAVIGATION_REVISION_PATH||value.baseCommit!==SCSP_NAVIGATION_REVISION_BASE_COMMIT
    ||!record(value.before)||!record(value.after)||value.removedText!==SCSP_NAVIGATION_REVISION_INSERTION
    ||!Number.isSafeInteger(value.afterOffset)||value.afterOffset<0
    ||value.afterOffset+Buffer.byteLength(value.removedText)>value.after.bytes
    ||JSON.stringify(value.before)!==JSON.stringify(predecessor.after)
    ||JSON.stringify(value.reports)!==JSON.stringify(measured.reports)
    ||JSON.stringify(value.reports)!==JSON.stringify(predecessor.reports))fail('exact source/report inventory mismatch');
  cached=value;return value;
}

export function restoreMixerCalibrationScspNavigationRevision(path,bytes,{readSource=url=>readFileSync(url)}={}){
  if(path!==SCSP_NAVIGATION_REVISION_PATH)return bytes;
  const evidence=verifiedReceipt();
  if(bytes.length!==evidence.after.bytes||sha(bytes)!==evidence.after.sha256)return bytes;
  for(const name of MEASURED_POLICY_REVISION_REPORT_PATHS){
    const actual=readSource(new URL('../'+name,import.meta.url)),expected=evidence.reports[name];
    if(!record(expected)||actual.length!==expected.bytes||sha(actual)!==expected.sha256)fail('original measurement changed: '+name);
  }
  const start=evidence.afterOffset,end=start+Buffer.byteLength(evidence.removedText);
  if(bytes.subarray(start,end).toString()!==evidence.removedText)fail('exact passive insertion changed');
  const original=Buffer.concat([bytes.subarray(0,start),bytes.subarray(end)]);
  if(original.length!==evidence.before.bytes||sha(original)!==evidence.before.sha256)fail('complete predecessor reconstruction failed');
  return original;
}
