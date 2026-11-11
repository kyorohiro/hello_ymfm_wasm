/** Seven exact reviewed PS1 import/validation bodies. Reconstruct complete
 * predecessor bytes; never normalize a general import, validator, DSP or UI.
 * The original Mixer reports and their measured source hashes stay untouched.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

export const PS1_IMPORT_REVISION_BASE_COMMIT='8a6420f492ffb5c9455ae686ebbde0f220d654d4';
export const PS1_IMPORT_REVISION_RECEIPT_PATH='docs/issues/ps1_import_source_revision_01.json';
export const PS1_IMPORT_REVISION_RECEIPT_OBJECT_SHA256='475078754c4841b8102e65006f891730a7387a76186f5148220ae3b8365381d4';
export const PS1_IMPORT_REVISION_CURRENT_SOURCE_PATHS=Object.freeze([
  'js/playground_ps1.js','js/playground_ps1_inspector.js','js/playground_ps1_worklet.js','js/ps1synth.js',
  'playground/playground_ps1_psf.js','playground/playground_ps1_vab.js','playground/playground_ps1_vab_panel.js',
]);
export const PS1_IMPORT_REVISION_SOURCE_PATHS=Object.freeze([
  ...PS1_IMPORT_REVISION_CURRENT_SOURCE_PATHS,'playground/playground_monaco_definitions.js','playground/playground_monaco.js',
]);
export const PS1_IMPORT_REVISION_REPORT_PATHS=Object.freeze(['ps1','wonderswan','pokey','scsp']
  .map(kind=>`docs/issues/${kind}_state_restore_chip_levels_01.json`));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&digest(value.sha256);
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const fail=message=>{throw Error('Invalid PS1 import calibration revision; remeasure or review a new exact revision: '+message);};
let receipt;
function verifiedReceipt() {
  if(receipt)return receipt;
  const value=JSON.parse(readFileSync(new URL('../'+PS1_IMPORT_REVISION_RECEIPT_PATH,import.meta.url),'utf8'));
  if(sha(JSON.stringify(value))!==PS1_IMPORT_REVISION_RECEIPT_OBJECT_SHA256)fail('receipt does not match its independently pinned SHA');
  if(value.schemaVersion!==1||value.scope!=='ps1-import-compatibility-and-passive-routing'||
    value.feature!=='PS1 import validation and passive source navigation without reference PCM changes'||
    value.baseCommit!==PS1_IMPORT_REVISION_BASE_COMMIT||!keys(value.sources,PS1_IMPORT_REVISION_CURRENT_SOURCE_PATHS)||
    !keys(value.reports,PS1_IMPORT_REVISION_REPORT_PATHS))fail('scope or exact inventory mismatch');
  for(const path of PS1_IMPORT_REVISION_REPORT_PATHS) {
    const expected=value.reports[path],current=readFileSync(new URL('../'+path,import.meta.url));
    if(!record(expected)||current.length!==expected.bytes||sha(current)!==expected.sha256)fail('historical report changed: '+path);
  }
  function validateEntries(entries,paths) {
    if(!keys(entries,paths))fail('exact revision source inventory mismatch');
    for(const path of paths) {
      const entry=entries[path];
      if(!record(entry?.before)||!record(entry.after)||!Array.isArray(entry.reverseHunks)||!entry.reverseHunks.length)fail('invalid source revision: '+path);
      let cursor=0;
      for(const hunk of entry.reverseHunks) {
        if(!keys(hunk,['afterOffset','afterBytes','beforeText'])||!Number.isSafeInteger(hunk.afterOffset)||hunk.afterOffset<cursor||
          !Number.isSafeInteger(hunk.afterBytes)||hunk.afterBytes<0||hunk.afterOffset+hunk.afterBytes>entry.after.bytes||typeof hunk.beforeText!=='string')fail('invalid reverse hunk: '+path);
        cursor=hunk.afterOffset+hunk.afterBytes;
      }
    }
  }
  validateEntries(value.sources,PS1_IMPORT_REVISION_CURRENT_SOURCE_PATHS);
  if(!keys(value.priorPassiveRevisions,['psfStartupMetadata','spuCodeDefinitionViewer']))fail('exact prior passive inventory mismatch');
  const metadata=value.priorPassiveRevisions.psfStartupMetadata,viewer=value.priorPassiveRevisions.spuCodeDefinitionViewer;
  if(metadata?.beforeCommit!=='17df0f170364fc28505d21447c74979dd518242d'||metadata.afterCommit!=='0fced33ef6edc7b51fb8021972acc7c714220a22'||
    viewer?.beforeCommit!=='86904ede2ef714522d9bb4b1d7f121357c5c4bcc'||viewer.afterCommit!=='4464e1bb1c67095b0b554821bd651fff2ec7c8a5')fail('prior passive revision identity mismatch');
  validateEntries(metadata.sources,['playground/playground_ps1_psf.js']);
  validateEntries(viewer.sources,['playground/playground_monaco_definitions.js','playground/playground_monaco.js']);
  const proof=value.pcmProof;
  if(proof?.passed!==true||proof.audioContextCreated!==false||proof.physicalAudio!==false||proof.listeningPerformed!==false||
    proof.nativeSampleRate!==44100||JSON.stringify(proof.beforeSource)!==JSON.stringify(value.sources['js/ps1synth.js'].before)||
    JSON.stringify(proof.afterSource)!==JSON.stringify(value.sources['js/ps1synth.js'].after)||proof.routes?.length!==12)fail('numeric proof identity mismatch');
  for(const item of [proof.wasm,proof.referenceProgram]) {
    if(!['docs/generated/ps1_spu_wasm.wasm','scripts/soundchip_calibration_ps1.mjs'].includes(item?.path)||!digest(item.sha256)||
      sha(readFileSync(new URL('../'+item.path,import.meta.url)))!==item.sha256)fail('numeric proof dependency changed');
  }
  receipt=value;return receipt;
}

export function restoreMixerCalibrationPs1ImportRevision(path,bytes) {
  if(!PS1_IMPORT_REVISION_SOURCE_PATHS.includes(path))return bytes;
  const evidence=verifiedReceipt();
  for(const entries of [evidence.sources,evidence.priorPassiveRevisions.psfStartupMetadata.sources,evidence.priorPassiveRevisions.spuCodeDefinitionViewer.sources]) {
    if(Object.hasOwn(entries,path))bytes=restoreSource(path,bytes,entries[path]);
  }
  return bytes;
}
function restoreSource(path,bytes,entry) {
  if(Buffer.byteLength(bytes)!==entry.after.bytes||sha(bytes)!==entry.after.sha256)return bytes;
  const source=Buffer.from(bytes),parts=[];let cursor=0;
  for(const hunk of entry.reverseHunks) {
    parts.push(source.subarray(cursor,hunk.afterOffset),Buffer.from(hunk.beforeText));cursor=hunk.afterOffset+hunk.afterBytes;
  }
  parts.push(source.subarray(cursor));const before=Buffer.concat(parts);
  if(before.length!==entry.before.bytes||sha(before)!==entry.before.sha256)fail('complete predecessor reconstruction failed: '+path);
  return before;
}
