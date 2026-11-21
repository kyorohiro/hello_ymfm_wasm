// SPDX-License-Identifier: BSD-3-Clause
// NES prepared DMC timed-playback review. No historical source hashes are rewritten.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
export const NES_DMC_RECEIPT='docs/issues/nes_dmc_revision_20261121.json';
export const NES_DMC_PIN='c76d4b2e7481ca7868d7ef312d825d80b30dfa357fb258fa00a7830426c154e2';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const matches=(bytes,record)=>bytes.length===record?.bytes&&sha(bytes)===record?.sha256;
function evidence(read){
 const bytes=read(new URL(NES_DMC_RECEIPT,root));
 if(sha(bytes)!==NES_DMC_PIN)throw Error('NES DMC timed review receipt identity changed');
 const data=JSON.parse(bytes);
 if(data.schemaVersion!==1||data.scope!=='nes-dmc-timed-playback')throw Error('Invalid NES DMC timed review');
 return data;
}
function predecessor(bytes,entry){
 const parts=[];let cursor=0;
 for(const hunk of entry.hunks){
  if(!Number.isSafeInteger(hunk.afterOffset)||hunk.afterOffset<cursor||!Number.isSafeInteger(hunk.afterBytes)||hunk.afterBytes<0||hunk.afterOffset+hunk.afterBytes>bytes.length)throw Error('Invalid NES DMC timed hunk');
  const old=Buffer.from(hunk.beforeBase64,'base64');if(old.toString('base64')!==hunk.beforeBase64)throw Error('Invalid NES DMC timed hunk encoding');
  parts.push(bytes.subarray(cursor,hunk.afterOffset),old);cursor=hunk.afterOffset+hunk.afterBytes;
 }
 parts.push(bytes.subarray(cursor));const result=Buffer.concat(parts);
 if(!matches(result,entry.before))throw Error('NES DMC timed predecessor identity changed');
 return result;
}
export function createNesDmcRevisionReadContext(read=readFileSync){
 const {sources,dependencies}=evidence(read);let checked=false;
 const check=()=>{if(checked)return;for(const [name,record]of Object.entries(dependencies)){
  if(!matches(read(new URL(name,root)),record))throw Error('Unreviewed NES DMC timed dependency: '+name);
 }checked=true;};
 function restore(path,bytes){
  const name=Object.hasOwn(sources,path)?path:'docs/'+path,entry=sources[name];
  if(!entry||!matches(bytes,entry.after))return bytes;
  check();return predecessor(Buffer.from(bytes),entry);
 }
 return {restore,readSource(url){const bytes=read(url);return url instanceof URL&&url.protocol==='file:'?restore(relative(fileURLToPath(root),fileURLToPath(url)).replaceAll('\\','/'),bytes):bytes;}};
}
export function readNesDmcPredecessor(path){
 const bytes=readFileSync(new URL(path,root)),data=evidence(readFileSync),entry=data.sources[path];
 if(!entry||!matches(bytes,entry.after))throw Error('Unreviewed standalone NES DMC predecessor source');
 return createNesDmcRevisionReadContext().restore(path,bytes).toString('utf8');
}
