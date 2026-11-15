/** One exact passive NES Code link insertion, chained over the reviewed viewer.
 * Complete source and measurement fingerprints remain independently pinned.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {restoreMixerCalibrationScspNavigationRevision} from './mixer_calibration_scsp_navigation_revision.mjs';
import {MEASURED_POLICY_REVISION_RECEIPT_PATH,MEASURED_POLICY_REVISION_RECEIPT_OBJECT_SHA256,
  MEASURED_POLICY_REVISION_REPORT_PATHS} from './mixer_calibration_measured_policy_revision.mjs';

export const NES_NAVIGATION_REVISION_PATH='playground/playground_monaco_definitions.js';
export const NES_NAVIGATION_REVISION_BASE_COMMIT='1a0d162e990b44bd7fd36faabf48dff19cac92bc';
export const NES_NAVIGATION_REVISION_RECEIPT_PATH='docs/issues/nes_shared_client_navigation_ui_revision_01.json';
export const NES_NAVIGATION_REVISION_RECEIPT_OBJECT_SHA256='3f15d552364074d096509e2e08caa4ba8496cc8088fcda6911ca77ed44cb6d72';
export const NES_NAVIGATION_REVISION_INSERTION="  if(owner==='NesCodeClient'&&['noteOn','keyOn','getState','allNotesOff','dispose'].includes(symbol))\n"+
  "    return {file:'synth-2a03/code_endpoint.js',symbol:'createNesCodeClient'};\n";
export const NES_NAVIGATION_PREDECESSOR_RECEIPT_PATH='docs/issues/fm2608_hardware_navigation_ui_revision_01.json';
export const NES_NAVIGATION_PREDECESSOR_RECEIPT_OBJECT_SHA256='2d64fcde3b7e0dc9038ac0b1b32cf969fa4954b63eb8262bc1f046553baa26c4';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[0-9a-f]{64}$/.test(value.sha256);
const fail=message=>{throw Error('Invalid NES source-navigation revision: '+message);};
let cached;

function verifiedReceipt(){
  if(cached)return cached;
  const value=JSON.parse(readFileSync(new URL('../'+NES_NAVIGATION_REVISION_RECEIPT_PATH,import.meta.url),'utf8'));
  if(sha(JSON.stringify(value))!==NES_NAVIGATION_REVISION_RECEIPT_OBJECT_SHA256)fail('independent receipt pin mismatch');
  const predecessor=JSON.parse(readFileSync(new URL('../'+NES_NAVIGATION_PREDECESSOR_RECEIPT_PATH,import.meta.url),'utf8'));
  if(sha(JSON.stringify(predecessor))!==NES_NAVIGATION_PREDECESSOR_RECEIPT_OBJECT_SHA256)fail('predecessor receipt pin mismatch');
  const measured=JSON.parse(readFileSync(new URL('../'+MEASURED_POLICY_REVISION_RECEIPT_PATH,import.meta.url),'utf8'));
  if(sha(JSON.stringify(measured))!==MEASURED_POLICY_REVISION_RECEIPT_OBJECT_SHA256)fail('measurement receipt pin mismatch');
  if(value.schemaVersion!==1||value.scope!=='nes-passive-shared-client-source-navigation'
    ||value.path!==NES_NAVIGATION_REVISION_PATH||value.baseCommit!==NES_NAVIGATION_REVISION_BASE_COMMIT
    ||!record(value.before)||!record(value.after)||value.removedText!==NES_NAVIGATION_REVISION_INSERTION
    ||!Number.isSafeInteger(value.afterOffset)||value.afterOffset<0
    ||value.afterOffset+Buffer.byteLength(value.removedText)>value.after.bytes
    ||JSON.stringify(value.before)!==JSON.stringify(predecessor.after)
    ||JSON.stringify(value.reports)!==JSON.stringify(measured.reports)
    ||JSON.stringify(value.reports)!==JSON.stringify(predecessor.reports))fail('exact source/report inventory mismatch');
  cached=value;return value;
}

export function restoreMixerCalibrationNesNavigationRevision(path,bytes,{readSource=url=>readFileSync(url)}={}){
  bytes=restoreMixerCalibrationScspNavigationRevision(path,bytes,{readSource});
  if(path!==NES_NAVIGATION_REVISION_PATH)return bytes;
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
