import {createNesDmcRevisionReadContext} from './mixer_calibration_nes_dmc_revision.mjs';
// SPDX-License-Identifier: BSD-3-Clause
// NES Pulse/Triangle/Noise timed-operation review. No historical source hashes are rewritten.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
export const NES_TIMED_RECEIPT='docs/issues/nes_timed_revision_20261121.json';
export const NES_TIMED_PIN='e9506e6522e2d4f61471cd30d63bd251ed4c94eee988cd423191a9019059c5ef';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const matches=(bytes,record)=>bytes.length===record?.bytes&&sha(bytes)===record?.sha256;
function evidence(read){
 const bytes=read(new URL(NES_TIMED_RECEIPT,root));
 if(sha(bytes)!==NES_TIMED_PIN)throw Error('NES NES timed review receipt identity changed');
 const data=JSON.parse(bytes);
 if(data.schemaVersion!==1||data.scope!=='nes-timed-registers')throw Error('Invalid NES NES timed review');
 return data;
}
function predecessor(bytes,entry){
 const parts=[];let cursor=0;
 for(const hunk of entry.hunks){
  if(!Number.isSafeInteger(hunk.afterOffset)||hunk.afterOffset<cursor||!Number.isSafeInteger(hunk.afterBytes)||hunk.afterBytes<0||hunk.afterOffset+hunk.afterBytes>bytes.length)throw Error('Invalid NES NES timed hunk');
  const old=Buffer.from(hunk.beforeBase64,'base64');if(old.toString('base64')!==hunk.beforeBase64)throw Error('Invalid NES NES timed hunk encoding');
  parts.push(bytes.subarray(cursor,hunk.afterOffset),old);cursor=hunk.afterOffset+hunk.afterBytes;
 }
 parts.push(bytes.subarray(cursor));const result=Buffer.concat(parts);
 if(!matches(result,entry.before))throw Error('NES NES timed predecessor identity changed');
 return result;
}
export function createNesTimedRevisionReadContext(read=readFileSync){
 const latest=createNesDmcRevisionReadContext(read);read=latest.readSource;
 const {sources,dependencies}=evidence(read);let checked=false;
 const check=()=>{if(checked)return;for(const [name,record]of Object.entries(dependencies)){
  if(!matches(read(new URL(name,root)),record))throw Error('Unreviewed NES NES timed dependency: '+name);
 }checked=true;};
 function restore(path,bytes){
  bytes=latest.restore(path,bytes);
  const name=Object.hasOwn(sources,path)?path:'docs/'+path,entry=sources[name];
  if(!entry||!matches(bytes,entry.after))return bytes;
  check();return predecessor(Buffer.from(bytes),entry);
 }
 return {restore,readSource(url){const bytes=read(url);return url instanceof URL&&url.protocol==='file:'?restore(relative(fileURLToPath(root),fileURLToPath(url)).replaceAll('\\','/'),bytes):bytes;}};
}
export function readNesTimedPredecessor(path){
 const latest=createNesDmcRevisionReadContext(),bytes=latest.restore(path,readFileSync(new URL(path,root))),data=evidence(readFileSync),entry=data.sources[path];
 if(!entry||!matches(bytes,entry.after))throw Error('Unreviewed standalone FM2608 predecessor source');
 return createNesTimedRevisionReadContext().restore(path,bytes).toString('utf8');
}
