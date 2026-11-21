import {createSnesTimedRevisionReadContext} from './mixer_calibration_snes_timed_revision.mjs';
// SPDX-License-Identifier: BSD-3-Clause
// NES prepared FDS timed-playback review. No historical source hashes are rewritten.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
export const NES_FDS_RAM_RECEIPT='docs/issues/nes_fds_ram_revision_20261121.json';
export const NES_FDS_RAM_PIN='1c9299ef5e679812ff019f210bd71c5fe5ffec64e2cb27ed506b623876538caa';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const matches=(bytes,record)=>bytes.length===record?.bytes&&sha(bytes)===record?.sha256;
function evidence(read){
 const bytes=read(new URL(NES_FDS_RAM_RECEIPT,root));
 if(sha(bytes)!==NES_FDS_RAM_PIN)throw Error('NES FDS timed review receipt identity changed');
 const data=JSON.parse(bytes);
 if(data.schemaVersion!==1||data.scope!=='nes-fds-ram-timed-playback')throw Error('Invalid NES FDS timed review');
 return data;
}
function predecessor(bytes,entry){
 const parts=[];let cursor=0;
 for(const hunk of entry.hunks){
  if(!Number.isSafeInteger(hunk.afterOffset)||hunk.afterOffset<cursor||!Number.isSafeInteger(hunk.afterBytes)||hunk.afterBytes<0||hunk.afterOffset+hunk.afterBytes>bytes.length)throw Error('Invalid NES FDS timed hunk');
  const old=Buffer.from(hunk.beforeBase64,'base64');if(old.toString('base64')!==hunk.beforeBase64)throw Error('Invalid NES FDS timed hunk encoding');
  parts.push(bytes.subarray(cursor,hunk.afterOffset),old);cursor=hunk.afterOffset+hunk.afterBytes;
 }
 parts.push(bytes.subarray(cursor));const result=Buffer.concat(parts);
 if(!matches(result,entry.before))throw Error('NES FDS timed predecessor identity changed');
 return result;
}
export function createNesFdsRamRevisionReadContext(read=readFileSync){
 const latest=createSnesTimedRevisionReadContext(read);read=latest.readSource;
 const {sources,dependencies}=evidence(read);let checked=false;
 const check=()=>{if(checked)return;for(const [name,record]of Object.entries(dependencies)){
  if(!matches(read(new URL(name,root)),record))throw Error('Unreviewed NES FDS timed dependency: '+name);
 }checked=true;};
 function restore(path,bytes){
  bytes=latest.restore(path,bytes);
  const name=Object.hasOwn(sources,path)?path:'docs/'+path,entry=sources[name];
  if(!entry||!matches(bytes,entry.after))return bytes;
  check();return predecessor(Buffer.from(bytes),entry);
 }
 return {restore,readSource(url){const bytes=read(url);return url instanceof URL&&url.protocol==='file:'?restore(relative(fileURLToPath(root),fileURLToPath(url)).replaceAll('\\','/'),bytes):bytes;}};
}
export function readNesFdsRamPredecessor(path){
 const latest=createSnesTimedRevisionReadContext(),bytes=latest.restore(path,readFileSync(new URL(path,root))),data=evidence(readFileSync),entry=data.sources[path];
 if(!entry||!matches(bytes,entry.after))throw Error('Unreviewed standalone NES FDS predecessor source');
 return createNesFdsRamRevisionReadContext().restore(path,bytes).toString('utf8');
}
