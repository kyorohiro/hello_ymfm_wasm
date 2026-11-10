/** Exact additive RF5C164 note API and its reviewed import-cache rollout.
 * Restore complete pre-feature source bodies before older calibration layers.
 * No source normalization, measured gain change, or future edit is authorized.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

export const RF5C164_NOTE_REVISION_BASE_COMMIT='b82262a480ccee0dc100e1b59ef788d51493576f';
export const RF5C164_NOTE_REVISION_RECEIPT_PATH='docs/issues/rf5c164_note_api_source_revision_01.json';
export const RF5C164_NOTE_REVISION_RECEIPT_OBJECT_SHA256='52ae35e27dde8d08e438c75761c5ea1c3f96a04f25f6397cd117a17867a96e03';
export const RF5C164_NOTE_REVISION_SOURCE_PATHS=Object.freeze([
  'js/gameboy_runtime_synth.js','js/megasynth.js','js/native_runtime_synth.js',
  'js/playground_ay8910_audio.js','js/playground_chip_inspector_state.js','js/playground_dx7_audio.js',
  'js/playground_gameboy_audio.js','js/playground_huc6280_audio.js','js/playground_logic_worker.js',
  'js/playground_nes_audio.js','js/playground_okim6258_audio.js','js/playground_opl_audio.js',
  'js/playground_opn.js','js/playground_opn_audio.js','js/playground_pokey_audio.js','js/playground_pokey_worklet.js',
  'js/playground_ps1_audio.js','js/playground_ps1_worklet.js','js/playground_pwm_audio.js',
  'js/playground_rf5c164.js','js/playground_rf5c164_audio.js','js/playground_runtime.js',
  'js/playground_scsp_audio.js','js/playground_scsp_worklet.js','js/playground_segapsg_audio.js',
  'js/playground_snes_audio.js','js/playground_wonderswan_audio.js','js/playground_wonderswan_worklet.js',
  'js/playground_worker_chip.js','js/playground_ym2151_audio.js','js/playground_ym2413_audio.js',
  'js/playground_ym2608.js','js/playground_ym2608_audio.js','js/rf5c164synth.js','js/tetorica_synth.js',
  'js/ym2203synth.js','js/ym2608synth.js','js/ym2610bsynth.js','js/ym2612-worklet.js',
  'playground/index.html','playground/playground.js','playground/playground_examples.js',
  'playground/playground_mode.js','playground/playground_monaco_completion.js',
]);
export const RF5C164_NOTE_REVISION_REPORT_PATHS=Object.freeze(['ps1','wonderswan','pokey','scsp']
  .map(name=>`docs/issues/${name}_state_restore_chip_levels_01.json`));
const relatedPaths=['js/rf5c164_notes.js'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[0-9a-f]{64}$/.test(value.sha256);
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const fail=message=>{throw Error('Invalid RF5C164 note calibration revision: '+message);};
let receipt;
function verifiedReceipt() {
  if(receipt)return receipt;
  const candidate=JSON.parse(readFileSync(new URL('../'+RF5C164_NOTE_REVISION_RECEIPT_PATH,import.meta.url),'utf8'));
  if(sha(JSON.stringify(candidate))!==RF5C164_NOTE_REVISION_RECEIPT_OBJECT_SHA256)fail('receipt does not match its independently pinned SHA');
  if(candidate.schemaVersion!==1||candidate.scope!=='rf5c164-software-notes-and-cache-routing'||
    candidate.feature!=='RF5C164 declared-step note API without DSP changes'||candidate.baseCommit!==RF5C164_NOTE_REVISION_BASE_COMMIT||
    !keys(candidate.sources,RF5C164_NOTE_REVISION_SOURCE_PATHS)||!keys(candidate.reports,RF5C164_NOTE_REVISION_REPORT_PATHS)||
    !keys(candidate.relatedSources,relatedPaths))fail('scope or exact source inventory mismatch');
  for(const path of RF5C164_NOTE_REVISION_REPORT_PATHS)if(!record(candidate.reports[path]))fail('invalid historical report identity');
  for(const path of relatedPaths)if(!record(candidate.relatedSources[path]))fail('invalid related source identity');
  for(const path of RF5C164_NOTE_REVISION_SOURCE_PATHS) {
    const entry=candidate.sources[path];
    if(!record(entry?.before)||!record(entry?.after)||!Array.isArray(entry.reverseHunks)||!entry.reverseHunks.length)fail('invalid source revision: '+path);
    let cursor=0;
    for(const hunk of entry.reverseHunks) {
      if(!keys(hunk,['afterOffset','afterBytes','beforeText'])||!Number.isSafeInteger(hunk.afterOffset)||hunk.afterOffset<cursor||
        !Number.isSafeInteger(hunk.afterBytes)||hunk.afterBytes<0||hunk.afterOffset+hunk.afterBytes>entry.after.bytes||typeof hunk.beforeText!=='string')fail('invalid reverse hunk: '+path);
      cursor=hunk.afterOffset+hunk.afterBytes;
    }
  }
  receipt=candidate;return receipt;
}

/** Unknown paths or any non-exact after bytes stay unmodified and fail the
 * caller's ordinary freshness check. The added helper is checked even though
 * it did not exist in the historical measurement's source inventory.
 */
export function restoreMixerCalibrationRf5c164NoteRevision(path,bytes) {
  if(!RF5C164_NOTE_REVISION_SOURCE_PATHS.includes(path))return bytes;
  const evidence=verifiedReceipt(),entry=evidence.sources[path];
  if(Buffer.byteLength(bytes)!==entry.after.bytes||sha(bytes)!==entry.after.sha256)return bytes;
  for(const path of relatedPaths) {
    const current=readFileSync(new URL('../docs/'+path,import.meta.url)),expected=evidence.relatedSources[path];
    if(current.length!==expected.bytes||sha(current)!==expected.sha256)fail('added note helper changed; remeasure or review a new exact revision: docs/'+path);
  }
  const current=Buffer.from(bytes),parts=[];let cursor=0;
  for(const hunk of entry.reverseHunks){parts.push(current.subarray(cursor,hunk.afterOffset),Buffer.from(hunk.beforeText));cursor=hunk.afterOffset+hunk.afterBytes;}
  parts.push(current.subarray(cursor));const original=Buffer.concat(parts);
  if(original.length!==entry.before.bytes||sha(original)!==entry.before.sha256)fail('complete before reconstruction failed: '+path);
  return original;
}
