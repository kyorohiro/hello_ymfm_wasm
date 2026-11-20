/** Exact checkpoint-ABI revision, backed by real PCM parity and fresh muted
 * matrices. Only complete predecessor bytes are restored for historical guards;
 * unknown edits, evidence or dependencies still require remeasurement. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
export const YM2413_STATE_REVISION_RECEIPT='docs/issues/ym2413_state_source_revision_01.json';
export const YM2413_STATE_REVISION_PIN='bcdbdeb70b6a9f8ad7a3098627c9eb7c2562cdaaa247fe83603f2b7b564e9abb';
export const YM2413_STATE_REVISION_PATHS=Object.freeze(['js/ym2413.js','js/ym2413audioengine.js','generated/ym2413_wasm.js','generated/ym2413_wasm.wasm']);
const kinds=['ps1','wonderswan','pokey','scsp'];
export const YM2413_STATE_REVISION_REPORTS=Object.freeze(kinds.flatMap(kind=>[0,1].map(verify=>`docs/issues/${kind}_ym2413_state_chip_levels${verify?'_verify':''}_01.json`)));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const matches=(bytes,record)=>record && bytes.length===record.bytes && digest(bytes)===record.sha256;
const fail=message=>{throw Error('YM2413 state calibration revision changed; remeasure: '+message);};
const readDefault=path=>readFileSync(new URL(path,root));
function validateEvidence(receipt,read) {
 for(const [path,record] of Object.entries(receipt.dependencies)) if(!matches(read(path),record))fail(path);
 const proof=JSON.parse(read('docs/issues/ym2413_state_pcm_parity_01.json'));
 if(!proof.passed || proof.maximumDifference!==0 || proof.cases?.length!==1284 || proof.totalOutputStereoFrames!==16133748)fail('native PCM parity coverage');
 for(const file of YM2413_STATE_REVISION_REPORTS) {
  const report=JSON.parse(read(file)), kind=kinds.find(k=>file.startsWith(`docs/issues/${k}_`)), verify=file.includes('_verify_');
  if(!report.passed || report.verify!==verify || report.completeCoverage!==true || report.physicalOutputMuted!==true || report.listeningPerformed!==false || report.pcmContinuous!==true || report.rows?.length!==(kind==='pokey'?96:48) || report.anchors?.length!==8)fail('complete muted matrix: '+file);
  for(const target of YM2413_STATE_REVISION_PATHS) if(report.sources?.[target] && !matches(read('docs/'+target),report.sources[target]))fail('served source: '+target);
  if(verify) {
   const baseline=JSON.parse(read(`docs/issues/${kind}_ws_timed_chip_levels_01.json`));
   if(JSON.stringify(report.calibration)!==JSON.stringify(baseline.calibration))fail('retained measured policy: '+kind);
  }
 }
}
/** @param {string} path @param {Buffer} bytes */
export function restoreMixerCalibrationYm2413StateRevision(path,bytes,{read=readDefault}={}) {
 if(!YM2413_STATE_REVISION_PATHS.includes(path))return bytes;
 const receipt=JSON.parse(read(YM2413_STATE_REVISION_RECEIPT));
 if(digest(JSON.stringify(receipt))!==YM2413_STATE_REVISION_PIN || receipt.schemaVersion!==1 || receipt.scope!=='ym2413-native-checkpoint-api-default-pcm-parity')fail('receipt');
 const entry=receipt.sources?.[path];
 if(matches(bytes,entry?.before))return bytes;
 if(!matches(bytes,entry?.after))fail(path);
 validateEvidence(receipt,read);
 const previous=Buffer.from(entry.before.base64,'base64');
 if(!matches(previous,entry.before))fail('predecessor: '+path);
 return previous;
}
