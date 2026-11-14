/** Separately reviewed Code ownership callback, not a DSP or passive UI edit.
 * The default callback preserves prior physical-channel note ownership. Only
 * these complete two identical runtime bodies can restore the VAB receipt's
 * exact dependencies; future scheduler/gain/import edits remain unaccepted.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
export const CODE_NOTE_REVISION_RECEIPT_PATH='docs/issues/code_note_target_ownership_revision_01.json';
export const CODE_NOTE_REVISION_RECEIPT_OBJECT_SHA256='e304559ef7a0395a4354a1b3c9f18208952a98da8cebb5367c5ca905296be49d';
export const CODE_NOTE_REVISION_PATHS=Object.freeze(['tetorica_src/runtime/playground_code_runtime.js','docs/js/playground_code_runtime.js']);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let receipt;
function evidence() {
  if(receipt)return receipt;
  const value=JSON.parse(readFileSync(new URL('../'+CODE_NOTE_REVISION_RECEIPT_PATH,import.meta.url),'utf8'));
  if(sha(JSON.stringify(value))!==CODE_NOTE_REVISION_RECEIPT_OBJECT_SHA256||value.schemaVersion!==1||value.scope!=='code-note-target-ownership-additive-callback'||Object.keys(value.sources??{}).length!==2||CODE_NOTE_REVISION_PATHS.some(path=>!Object.hasOwn(value.sources,path)))throw Error('Invalid exact Code note ownership receipt; review or remeasure');
  receipt=value;return value;
}
export function restoreMixerCalibrationCodeNoteRevision(path,bytes) {
  if(!CODE_NOTE_REVISION_PATHS.includes(path))return bytes;
  const entry=evidence().sources[path];
  if(Buffer.byteLength(bytes)!==entry.after.bytes||sha(bytes)!==entry.after.sha256)return bytes;
  const source=Buffer.from(bytes),parts=[];let cursor=0;
  for(const hunk of entry.reverseHunks){parts.push(source.subarray(cursor,hunk.afterOffset),Buffer.from(hunk.beforeText));cursor=hunk.afterOffset+hunk.afterBytes;}
  parts.push(source.subarray(cursor));const original=Buffer.concat(parts);
  if(original.length!==entry.before.bytes||sha(original)!==entry.before.sha256)throw Error('Invalid exact Code note ownership reconstruction; review or remeasure');
  return original;
}
