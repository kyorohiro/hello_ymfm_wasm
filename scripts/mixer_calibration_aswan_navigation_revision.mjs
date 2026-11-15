/** Reviewed ASWAN implementation links over the pinned SCSP source viewer. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {MEASURED_POLICY_REVISION_RECEIPT_PATH,MEASURED_POLICY_REVISION_RECEIPT_OBJECT_SHA256,
  MEASURED_POLICY_REVISION_REPORT_PATHS} from './mixer_calibration_measured_policy_revision.mjs';

export const ASWAN_NAVIGATION_REVISION_PATH='playground/playground_monaco_definitions.js';
export const ASWAN_NAVIGATION_REVISION_BASE_COMMIT='456ec304c7506b9e278a2f773b5cf209c4a3be49';
export const ASWAN_NAVIGATION_REVISION_RECEIPT_PATH='docs/issues/aswan_shared_client_navigation_ui_revision_01.json';
export const ASWAN_NAVIGATION_REVISION_RECEIPT_OBJECT_SHA256='ecb9e444e9a0425510ed3ea4f5b03b676367bdda64d496d610f0dc555929949c';
export const ASWAN_NAVIGATION_REVISION_INSERTIONS=Object.freeze([
  "  if(owner==='AswanCodeClient'&&['getState','noteOff','dispose'].includes(symbol))\n"+
    "    return {file:'synth-aswan/code_endpoint.js',symbol:'createAswanCodeClient'};\n",
  "  if (/^Playground(?:Primary)?WonderSwan(?:TimelineBuilder)?$/.test(owner)) return {file:'wonderswansynth.js',symbol:/^Playground/.test(symbol)?'WonderSwanSynth':symbol};\n",
]);
export const ASWAN_NAVIGATION_PREDECESSOR_RECEIPT_PATH='docs/issues/scsp_shared_client_navigation_ui_revision_01.json';
export const ASWAN_NAVIGATION_PREDECESSOR_RECEIPT_OBJECT_SHA256='bd2a7face11e59781fb7f6b890912aaae43f1cd396fba0189ee9dbe1e8d1c4b9';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[0-9a-f]{64}$/.test(value.sha256);
const fail=message=>{throw Error('Invalid ASWAN source-navigation revision: '+message);};

function verifiedReceipt(readSource){
  const value=JSON.parse(readSource(new URL('../'+ASWAN_NAVIGATION_REVISION_RECEIPT_PATH,import.meta.url)));
  if(sha(JSON.stringify(value))!==ASWAN_NAVIGATION_REVISION_RECEIPT_OBJECT_SHA256)fail('independent receipt pin mismatch');
  const predecessor=JSON.parse(readSource(new URL('../'+ASWAN_NAVIGATION_PREDECESSOR_RECEIPT_PATH,import.meta.url)));
  if(sha(JSON.stringify(predecessor))!==ASWAN_NAVIGATION_PREDECESSOR_RECEIPT_OBJECT_SHA256)fail('predecessor receipt pin mismatch');
  const measured=JSON.parse(readSource(new URL('../'+MEASURED_POLICY_REVISION_RECEIPT_PATH,import.meta.url)));
  if(sha(JSON.stringify(measured))!==MEASURED_POLICY_REVISION_RECEIPT_OBJECT_SHA256)fail('measurement receipt pin mismatch');
  if(value.schemaVersion!==1||value.scope!=='aswan-passive-shared-client-source-navigation'
    ||value.path!==ASWAN_NAVIGATION_REVISION_PATH||value.baseCommit!==ASWAN_NAVIGATION_REVISION_BASE_COMMIT
    ||!record(value.before)||!record(value.after)
    ||JSON.stringify(value.before)!==JSON.stringify(predecessor.after)
    ||JSON.stringify(value.reports)!==JSON.stringify(measured.reports)
    ||JSON.stringify(value.reports)!==JSON.stringify(predecessor.reports)
    ||!Array.isArray(value.insertions)||value.insertions.length!==ASWAN_NAVIGATION_REVISION_INSERTIONS.length)
    fail('exact source/report inventory mismatch');
  let end=0;
  for(const [index,insertion]of value.insertions.entries()){
    if(!insertion||Object.keys(insertion).length!==2
      ||insertion.removedText!==ASWAN_NAVIGATION_REVISION_INSERTIONS[index]
      ||!Number.isSafeInteger(insertion.afterOffset)||insertion.afterOffset<end)
      fail('exact insertion inventory mismatch');
    end=insertion.afterOffset+Buffer.byteLength(insertion.removedText);
    if(end>value.after.bytes)fail('insertion outside complete source');
  }
  return value;
}

export function restoreMixerCalibrationAswanNavigationRevision(path,bytes,{readSource=url=>readFileSync(url)}={}){
  if(path!==ASWAN_NAVIGATION_REVISION_PATH)return bytes;
  const evidence=verifiedReceipt(readSource);
  if(bytes.length!==evidence.after.bytes||sha(bytes)!==evidence.after.sha256)return bytes;
  for(const name of MEASURED_POLICY_REVISION_REPORT_PATHS){
    const actual=readSource(new URL('../'+name,import.meta.url)),expected=evidence.reports[name];
    if(!record(expected)||actual.length!==expected.bytes||sha(actual)!==expected.sha256)
      fail('original measurement changed: '+name);
  }
  let original=Buffer.from(bytes);
  for(const insertion of [...evidence.insertions].reverse()){
    const start=insertion.afterOffset,end=start+Buffer.byteLength(insertion.removedText);
    if(original.subarray(start,end).toString()!==insertion.removedText)fail('exact passive insertion changed');
    original=Buffer.concat([original.subarray(0,start),original.subarray(end)]);
  }
  if(original.length!==evidence.before.bytes||sha(original)!==evidence.before.sha256)
    fail('complete predecessor reconstruction failed');
  return original;
}
