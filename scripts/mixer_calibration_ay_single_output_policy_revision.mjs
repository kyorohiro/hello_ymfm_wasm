/** Exact generated-policy transition after real AY-extension remeasurements.
 * This does not authorize any renderer/WASM/source edit against old evidence.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
export const AY_SINGLE_OUTPUT_POLICY_RECEIPT_PATH='docs/issues/ay_single_output_mixer_policy_revision_01.json';
export const AY_SINGLE_OUTPUT_POLICY_RECEIPT_OBJECT_SHA256='b9e93e47b6f8980eeb5cf51c8765ccaffcc668d489b4e5b655a7fc37473c5969';
export const AY_SINGLE_OUTPUT_POLICY_SOURCE_PATH='tetorica_src/runtime/soundchip_mixer_presets.js';
export const AY_SINGLE_OUTPUT_POLICY_SERVED_PATH='docs/js/soundchip_mixer_presets.js';
export const AY_SINGLE_OUTPUT_POLICY_REPORT_PATHS=Object.freeze([
 'docs/issues/soundchip_psg_levels_06.json',
 ...['ps1','wonderswan','pokey','scsp'].map(kind=>`docs/issues/${kind}_ay_single_output_chip_levels_01.json`),
 ...['ps1','wonderswan'].map(kind=>`docs/issues/${kind}_spc_voice_edit_chip_levels_verify_01.json`),
 ...['pokey','scsp'].map(kind=>`docs/issues/${kind}_ay_single_output_chip_levels_verify_01.json`),
]);
const predecessorPath='docs/issues/spc_voice_edit_mixer_policy_revision_01.json';
const predecessorPin='ab1701112defa1016f19a2bdd82c3d3edf28ad4b2c3cc3892a01e7cf84086e1f';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[0-9a-f]{64}$/.test(value.sha256);
const fail=message=>{throw Error('Invalid AY Single Output Mixer policy revision: '+message);};
let receipt;
function verifiedReceipt(){
 if(receipt)return receipt;
 const value=JSON.parse(readFileSync(new URL('../'+AY_SINGLE_OUTPUT_POLICY_RECEIPT_PATH,import.meta.url),'utf8'));
 if(sha(JSON.stringify(value))!==AY_SINGLE_OUTPUT_POLICY_RECEIPT_OBJECT_SHA256)fail('independent receipt pin mismatch');
 if(value.schemaVersion!==1||value.scope!=='complete-ay-single-output-mixer-remeasurement'||value.path!==AY_SINGLE_OUTPUT_POLICY_SOURCE_PATH||
  JSON.stringify(Object.keys(value.reports??{}))!==JSON.stringify(AY_SINGLE_OUTPUT_POLICY_REPORT_PATHS)||
  !record(value.before)||!record(value.after)||typeof value.beforeText!=='string')fail('exact source/report inventory mismatch');
 const previous=JSON.parse(readFileSync(new URL('../'+predecessorPath,import.meta.url),'utf8'));
 if(sha(JSON.stringify(previous))!==predecessorPin||JSON.stringify(value.before)!==JSON.stringify(previous.after))fail('historical policy predecessor changed');
 const mirror=value.served;
 const oldMirror=JSON.parse(readFileSync(new URL('../docs/issues/scsp_loop_link_api_source_revision_01.json',import.meta.url),'utf8'));
 if(sha(JSON.stringify(oldMirror))!=='fb1715790f0a54484a8aa678b00222b1a072e223db1f43cf977470dd15ee59d3'||
  mirror?.path!==AY_SINGLE_OUTPUT_POLICY_SERVED_PATH||!record(mirror.before)||!record(mirror.after)||typeof mirror.beforeText!=='string'||
  JSON.stringify(mirror.before)!==JSON.stringify(oldMirror.relatedSources[AY_SINGLE_OUTPUT_POLICY_SERVED_PATH]))fail('exact served policy predecessor mismatch');
 const mirrorBefore=Buffer.from(mirror.beforeText);
 if(mirrorBefore.length!==mirror.before.bytes||sha(mirrorBefore)!==mirror.before.sha256)fail('served policy predecessor bytes changed');
 const before=Buffer.from(value.beforeText);
 if(before.length!==value.before.bytes||sha(before)!==value.before.sha256)fail('historical policy bytes changed');
 receipt=value;return receipt;
}
export function restoreMixerCalibrationAySingleOutputPolicyRevision(path,bytes,{readSource=url=>readFileSync(url)}={}){
 if(![AY_SINGLE_OUTPUT_POLICY_SOURCE_PATH,AY_SINGLE_OUTPUT_POLICY_SERVED_PATH].includes(path))return bytes;
 const evidence=verifiedReceipt(),entry=path===AY_SINGLE_OUTPUT_POLICY_SOURCE_PATH?evidence:evidence.served;
 if(bytes.length!==entry.after.bytes||sha(bytes)!==entry.after.sha256)return bytes;
 for(const path of AY_SINGLE_OUTPUT_POLICY_REPORT_PATHS){
  const actual=readSource(new URL('../'+path,import.meta.url)),expected=evidence.reports[path];
  if(!record(expected)||actual.length!==expected.bytes||sha(actual)!==expected.sha256)fail('complete measurement changed: '+path);
 }
 return Buffer.from(entry.beforeText);
}
