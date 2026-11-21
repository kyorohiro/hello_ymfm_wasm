import {createFm2608MonitorRevisionReadContext} from './mixer_calibration_fm2608_monitor_revision.mjs';
// SPDX-License-Identifier: BSD-3-Clause
// Exact, reversible FM/SSG connection review. Historical measurements stay intact.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
export const YM2608_TIMED_RECEIPT='docs/issues/ym2608_timed_revision_20261121.json';
export const YM2608_TIMED_PIN='f2b9b435d70f90fa09927f3a4724eeaf8b2b5b143dc4b8fc7f58643c7f764770';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const matches=(bytes,entry)=>bytes.length===entry?.bytes&&sha(bytes)===entry?.sha256;
function evidence(){
 const bytes=readFileSync(new URL(YM2608_TIMED_RECEIPT,root));
 if(sha(bytes)!==YM2608_TIMED_PIN)throw Error('YM2608 timed revision receipt identity changed');
 const data=JSON.parse(bytes);if(data.schemaVersion!==1||data.scope!=='ym2608-fm-ssg-timed-connection')throw Error('Invalid YM2608 review');
 return data;
}
function previous(bytes,entry){
 const parts=[];let cursor=0;
 for(const hunk of entry.hunks){
  if(!Number.isSafeInteger(hunk.afterOffset)||hunk.afterOffset<cursor||!Number.isSafeInteger(hunk.afterBytes)||hunk.afterBytes<0||hunk.afterOffset+hunk.afterBytes>bytes.length)throw Error('Invalid YM2608 review hunk');
  const old=Buffer.from(hunk.beforeBase64,'base64');if(old.toString('base64')!==hunk.beforeBase64)throw Error('Invalid YM2608 review encoding');
  parts.push(bytes.subarray(cursor,hunk.afterOffset),old);cursor=hunk.afterOffset+hunk.afterBytes;
 }
 parts.push(bytes.subarray(cursor));const result=Buffer.concat(parts);
 if(!matches(result,entry.before))throw Error('YM2608 predecessor identity changed');
 return result;
}
export function createYm2608TimedRevisionReadContext(readSource=readFileSync){
 const latest=createFm2608MonitorRevisionReadContext(readSource);readSource=latest.readSource;
 const {sources,dependencies}=evidence();
 let checked=false;
 const check=()=>{if(checked)return;for(const [name,record]of Object.entries(dependencies)){
   if(!matches(readSource(new URL(name,root)),record))throw Error('Unreviewed YM2608 timed dependency: '+name);
 }checked=true;};
 function restore(path,bytes){
  bytes=latest.restore(path,bytes);
  const name=Object.hasOwn(sources,path)?path:'docs/'+path,entry=sources[name];
  if(!entry||!matches(bytes,entry.after))return bytes;
  check();return previous(Buffer.from(bytes),entry);
 }
 return {restore,readSource(url){
  const bytes=readSource(url);
  if(!(url instanceof URL)||url.protocol!=='file:')return bytes;
  return restore(relative(fileURLToPath(root),fileURLToPath(url)).replaceAll('\\','/'),bytes);
 }};
}
/** Test-only authenticated pre-feature Worklet; never used for live playback. */
export function readHistoricalYm2608TimedWorklet(path){
 const {sources}=evidence(),entry=sources[path],bytes=readFileSync(new URL(path,root));
 if(!entry||!matches(bytes,entry.after))throw Error('Unreviewed YM2608 Worklet bytes');
 return previous(bytes,entry).toString('utf8');
}
