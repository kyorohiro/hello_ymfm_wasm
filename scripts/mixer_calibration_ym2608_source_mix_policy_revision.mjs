/** Exact generated-policy transition backed by complete fresh measurements.
 * Historical guards receive their pinned policy/source predecessors. No chip,
 * DSP, transport or WASM source is normalized by this policy-only review.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';

export const YM2608_SOURCE_MIX_POLICY_RECEIPT='docs/issues/ym2608_source_mix_mixer_policy_revision_01.json';
export const YM2608_SOURCE_MIX_POLICY_PIN='e30cb646a5d6bcae918b4aeb81f87d3b37ff86fcb8c0180f39c72e5f2adc02b5';
export const YM2608_SOURCE_MIX_POLICY_SOURCES=Object.freeze([
 'tetorica_src/runtime/soundchip_mixer_presets.js','docs/js/soundchip_mixer_presets.js',
 'docs/playground/playground_mixer_defaults.js',
 'scripts/mixer_calibration_scsp_output_level_new_cassette_revision.mjs',
 'scripts/mixer_calibration_scsp_output_level_new_cassette_revision.test.mjs',
]);
export const YM2608_SOURCE_MIX_POLICY_REPORTS=Object.freeze(['ps1','wonderswan','pokey','scsp'].flatMap(kind=>
 ['01','verify_01'].map(suffix=>`docs/issues/${kind}_ym2608_source_mix_chip_levels_${suffix}.json`)));
const root=fileURLToPath(new URL('../',import.meta.url)),read=url=>readFileSync(url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const matches=(bytes,record)=>record&&bytes.length===record.bytes&&sha(bytes)===record.sha256;
const exactKeys=(value,names)=>value&&JSON.stringify(Object.keys(value))===JSON.stringify(names);
const fail=message=>{throw Error('Invalid YM2608 source-mix measured policy revision: '+message);};
function nameOf(path){return typeof path==='string'&&(path.startsWith('js/')||path.startsWith('playground/'))?'docs/'+path:path;}

function createRestorer(readSource,snapshot=false){
 let receipt,verified=false;
 return(path,bytes)=>{
  const name=nameOf(path);if(!YM2608_SOURCE_MIX_POLICY_SOURCES.includes(name))return bytes;
  receipt=snapshot&&receipt?receipt:JSON.parse(readSource(new URL('../'+YM2608_SOURCE_MIX_POLICY_RECEIPT,import.meta.url)));
  if(sha(JSON.stringify(receipt))!==YM2608_SOURCE_MIX_POLICY_PIN)fail('independently pinned receipt changed');
  if(receipt.schemaVersion!==1||receipt.scope!=='complete-ym2608-source-mix-calibration-policy-transition'||
   !exactKeys(receipt.sources,YM2608_SOURCE_MIX_POLICY_SOURCES)||!exactKeys(receipt.reports,YM2608_SOURCE_MIX_POLICY_REPORTS))fail('exact source/report inventory changed');
  const entry=receipt.sources[name];if(!matches(bytes,entry.after))return bytes;
  if(!verified){
   for(const [path,entry]of Object.entries(receipt.sources)){
    if(!matches(readSource(new URL('../'+path,import.meta.url)),entry.after))fail('pinned source/report dependency changed: '+path);
    if(!matches(Buffer.from(entry.beforeBase64,'base64'),entry.before))fail('predecessor bytes changed: '+path);
   }
   for(const kind of ['ps1','wonderswan','pokey','scsp']){
    const pair=[];
    for(const suffix of ['01','verify_01']){
     const path=`docs/issues/${kind}_ym2608_source_mix_chip_levels_${suffix}.json`;
     const bytes=readSource(new URL('../'+path,import.meta.url));if(!matches(bytes,receipt.reports[path]))fail('complete measurement changed: '+path);
     const report=JSON.parse(bytes);
     if(report.passed!==true||report.verify!==(suffix==='verify_01')||report.completeCoverage!==true||
      report.physicalOutputMuted!==true||report.listeningPerformed!==false||report.pcmContinuous!==true||
      report.rows?.length!==(kind==='pokey'?96:48)||report.anchors?.length!==8||
      (kind==='pokey'&&report.dualChecks?.length!==8))fail('complete fresh measurement required: '+path);
     pair.push(report);
    }
    if(JSON.stringify(pair[0].calibration)!==JSON.stringify(pair[1].calibration))fail('verification policy detached: '+kind);
   }
   verified=snapshot;
  }
  return Buffer.from(entry.beforeBase64,'base64');
 };
}
export function restoreMixerCalibrationYm2608SourceMixPolicyRevision(path,bytes,{readSource=read}={}){
 return createRestorer(readSource)(path,bytes);
}
export function createYm2608SourceMixPolicyReadContext(readSource=read){
 const originals=new Map(),predecessors=new Map();
 const original=url=>{const key=url instanceof URL?url.href:url;if(!originals.has(key))originals.set(key,Buffer.from(readSource(url)));return originals.get(key);};
 const restore=createRestorer(original,true);
 const reader=url=>{
  const key=url instanceof URL?url.href:url;
  if(!predecessors.has(key)){
   const bytes=original(url),path=url instanceof URL&&url.protocol==='file:'?relative(root,fileURLToPath(url)).replaceAll('\\','/'):null;
   predecessors.set(key,path===null?bytes:restore(path,bytes));
  }
  return predecessors.get(key);
 };
 return {restore,readSource:reader};
}
export function createYm2608SourceMixPolicyReader(readSource=read){
 return createYm2608SourceMixPolicyReadContext(readSource).readSource;
}
