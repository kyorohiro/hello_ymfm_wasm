/** Freshness for calibration evidence, with narrowly scoped reviewed revisions.
 * Measurement reports retain every original raw source hash. A separately pinned
 * receipt allows only the version values at six exact UI resource imports to
 * change. It cannot authorize a changed DSP, path, query, import body, or any
 * other byte in either UI file.
 */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const fail=message=>{throw new Error('Invalid Mixer calibration source receipt: '+message);};
const specs=Object.freeze({
  'playground/playground.js':{
    name:'playground-editor-ui-imports-v2',targets:[
      {module:'playground_mixer_defaults.js',pattern:/^import \{createPlaygroundSoundChipMixer,playgroundLegacyMixerTrims\} from '\.\/playground_mixer_defaults\.js\?v=([A-Za-z0-9._+-]+)';$/gm},
      {module:'playground_workbench.js',pattern:/^import \{installPlaygroundWorkbench\} from '\.\/playground_workbench\.js\?v=([A-Za-z0-9._+-]+)';$/gm},
      {module:'playground_chip_tabs.js',pattern:/^import \{createPlaygroundChipTabs,createPlaygroundAdditionalChipTabAvailability\} from '\.\/playground_chip_tabs\.js\?v=([A-Za-z0-9._+-]+)';$/gm},
      {module:'playground_ui.js',pattern:/^import \{ createPlaygroundUi, applyPlaygroundLayout \} from "\.\/playground_ui\.js\?v=([A-Za-z0-9._+-]+)";$/gm},
    ],
  },
  'playground/index.html':{
    name:'playground-editor-page-imports-v2',targets:[
      {module:'playground.js',pattern:/^      import\('\.\/playground\.js\?v=([A-Za-z0-9._+-]+)'\)\.catch\(error => window\.__playgroundStartup\.fail\(error\)\);$/gm},
      {module:'playground_chip_tabs.css',pattern:/^    <link rel="stylesheet" href="\.\/playground_chip_tabs\.css\?v=([A-Za-z0-9._+-]+)">$/gm},
    ],
  },
});
export const MIXER_CALIBRATION_UI_CACHE_PATHS=Object.freeze(Object.keys(specs));
export const MIXER_CALIBRATION_PS1_ADSR_UI_PATHS=Object.freeze([
  'playground/playground_chip_tabs.css','playground/playground_chip_tabs.js','playground/playground_ps1_voice_panel.js',
]);
export const MIXER_CALIBRATION_PS1_ADSR_UI_RELATED_PATHS=Object.freeze(['playground/playground_ps1_envelope.js']);
export const MIXER_CALIBRATION_PS1_ADSR_UI_RECEIPT_PATH='docs/issues/ps1_adsr_graph_ui_receipt_01.json';
export const MIXER_CALIBRATION_PS1_ADSR_UI_RECEIPT_OBJECT_SHA256='f46510bcf8593eeb1f39604c8ce6dec95c7dbdddbf58387fde9cdb084fd01da0';
export const MIXER_CALIBRATION_PS1_STARTER_PATH='js/ps1synth.js';
export const MIXER_CALIBRATION_PS1_STARTER_RECEIPT_PATH='docs/issues/ps1_init_sample_receipt_01.json';
export const MIXER_CALIBRATION_PS1_STARTER_RECEIPT_OBJECT_SHA256="520bc2d22dba8f40083bab1bdf1f968c56549c9da4d7179c5bb6e77dae27de41";
const ps1AdsrReports=['docs/issues/ps1_chip_levels_01.json','docs/issues/wonderswan_chip_levels_01.json','docs/issues/pokey_chip_levels_01.json'];
const samePaths=(records,paths)=>records&&typeof records==='object'&&!Array.isArray(records)&&Object.keys(records).length===paths.length&&paths.every(path=>Object.hasOwn(records,path));
const sourceRecord=record=>record&&Number.isSafeInteger(record.bytes)&&record.bytes>0&&digest(record.sha256);

/** Stable object identity of a receipt; consumers must pin this outside it. */
export const mixerCalibrationReceiptObjectSha256=receipt=>sha(JSON.stringify(receipt));

/** Return the SHA of the original bytes except for the precise cache-token values.
 * This rejects alternate paths, additional query keys, duplicate references and
 * unsupported import spellings rather than attempting general JS normalization.
 */
export function mixerCalibrationUiCanonicalSha256(path,bytes){
  if(!Object.hasOwn(specs,path))fail('unsupported UI cache path: '+path);const spec=specs[path];
  const source=Buffer.from(bytes),text=source.toString('utf8');
  if(!Buffer.from(text).equals(source))fail('invalid UTF-8 UI asset: '+path);
  const tokens=[];
  for(const target of spec.targets){
    if(text.split(target.module).length!==2)fail('exactly one target module reference required: '+path+' ('+target.module+')');
    const matches=[...text.matchAll(new RegExp(target.pattern.source,target.pattern.flags))];
    if(matches.length!==1)fail('exact known single-version import required: '+path+' ('+target.module+')');
    const match=matches[0];tokens.push({offset:match.index+match[0].indexOf('?v=')+3,length:match[1].length});
  }
  let canonical=text;
  for(const {offset,length}of tokens.sort((a,b)=>b.offset-a.offset))canonical=canonical.slice(0,offset)+'<cache-version>'+canonical.slice(offset+length);
  return sha(canonical);
}

/** Create a receipt only from bytes still matching both original report records.
 * This is provenance preparation, never remeasurement or replacement of report
 * hashes. The resulting object is immutable evidence once its SHA is pinned.
 */
export function createMixerCalibrationUiReceipt({reportPath,reportBytes,sources}){
  const report=JSON.parse(Buffer.from(reportBytes).toString('utf8'));
  if(report.passed!==true||report.verify!==false||!report.sources)fail('successful original measurement required');
  const records={};
  for(const path of MIXER_CALIBRATION_UI_CACHE_PATHS){
    const record=report.sources[path],bytes=sources?.[path];
    if(!record||bytes===undefined||!Number.isSafeInteger(record.bytes)||record.bytes<=0||!digest(record.sha256)||
      Buffer.byteLength(bytes)!==record.bytes||sha(bytes)!==record.sha256)fail('original UI asset no longer matches measurement: '+path);
    records[path]={bytes:record.bytes,sha256:record.sha256,normalizer:specs[path].name,canonicalSha256:mixerCalibrationUiCanonicalSha256(path,bytes)};
  }
  return {schemaVersion:1,scope:'ui-import-cache-token-only',
    report:{path:reportPath,sha256:sha(reportBytes),objectSha256:sha(JSON.stringify(report))},sources:records};
}

/** Assert freshness of one served source. Exact original bytes need no receipt.
 * For a cache-only alias, receiptObjectSha256 must be a trusted constant stored
 * outside the receipt; reportSha256 is the SHA of the untouched report file.
 * Returns 'raw' or 'ui-cache-token' to make the accepted evidence explicit.
 */
// Reviewed SCSP layout-only revision. Exact complete before/after hashes are
// pinned here; no future body, DSP, import path or cache edit is authorized.
const scspLayoutRevision={
  "playground/playground_workbench.js": {
    "before": {
      "bytes": 7407,
      "sha256": "bc09df3c61f7a87dce8e0ba4800f2ba217bed62077b05c37faba410f955d3405"
    },
    "after": {
      "bytes": 7427,
      "sha256": "3dac292fcb93554afd47c00d7dd358d80d299e6b9fc236b12f1cfa241a6d3e5c"
    }
  },
  "playground/playground.js": {
    "before": {
      "bytes": 124925,
      "sha256": "3941136b23fd25246592aff30662fba9e3632c67625db0a7f20624564e086b9d"
    },
    "after": {
      "bytes": 124916,
      "sha256": "186c123511f7cc2aa5ebb8f0eccdab1aac436598bb3056d3cb7706b4ac6f4f4f"
    }
  },
  "playground/index.html": {
    "before": {
      "bytes": 132019,
      "sha256": "7d799016075dce74a74055a2f5e2a08b51b32418fbfe0317c9bb75918f6abe91"
    },
    "after": {
      "bytes": 132015,
      "sha256": "d4e8c0de2eac0721dfe6653e29547b561b759e3df68c6f5cd1c67be44a621439"
    }
  }
};
function isScspLayoutRevision(path,bytes,record) {
  const entry=scspLayoutRevision[path];
  return entry&&record?.bytes===entry.before.bytes&&record.sha256===entry.before.sha256&&
    Buffer.byteLength(bytes)===entry.after.bytes&&sha(bytes)===entry.after.sha256;
}
export function assertMixerCalibrationSourceFreshness({path,bytes,record,report,reportSha256,receipt,receiptObjectSha256}){
  if(record&&Buffer.byteLength(bytes)===record.bytes&&sha(bytes)===record.sha256)return 'raw';
  if(isScspLayoutRevision(path,bytes,record))return 'ui-scsp-layout';
  const stale=()=>{throw new Error('served DSP/WASM source changed; remeasure: docs/'+path);};
  if(!Object.hasOwn(specs,path)||receipt===undefined)return stale();
  if(!digest(receiptObjectSha256)||mixerCalibrationReceiptObjectSha256(receipt)!==receiptObjectSha256)fail('receipt does not match its independently pinned SHA');
  if(receipt.schemaVersion!==1||receipt.scope!=='ui-import-cache-token-only'||!receipt.report||
    !digest(reportSha256)||receipt.report.sha256!==reportSha256||receipt.report.objectSha256!==sha(JSON.stringify(report))||
    typeof receipt.report.path!=='string'||!receipt.report.path||
    !receipt.sources||Array.isArray(receipt.sources)||Object.keys(receipt.sources).length!==2||
    MIXER_CALIBRATION_UI_CACHE_PATHS.some(name=>!Object.hasOwn(receipt.sources,name)))fail('receipt report identity or scope mismatch');
  for(const name of MIXER_CALIBRATION_UI_CACHE_PATHS){
    const original=report?.sources?.[name],entry=receipt.sources[name];
    if(!original||!entry||entry.bytes!==original.bytes||entry.sha256!==original.sha256||entry.normalizer!==specs[name].name||!digest(entry.canonicalSha256))fail('receipt original asset record mismatch: '+name);
  }
  if(record?.bytes!==receipt.sources[path].bytes||record?.sha256!==receipt.sources[path].sha256)fail('source record detached from original receipt: '+path);
  if(mixerCalibrationUiCanonicalSha256(path,bytes)!==receipt.sources[path].canonicalSha256)return stale();
  return 'ui-cache-token';
}

/** A reviewed feature revision is separate evidence from cache normalization.
 * Only these three exact UI revisions and their one exact added helper may use
 * it. It does not claim new PCM measurements or permit any other code changes.
 */
export function assertMixerCalibrationPs1AdsrUiFreshness({path,bytes,record,report,reportSha256,receipt,receiptObjectSha256,relatedSources}){
  if(!MIXER_CALIBRATION_PS1_ADSR_UI_PATHS.includes(path))fail('unsupported PS1 ADSR UI revision path: '+path);
  if(!digest(receiptObjectSha256)||mixerCalibrationReceiptObjectSha256(receipt)!==receiptObjectSha256)fail('PS1 ADSR UI receipt does not match its independently pinned SHA');
  if(receipt?.schemaVersion!==1||receipt.scope!=='ps1-adsr-graph-ui-revision'||receipt.feature!=='PS1 live draggable ADSR graph'||
    !samePaths(receipt.reports,ps1AdsrReports)||!samePaths(receipt.sources,MIXER_CALIBRATION_PS1_ADSR_UI_PATHS)||
    !samePaths(receipt.relatedSources,MIXER_CALIBRATION_PS1_ADSR_UI_RELATED_PATHS))fail('PS1 ADSR UI receipt scope mismatch');
  const reportObjectSha256=sha(JSON.stringify(report));
  if(!digest(reportSha256)||!Object.values(receipt.reports).some(entry=>entry.sha256===reportSha256&&entry.objectSha256===reportObjectSha256))fail('PS1 ADSR UI receipt report identity mismatch');
  for(const name of MIXER_CALIBRATION_PS1_ADSR_UI_PATHS){
    const entry=receipt.sources[name],original=report?.sources?.[name];
    if(!sourceRecord(entry?.before)||!sourceRecord(entry?.after)||entry.before.bytes!==original?.bytes||entry.before.sha256!==original?.sha256)fail('PS1 ADSR UI receipt original asset record mismatch: '+name);
  }
  const entry=receipt.sources[path];
  if(record?.bytes!==entry.before.bytes||record?.sha256!==entry.before.sha256)fail('PS1 ADSR UI source record detached from original receipt: '+path);
  if(Buffer.byteLength(bytes)!==entry.after.bytes||sha(bytes)!==entry.after.sha256)fail('PS1 ADSR UI revision changed; review a new exact revision: '+path);
  if(!samePaths(relatedSources,MIXER_CALIBRATION_PS1_ADSR_UI_RELATED_PATHS))fail('PS1 ADSR UI related source inventory mismatch');
  for(const name of MIXER_CALIBRATION_PS1_ADSR_UI_RELATED_PATHS){
    const expected=receipt.relatedSources[name],actual=relatedSources[name];
    if(!sourceRecord(expected)||Buffer.byteLength(actual)!==expected.bytes||sha(actual)!==expected.sha256)fail('PS1 ADSR UI related source changed: '+name);
  }
  return 'ps1-adsr-ui-revision';
}

/** Load only the fixed audit and related helper, never a receipt-provided path. */
export async function readMixerCalibrationPs1AdsrUiReceipt(root){
  const receipt=JSON.parse(await readFile(resolve(root,MIXER_CALIBRATION_PS1_ADSR_UI_RECEIPT_PATH),'utf8'));
  const relatedSources=Object.fromEntries(await Promise.all(MIXER_CALIBRATION_PS1_ADSR_UI_RELATED_PATHS.map(async path=>[path,await readFile(resolve(root,'docs',path))])));
  return {receipt,relatedSources,receiptObjectSha256:MIXER_CALIBRATION_PS1_ADSR_UI_RECEIPT_OBJECT_SHA256};
}

// This is deliberately a single, named, exact source revision rather than a
// generic DSP normalizer. The pinned receipt retains both complete factory
// fragments. Reconstructing the measured bytes also proves that every import,
// class method, register write and render operation outside it is unchanged.
function ps1StarterFactory(bytes){
  const source=Buffer.from(bytes),text=source.toString('utf8');
  if(!Buffer.from(text).equals(source))fail('invalid UTF-8 PS1 starter source');
  const signature='export function createPs1InitSample() {';
  if(text.split(signature).length!==2)fail('exactly one PS1 initial sample factory required');
  const position=text.indexOf(signature),start=text.lastIndexOf('/**',position),commentEnd=text.indexOf('*/',start);
  const end=text.indexOf('\n}',position)+2;
  if(start<0||commentEnd<start||commentEnd>=position||text.slice(commentEnd+2,position).trim()||end<position||
    (end<text.length&&text[end]!=='\n'))fail('complete PS1 initial sample factory and its adjacent JSDoc required');
  return {text,start,end,factory:text.slice(start,end)};
}

/** Hash every source byte except the one named initial sample factory/JSDoc. */
export function mixerCalibrationPs1StarterOutsideSha256(bytes){
  const {text,start,end}=ps1StarterFactory(bytes);
  return sha(text.slice(0,start)+'<createPs1InitSample>'+text.slice(end));
}

/** Restore only the reviewed initial instrument factory to its measured form.
 * A calibration program resets RAM and explicitly loads its own reference;
 * changing this unused starter does not change that output unit. Every other
 * source byte must reconstruct the original measured hash. The original
 * reports and reference programs are never rewritten or relabelled.
 */
export function restoreMixerCalibrationPs1StarterRevision({path,bytes,report,reportSha256,receipt,receiptObjectSha256}){
  if(path!==MIXER_CALIBRATION_PS1_STARTER_PATH)fail('unsupported PS1 starter revision path: '+path);
  if(!digest(receiptObjectSha256)||mixerCalibrationReceiptObjectSha256(receipt)!==receiptObjectSha256)fail('PS1 starter receipt does not match its independently pinned SHA');
  const entry=receipt?.source;
  if(receipt?.schemaVersion!==1||receipt.scope!=='ps1-initial-sample-revision'||receipt.feature!=='PS1 initial sine instrument level'||
    !samePaths(receipt.reports,ps1AdsrReports)||entry?.path!==path||entry.function!=='createPs1InitSample'||
    !sourceRecord(entry.before)||!sourceRecord(entry.after)||!digest(entry.outsideSha256)||
    typeof entry.beforeFactory!=='string'||typeof entry.afterFactory!=='string')fail('PS1 starter receipt scope mismatch');
  if(!digest(reportSha256)||!Object.values(receipt.reports).some(identity=>identity.sha256===reportSha256&&identity.objectSha256===sha(JSON.stringify(report))))fail('PS1 starter receipt report identity mismatch');
  const original=report?.sources?.[path];
  if(original?.bytes!==entry.before.bytes||original?.sha256!==entry.before.sha256)fail('PS1 starter receipt original asset record mismatch');
  for(const factory of [entry.beforeFactory,entry.afterFactory]){
    const parsed=ps1StarterFactory(factory);
    if(parsed.start!==0||parsed.end!==factory.length)fail('PS1 starter receipt contains bytes outside the named factory');
  }
  const signature='export function createPs1InitSample() {',beforeBody=entry.beforeFactory.slice(entry.beforeFactory.indexOf(signature));
  const edits=[
    ['adpcm[block*16]=4; // Filter 0, shift 4.','adpcm[block*16]=0; // Filter 0, shift 0.'],
    ['Math.round(7*Math.sin(2*Math.PI*frame/112))','Math.round(5*Math.sin(2*Math.PI*frame/112))'],
  ];
  let expectedBody=beforeBody;
  for(const [before,after]of edits){
    if(expectedBody.split(before).length!==2)fail('PS1 starter receipt must describe only the reviewed sample level edit');
    expectedBody=expectedBody.replace(before,after);
  }
  if(entry.afterFactory.slice(entry.afterFactory.indexOf(signature))!==expectedBody)fail('PS1 starter receipt changes logic beyond the reviewed sample level edit');
  if(Buffer.byteLength(bytes)!==entry.after.bytes||sha(bytes)!==entry.after.sha256)fail('PS1 starter revision changed; review a new exact revision: '+path);
  const current=ps1StarterFactory(bytes);
  if(current.factory!==entry.afterFactory||mixerCalibrationPs1StarterOutsideSha256(bytes)!==entry.outsideSha256)fail('PS1 starter outside-factory source changed');
  const previous=Buffer.from(current.text.slice(0,current.start)+entry.beforeFactory+current.text.slice(current.end));
  if(previous.length!==entry.before.bytes||sha(previous)!==entry.before.sha256||mixerCalibrationPs1StarterOutsideSha256(previous)!==entry.outsideSha256)fail('PS1 starter revision does not reconstruct the original source outside the named factory');
  return previous;
}

/** Load the fixed starter receipt; no paths supplied by it are read. */
export async function readMixerCalibrationPs1StarterReceipt(root){
  const receipt=JSON.parse(await readFile(resolve(root,MIXER_CALIBRATION_PS1_STARTER_RECEIPT_PATH),'utf8'));
  return {receipt,receiptObjectSha256:MIXER_CALIBRATION_PS1_STARTER_RECEIPT_OBJECT_SHA256};
}
