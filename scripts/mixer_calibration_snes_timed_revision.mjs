// SPDX-License-Identifier: BSD-3-Clause
// SNES S-DSP timed-operation review. No historical source hashes are rewritten.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCodeApiConsistencyRevisionReadContext} from './mixer_calibration_code_api_consistency_revision.mjs';
const root=new URL('../',import.meta.url);
export const SNES_TIMED_RECEIPT='docs/issues/snes_timed_revision_20261121.json';
export const SNES_TIMED_PIN='8510222e7158f5b59a0bfd6270f5b0c57b901c57cc25a09f88f58456568393cb';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const matches=(bytes,record)=>bytes.length===record?.bytes&&sha(bytes)===record?.sha256;
function evidence(read){
 const bytes=read(new URL(SNES_TIMED_RECEIPT,root));
 if(sha(bytes)!==SNES_TIMED_PIN)throw Error('SNES S-DSP timed review receipt identity changed');
 const data=JSON.parse(bytes);
 if(data.schemaVersion!==1||data.scope!=='snes-timed-operations')throw Error('Invalid SNES S-DSP timed review');
 return data;
}
function predecessor(bytes,entry){
 const parts=[];let cursor=0;
 for(const hunk of entry.hunks){
  if(!Number.isSafeInteger(hunk.afterOffset)||hunk.afterOffset<cursor||!Number.isSafeInteger(hunk.afterBytes)||hunk.afterBytes<0||hunk.afterOffset+hunk.afterBytes>bytes.length)throw Error('Invalid SNES S-DSP timed hunk');
  const old=Buffer.from(hunk.beforeBase64,'base64');if(old.toString('base64')!==hunk.beforeBase64)throw Error('Invalid SNES S-DSP timed hunk encoding');
  parts.push(bytes.subarray(cursor,hunk.afterOffset),old);cursor=hunk.afterOffset+hunk.afterBytes;
 }
 parts.push(bytes.subarray(cursor));const result=Buffer.concat(parts);
 if(!matches(result,entry.before))throw Error('SNES S-DSP timed predecessor identity changed');
 return result;
}
export function createSnesTimedRevisionReadContext(read=readFileSync){
 const latest=createCodeApiConsistencyRevisionReadContext(read);
 const {sources,dependencies}=evidence(read);let checked=false;
 const check=()=>{if(checked)return;for(const [name,record]of Object.entries(dependencies)){
  if(!matches(latest.readSource(new URL(name,root)),record))throw Error('Unreviewed SNES S-DSP timed dependency: '+name);
 }checked=true;};
 function restore(path,bytes){
  const name=Object.hasOwn(sources,path)?path:'docs/'+path,entry=sources[name];
  const previous=latest.restore(path,bytes);
  if(!entry||!matches(previous,entry.after))return previous;
  check();return predecessor(Buffer.from(previous),entry);
 }
 return {restore,readSource(url){const bytes=read(url);return url instanceof URL&&url.protocol==='file:'?restore(relative(fileURLToPath(root),fileURLToPath(url)).replaceAll('\\','/'),bytes):bytes;}};
}
export function readSnesTimedPredecessor(path){
 const latest=createCodeApiConsistencyRevisionReadContext(),bytes=latest.readSource(new URL(path,root)),data=evidence(readFileSync),entry=data.sources[path];
 if(!entry||!matches(bytes,entry.after))throw Error('Unreviewed standalone SNES S-DSP predecessor source');
 return createSnesTimedRevisionReadContext().restore(path,bytes).toString('utf8');
}
