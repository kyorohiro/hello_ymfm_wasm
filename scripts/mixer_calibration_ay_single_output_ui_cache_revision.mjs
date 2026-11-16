/** Two exact passive UI cache restorations after the AY remeasurements.
 * The recorded audio evidence is immutable. Only reviewed import cache keys
 * can reconstruct the complete UI body actually fingerprinted by that evidence.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

export const AY_SINGLE_OUTPUT_UI_CACHE_RECEIPT_PATH='docs/issues/ay_single_output_passive_cache_restore_revision_01.json';
export const AY_SINGLE_OUTPUT_UI_CACHE_RECEIPT_OBJECT_SHA256='113fdf5c540bcec6a073386d1c349b2fcfaff97de70d87a0619c7125bde9860a';
export const AY_SINGLE_OUTPUT_UI_CACHE_SOURCE_PATHS=Object.freeze([
  'playground/playground_monaco.js',
  'playground/wonderswan_vgm_import.js',
]);
export const AY_SINGLE_OUTPUT_UI_CACHE_REPORT_PATHS=Object.freeze([
  ...['ps1','wonderswan','pokey','scsp'].map(kind=>`docs/issues/${kind}_ay_single_output_chip_levels_01.json`),
  ...['pokey','scsp'].map(kind=>`docs/issues/${kind}_ay_single_output_chip_levels_verify_01.json`),
]);
const imports=Object.freeze({
  'playground/playground_monaco.js':[
    "import {createDefinitionViewer} from './playground_monaco_definitions.js?v=ps1-vab-api-1';\n",
    "import {createDefinitionViewer} from './playground_monaco_definitions.js?v=sdsp-code-review-1';\n",
  ],
  'playground/wonderswan_vgm_import.js':[
    "import {WONDERSWAN_TIMELINE_MAX_HOST_BYTES} from '../js/wonderswan_timeline.js?v=pokey-prepare-1';\n",
    "import {WONDERSWAN_TIMELINE_MAX_HOST_BYTES} from '../js/wonderswan_timeline.js';\n",
  ],
});
const importTargets=Object.freeze([
  'playground/playground_monaco_definitions.js',
  'js/wonderswan_timeline.js',
]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sameKeys=(value,paths)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===paths.length&&paths.every(path=>Object.hasOwn(value,path));
const validRecord=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[0-9a-f]{64}$/.test(value.sha256);
const matches=(bytes,record)=>validRecord(record)&&Buffer.byteLength(bytes)===record.bytes&&sha(bytes)===record.sha256;
const sameRecord=(a,b)=>validRecord(a)&&validRecord(b)&&a.bytes===b.bytes&&a.sha256===b.sha256;
const fail=message=>{throw Error('Invalid AY Single Output passive cache revision: '+message);};
const read=url=>readFileSync(url);

function verifiedReceipt(readSource){
  const receipt=JSON.parse(readSource(new URL('../'+AY_SINGLE_OUTPUT_UI_CACHE_RECEIPT_PATH,import.meta.url)));
  if(sha(JSON.stringify(receipt))!==AY_SINGLE_OUTPUT_UI_CACHE_RECEIPT_OBJECT_SHA256)fail('independent receipt pin changed');
  if(receipt.schemaVersion!==1||receipt.scope!=='ay-single-output-two-passive-cache-restorations'||
    !/^[0-9a-f]{40}$/.test(receipt.baseCommit)||
    !sameKeys(receipt.sources,AY_SINGLE_OUTPUT_UI_CACHE_SOURCE_PATHS)||
    !sameKeys(receipt.reports,AY_SINGLE_OUTPUT_UI_CACHE_REPORT_PATHS))fail('exact source/report inventory changed');
  for(const path of AY_SINGLE_OUTPUT_UI_CACHE_SOURCE_PATHS){
    const entry=receipt.sources[path],[measuredImport,servedImport]=imports[path];
    if(typeof entry.measuredText!=='string'||typeof entry.servedText!=='string'||
      !matches(Buffer.from(entry.measuredText),entry.measured)||!matches(Buffer.from(entry.servedText),entry.served)||
      entry.measuredText.split(measuredImport).length!==2||
      entry.measuredText.replace(measuredImport,servedImport)!==entry.servedText)
      fail('complete source pair is not the exact passive import restoration: '+path);
  }
  for(const path of AY_SINGLE_OUTPUT_UI_CACHE_REPORT_PATHS)if(!validRecord(receipt.reports[path]))fail('invalid report record: '+path);
  return receipt;
}

/** Unknown paths, prior evidence and future body/cache edits remain unchanged.
 * No executable token, chip input, gain or DSP/WASM file is normalized.
 */
export function restoreMixerCalibrationAySingleOutputUiCacheRevision(path,bytes,{report,record,readSource=read}={}){
  if(!AY_SINGLE_OUTPUT_UI_CACHE_SOURCE_PATHS.includes(path)||!report)return bytes;
  const receipt=verifiedReceipt(readSource),entry=receipt.sources[path];
  if(!matches(bytes,entry.served)||!sameRecord(record,entry.measured)||!sameRecord(report.sources?.[path],entry.measured))return bytes;
  const reportObjectSha=sha(JSON.stringify(report));let recognized=false;
  for(const evidencePath of AY_SINGLE_OUTPUT_UI_CACHE_REPORT_PATHS){
    const evidenceBytes=readSource(new URL('../'+evidencePath,import.meta.url));
    if(!matches(evidenceBytes,receipt.reports[evidencePath]))fail('immutable measurement changed: '+evidencePath);
    const evidence=JSON.parse(evidenceBytes);
    for(const source of AY_SINGLE_OUTPUT_UI_CACHE_SOURCE_PATHS)
      if(!sameRecord(evidence.sources?.[source],receipt.sources[source].measured))fail('measurement source pair detached: '+evidencePath);
    for(const target of importTargets)
      if(!matches(readSource(new URL('../docs/'+target,import.meta.url)),evidence.sources?.[target]))fail('import target changed: '+target);
    if(sha(JSON.stringify(evidence))===reportObjectSha)recognized=true;
  }
  if(!recognized)return bytes;
  return Buffer.from(entry.measuredText);
}
