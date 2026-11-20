// Test-only archived inputs for immutable historical proof tests. These bytes
// never participate in production freshness approval or generated policies.
// Freeze unchanged-at-cut dependencies too: later queue, Synth CSS,
// WonderSwan, PS1 timed API, YM2413 state ABI, shared Sega timed APIs and example
// edits must not leak into historical proofs. Later additions use individually
// pinned Git cuts without replacing any earlier archived body.
// The fixture integrity test compares every complete body to its fixed Git revision.
import {readFileSync as readLive} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {relative,resolve} from 'node:path';
import {createHistoricalFm2612ApplicationReader} from './historical_fm2612_application_source_fixture.mjs';
import {createHistoricalYm2608SourceMixReader} from './historical_ym2608_source_mix_fixture.mjs';
export const HUC_HISTORY_PIN='d5a45dfd85decc9f9c4d2605709727803b7bd86f52ba056f3bc123ad1b7a6fa0';
export const HUC_HISTORY_PATH='test/fixtures/pre-huc-timed-calibration-inputs.json';
const root=fileURLToPath(new URL('../../',import.meta.url));
const snapshot=JSON.parse(readLive(new URL('../../'+HUC_HISTORY_PATH,import.meta.url))),sha=b=>createHash('sha256').update(b).digest('hex');
if(sha(JSON.stringify(snapshot))!==HUC_HISTORY_PIN||snapshot.scope!=='test-only-pre-huc6280-timed-inputs')throw Error('Invalid historical HuC6280 test input archive');
const decoded=new Map();
export function readPreHucTimedInput(location){
 const url=location instanceof URL?location:new URL('file://'+resolve(String(location)));
 const name=relative(root,fileURLToPath(url)).replaceAll('\\','/'),entry=snapshot.sources[name];
 if(!entry)return readLive(url);
 if(!decoded.has(name)){
  const bytes=gunzipSync(Buffer.from(entry.gzipBase64,'base64'),{maxOutputLength:2*1024*1024});
  if(bytes.length!==entry.bytes||sha(bytes)!==entry.sha256)throw Error('Historical HuC6280 source mismatch: '+name);
  decoded.set(name,bytes);
 }
 return Buffer.from(decoded.get(name));
}
const postSourceMix=createHistoricalFm2612ApplicationReader(readPreHucTimedInput);
const reviewed=createHistoricalYm2608SourceMixReader(postSourceMix);
export function readPostSourceMixFileSync(location,options){
 const url=location instanceof URL?location:new URL('file://'+resolve(String(location))),bytes=postSourceMix(url);
 const encoding=typeof options==='string'?options:options?.encoding;
 return encoding?bytes.toString(encoding):bytes;
}
export function readFileSync(location,options){
 const url=location instanceof URL?location:new URL('file://'+resolve(String(location))),bytes=reviewed(url);
 const encoding=typeof options==='string'?options:options?.encoding;
 return encoding?bytes.toString(encoding):bytes;
}
