/** One exact passive source-viewer revision. It restores complete predecessor
 * bytes before the existing VAB/SID evidence layers; measured programs, DSP,
 * WASM, listening gains and historical reports are never normalized or edited.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

export const HUC6280_UI_REVISION_BASE_COMMIT='c1015ee4fe776bd0d818faecbbcf1dc93a573f2d';
export const HUC6280_UI_REVISION_RECEIPT_PATH='docs/issues/huc6280_cdrom2_definition_ui_revision_01.json';
export const HUC6280_UI_REVISION_RECEIPT_OBJECT_SHA256='5d21f49f32edfca2d852e45be682e0258451a86baffd406c540d9d3291b0f2e2';
export const HUC6280_UI_REVISION_SOURCE_PATHS=Object.freeze([
  'playground/playground_monaco.js','playground/playground_monaco_definitions.js',
]);
export const HUC6280_UI_REVISION_REPORT_PATHS=Object.freeze(
  ['ps1','wonderswan','pokey','scsp'].map(kind=>`docs/issues/${kind}_state_restore_chip_levels_01.json`));
const predecessorReceipt='docs/issues/ps1_vab_public_api_source_revision_01.json';
const predecessorReceiptPin='c6acbc62409a143a87b559c0e255395e294338fe19f1067eb664a947ce34c6c3';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[0-9a-f]{64}$/.test(value.sha256);
const fail=message=>{throw Error('Invalid HuC6280 passive UI calibration revision; remeasure or review a new exact revision: '+message);};
let cached;
function verifiedReceipt() {
  if(cached)return cached;
  const value=JSON.parse(readFileSync(new URL('../'+HUC6280_UI_REVISION_RECEIPT_PATH,import.meta.url),'utf8'));
  if(sha(JSON.stringify(value))!==HUC6280_UI_REVISION_RECEIPT_OBJECT_SHA256)fail('receipt does not match its independently pinned SHA');
  if(value.schemaVersion!==1||value.scope!=='huc6280-and-cdrom2-passive-source-viewer'||value.baseCommit!==HUC6280_UI_REVISION_BASE_COMMIT||
    !keys(value.sources,HUC6280_UI_REVISION_SOURCE_PATHS)||!keys(value.reports,HUC6280_UI_REVISION_REPORT_PATHS))fail('scope or exact inventory mismatch');
  const previous=JSON.parse(readFileSync(new URL('../'+predecessorReceipt,import.meta.url),'utf8'));
  if(sha(JSON.stringify(previous))!==predecessorReceiptPin)fail('predecessor receipt no longer matches its existing independent pin');
  for(const path of HUC6280_UI_REVISION_REPORT_PATHS)if(!record(value.reports[path]))fail('invalid original report record: '+path);
  for(const path of HUC6280_UI_REVISION_SOURCE_PATHS) {
    const entry=value.sources[path],prior=previous.sources['docs/'+path]?.after;
    if(!record(entry?.before)||!record(entry.after)||entry.before.bytes!==prior?.bytes||entry.before.sha256!==prior?.sha256||!Array.isArray(entry.reverseHunks)||!entry.reverseHunks.length)fail('invalid complete predecessor/source pair: '+path);
    let cursor=0;
    for(const hunk of entry.reverseHunks) {
      if(!keys(hunk,['afterOffset','afterBytes','beforeText'])||!Number.isSafeInteger(hunk.afterOffset)||hunk.afterOffset<cursor||
        !Number.isSafeInteger(hunk.afterBytes)||hunk.afterBytes<0||hunk.afterOffset+hunk.afterBytes>entry.after.bytes||typeof hunk.beforeText!=='string')fail('invalid reverse hunk: '+path);
      cursor=hunk.afterOffset+hunk.afterBytes;
    }
  }
  cached=value;return value;
}

/** Unknown paths and future edits remain unchanged. Only the whole pinned new
 * body can restore the whole pinned predecessor, independently checked below.
 * Runtime validation needs no Git checkout, parser, diff tool or audio device.
 */
export function restoreMixerCalibrationHuc6280UiRevision(path,bytes,{readSource=url=>readFileSync(url)}={}) {
  if(!HUC6280_UI_REVISION_SOURCE_PATHS.includes(path))return bytes;
  const receipt=verifiedReceipt(),entry=receipt.sources[path];
  if(Buffer.byteLength(bytes)!==entry.after.bytes||sha(bytes)!==entry.after.sha256)return bytes;
  for(const report of HUC6280_UI_REVISION_REPORT_PATHS) {
    const original=readSource(new URL('../'+report,import.meta.url)),expected=receipt.reports[report];
    if(original.length!==expected.bytes||sha(original)!==expected.sha256)fail('original measurement changed: '+report);
  }
  const source=Buffer.from(bytes),parts=[];let cursor=0;
  for(const hunk of entry.reverseHunks) {
    parts.push(source.subarray(cursor,hunk.afterOffset),Buffer.from(hunk.beforeText));
    cursor=hunk.afterOffset+hunk.afterBytes;
  }
  parts.push(source.subarray(cursor));const original=Buffer.concat(parts);
  if(original.length!==entry.before.bytes||sha(original)!==entry.before.sha256)fail('complete predecessor reconstruction failed: '+path);
  return original;
}
