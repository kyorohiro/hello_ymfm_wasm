import {createNesTimedRevisionReadContext} from './mixer_calibration_nes_timed_revision.mjs';
// SPDX-License-Identifier: BSD-3-Clause
// YM2608-only Adpcm timed-operation review. No historical source hashes are rewritten.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
export const YM2608_ADPCM_RECEIPT='docs/issues/ym2608_adpcm_timed_revision_20261121.json';
export const YM2608_ADPCM_PIN='cf0b38f417067320fa8dbe93acd4bd06928588f9b3eb3a7b92f16dadb41ed252';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const matches=(bytes,record)=>bytes.length===record?.bytes&&sha(bytes)===record?.sha256;
function evidence(read){
 const bytes=read(new URL(YM2608_ADPCM_RECEIPT,root));
 if(sha(bytes)!==YM2608_ADPCM_PIN)throw Error('YM2608 Adpcm review receipt identity changed');
 const data=JSON.parse(bytes);
 if(data.schemaVersion!==1||data.scope!=='ym2608-timed-adpcm')throw Error('Invalid YM2608 Adpcm review');
 return data;
}
function predecessor(bytes,entry){
 const parts=[];let cursor=0;
 for(const hunk of entry.hunks){
  if(!Number.isSafeInteger(hunk.afterOffset)||hunk.afterOffset<cursor||!Number.isSafeInteger(hunk.afterBytes)||hunk.afterBytes<0||hunk.afterOffset+hunk.afterBytes>bytes.length)throw Error('Invalid YM2608 Adpcm hunk');
  const old=Buffer.from(hunk.beforeBase64,'base64');if(old.toString('base64')!==hunk.beforeBase64)throw Error('Invalid YM2608 Adpcm hunk encoding');
  parts.push(bytes.subarray(cursor,hunk.afterOffset),old);cursor=hunk.afterOffset+hunk.afterBytes;
 }
 parts.push(bytes.subarray(cursor));const result=Buffer.concat(parts);
 if(!matches(result,entry.before))throw Error('YM2608 Adpcm predecessor identity changed');
 return result;
}
export function createYm2608AdpcmRevisionReadContext(read=readFileSync){
 const latest=createNesTimedRevisionReadContext(read);read=latest.readSource;
 const {sources,dependencies}=evidence(read);let checked=false;
 const check=()=>{if(checked)return;for(const [name,record]of Object.entries(dependencies)){
  if(!matches(read(new URL(name,root)),record))throw Error('Unreviewed YM2608 Adpcm dependency: '+name);
 }checked=true;};
 function restore(path,bytes){
  bytes=latest.restore(path,bytes);
  const name=Object.hasOwn(sources,path)?path:'docs/'+path,entry=sources[name];
  if(!entry||!matches(bytes,entry.after))return bytes;
  check();return predecessor(Buffer.from(bytes),entry);
 }
 return {restore,readSource(url){const bytes=read(url);return url instanceof URL&&url.protocol==='file:'?restore(relative(fileURLToPath(root),fileURLToPath(url)).replaceAll('\\','/'),bytes):bytes;}};
}
export function readYm2608AdpcmPredecessor(path){
 const latest=createNesTimedRevisionReadContext(),bytes=latest.restore(path,readFileSync(new URL(path,root))),data=evidence(readFileSync),entry=data.sources[path];
 if(!entry||!matches(bytes,entry.after))throw Error('Unreviewed standalone FM2608 predecessor source');
 return createYm2608AdpcmRevisionReadContext().restore(path,bytes).toString('utf8');
}
