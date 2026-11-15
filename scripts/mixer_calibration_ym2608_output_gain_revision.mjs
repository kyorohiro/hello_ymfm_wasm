/** Exact opt-in YM2608 host-gain revision for measurements of four other chips.
 * The reviewed files were loaded as dormant dependencies in those eight reports.
 * Other reports, later edits and YM2608 measurement profiles require fresh evidence.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ym2608OutputGainDefaultChecker} from './check_ym2608_output_gain_defaults.mjs';

export const YM2608_OUTPUT_GAIN_REVISION_RECEIPT_PATH='docs/issues/ym2608_output_gains_source_revision_01.json';
export const YM2608_OUTPUT_GAIN_REVISION_RECEIPT_OBJECT_SHA256='63123ee39ab7c6b4dae1ec174519464ea83eb450148922b516ba4ce18d5cb605';
export const YM2608_OUTPUT_GAIN_REVISION_SOURCE_PATHS=Object.freeze(['js/ym2608.js','js/ym2608synth.js']);
export const YM2608_OUTPUT_GAIN_DEFAULT_PCM_PATH='docs/issues/ym2608_output_gains_default_pcm_01.json';
export const YM2608_OUTPUT_GAIN_REVISION_REPORT_PATHS=Object.freeze(['ps1','wonderswan','pokey','scsp'].flatMap(kind => [
  `docs/issues/${kind}_spc_voice_edit_chip_levels_01.json`,
  `docs/issues/${kind}_spc_voice_edit_chip_levels_verify_01.json`,
]));
export const YM2608_OUTPUT_GAIN_REVISION_RELATED_PATHS=Object.freeze([
  'tetorica_src/runtime/ym2608.js','tetorica_src/runtime/ym2608synth.js',
  'tetorica_src/runtime/ym2608audioengine.js','tetorica_src/runtime/ym2608-worklet.js',
  'docs/js/ym2608audioengine.js','docs/js/ym2608-worklet.js',
  'docs/generated/ym2608_wasm.js','docs/generated/ym2608_wasm.wasm',
  'third_party/tetorica-soundchip-native/wasm/ym2608_wasm.cpp',
  'third_party/tetorica-soundchip-native/scripts/build_ym2608_wasm.sh',
  'scripts/check_ym2608_wasm_sdk.mjs','scripts/check_ym2608_output_gain_defaults.mjs',
]);
const sha=bytes => createHash('sha256').update(bytes).digest('hex');
const record=value => value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[0-9a-f]{64}$/.test(value.sha256);
const sameKeys=(value,keys) => value&&Object.keys(value).length===keys.length&&keys.every(key => Object.hasOwn(value,key));
const matches=(bytes,expected) => record(expected)&&bytes.length===expected.bytes&&sha(bytes)===expected.sha256;
const fail=message => {throw Error('Invalid reviewed YM2608 output-gain revision: '+message);};
let receipt;

function evidence() {
  if(receipt)return receipt;
  const value=JSON.parse(readFileSync(new URL('../'+YM2608_OUTPUT_GAIN_REVISION_RECEIPT_PATH,import.meta.url),'utf8'));
  if(sha(JSON.stringify(value))!==YM2608_OUTPUT_GAIN_REVISION_RECEIPT_OBJECT_SHA256)fail('independent receipt pin mismatch');
  if(value.schemaVersion!==1||value.scope!=='dormant-ym2608-output-gain-api'
    ||!sameKeys(value.sources,YM2608_OUTPUT_GAIN_REVISION_SOURCE_PATHS)
    ||!sameKeys(value.relatedSources,YM2608_OUTPUT_GAIN_REVISION_RELATED_PATHS)
    ||!sameKeys(value.reports,YM2608_OUTPUT_GAIN_REVISION_REPORT_PATHS)
    ||value.nativeProof?.path!==YM2608_OUTPUT_GAIN_DEFAULT_PCM_PATH||!record(value.nativeProof))fail('exact inventory mismatch');
  for(const path of YM2608_OUTPUT_GAIN_REVISION_SOURCE_PATHS) {
    const entry=value.sources[path];
    if(!record(entry.before)||!record(entry.after)||typeof entry.beforeText!=='string'||!matches(Buffer.from(entry.beforeText),entry.before))fail('invalid complete source pair: '+path);
  }
  receipt=value;
  return receipt;
}

/** Only the eight authenticated non-YM2608 profiles can use this reconstruction.
 * @param {string} path Public source path relative to docs.
 * @param {Uint8Array} bytes Current complete source.
 * @param {{report?:object,record?:object,readSource?:(url:URL)=>Buffer}} [options] */
export function restoreMixerCalibrationYm2608OutputGainRevision(path,bytes,{report,record:measured,readSource=url => readFileSync(url)}={}) {
  if(!YM2608_OUTPUT_GAIN_REVISION_SOURCE_PATHS.includes(path))return bytes;
  const review=evidence(),entry=review.sources[path];
  if(!matches(bytes,entry.after)||!report||!record(measured)
    ||JSON.stringify(measured)!==JSON.stringify(entry.before))return bytes;
  const objectHash=sha(JSON.stringify(report));
  if(!Object.values(review.reports).some(item => item.objectSha256===objectHash))return bytes;
  for(const [name,expected] of Object.entries(review.reports)) {
    const current=readSource(new URL('../'+name,import.meta.url));
    if(!matches(current,expected))fail('original measurement changed: '+name);
    const measuredReport=JSON.parse(current);
    if(sha(JSON.stringify(measuredReport))!==expected.objectSha256||JSON.stringify(measuredReport.sources[path])!==JSON.stringify(entry.before)
      ||measuredReport.rows.some(row => row.kind==='ym2608')||measuredReport.anchors.some(row => row.kind==='ym2608'))fail('report scope changed: '+name);
  }
  for(const [name,expected] of Object.entries(review.relatedSources)) {
    if(!matches(readSource(new URL('../'+name,import.meta.url)),expected))fail('reviewed dependency changed: '+name);
  }
  const proofBytes=readSource(new URL('../'+review.nativeProof.path,import.meta.url));
  if(!matches(proofBytes,review.nativeProof))fail('native default-output evidence changed');
  const proof=JSON.parse(proofBytes);
  if(proof.passed!==true||proof.deviceOpened!==false||proof.maximumDifference!==0||proof.cases?.length!==586
    ||proof.totalOutputStereoFrames!==7264744||proof.cases.some(item => item.maximumDifference!==0))fail('incomplete native default-output comparison');
  for(const [file,key] of [['docs/generated/ym2608_wasm.js','javascript'],['docs/generated/ym2608_wasm.wasm','wasm']]) {
    if(!matches(readSource(new URL('../'+file,import.meta.url)),proof.inputs.sdk[key]))fail('native evidence targets another build');
  }
  const checker=ym2608OutputGainDefaultChecker(readSource(new URL('./check_ym2608_wasm_sdk.mjs',import.meta.url)).toString());
  if(!matches(Buffer.from(checker),proof.inputs.checker))fail('native differential checker identity changed');
  for(const wrapper of proof.inputs.wrappers) {
    const name=Object.keys(review.relatedSources).find(name => wrapper.path.endsWith('/'+name))
      ??YM2608_OUTPUT_GAIN_REVISION_SOURCE_PATHS.map(name => 'docs/'+name).find(name => wrapper.path.endsWith('/'+name));
    if(!name||!matches(readSource(new URL('../'+name,import.meta.url)),wrapper))fail('native comparison wrapper changed');
  }
  return Buffer.from(entry.beforeText);
}
