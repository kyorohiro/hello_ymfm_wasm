// SPDX-License-Identifier: BSD-3-Clause
// Restore only the exact, reviewed DMG timed-API promotion. Original measured
// hashes and gain policy stay intact; future renderer edits get no exemption.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=new URL('../',import.meta.url);
export const GAMEBOY_TIMED_REVISION_BASE_COMMIT='b5defa15048fd82b3bb96b032e8fee17e249c34c';
export const GAMEBOY_TIMED_REVISION_RECEIPT='docs/issues/gameboy_timed_source_revision_01.json';
export const GAMEBOY_TIMED_REVISION_PIN='7628247527815e289a0175ed94fae0b7432c53d9f8f7b3b90cb8c9ae5e056ca8';
export const GAMEBOY_TIMED_PCM_REPORT='docs/issues/gameboy_timed_default_pcm_01.json';
const functional=new Set(['gameboy_runtime_synth.js','playground_gameboy.js','playground_gameboy_worklet.js','playground_performance_processor.js']
 .flatMap(name=>['tetorica_src/runtime/'+name,'docs/js/'+name]));
const ui=new Set(['docs/playground/playground_monaco_definitions.js','docs/playground/tetorica-playground-globals.d.ts']);
const tools=new Set(['packages/fm2612/README.md','scripts/fm2612_type_sources.mjs','scripts/package_itch_playground.sh','scripts/sync_web_js_to_docs.sh']);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const isRecord=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[a-f0-9]{64}$/.test(value.sha256);
const matches=(bytes,expected)=>isRecord(expected)&&bytes.length===expected.bytes&&digest(bytes)===expected.sha256;
const fail=message=>{throw Error('served DSP/WASM source changed; remeasure: Game Boy timed revision '+message);};
const readDefault=name=>readFileSync(new URL(name,root));
const stripVersions=bytes=>Buffer.from(bytes.toString('utf8').replace(/\?v=[A-Za-z0-9._+-]+/g,''));
function sourceName(path){
 if(typeof path!=='string')return path;
 if(path.startsWith('web/'))return 'tetorica_src/runtime/'+path.slice(4);
 return /^(?:js|playground)\//.test(path)?'docs/'+path:path;
}
function predecessor(bytes,entry){
 if(!isRecord(entry?.before)||!isRecord(entry.after)||!Array.isArray(entry.hunks)||!entry.hunks.length)fail('source pair');
 const pieces=[];let cursor=0;
 for(const hunk of entry.hunks){
  if(!Number.isSafeInteger(hunk.afterOffset)||hunk.afterOffset<cursor||!Number.isSafeInteger(hunk.afterBytes)||hunk.afterBytes<0||hunk.afterOffset+hunk.afterBytes>bytes.length||typeof hunk.beforeBase64!=='string')fail('source patch');
  const before=Buffer.from(hunk.beforeBase64,'base64');if(before.toString('base64')!==hunk.beforeBase64)fail('source patch encoding');
  pieces.push(bytes.subarray(cursor,hunk.afterOffset),before);cursor=hunk.afterOffset+hunk.afterBytes;
 }pieces.push(bytes.subarray(cursor));const before=Buffer.concat(pieces);
 if(!matches(before,entry.before))fail('predecessor identity');return before;
}
function evidence(read){
 const receipt=JSON.parse(read(GAMEBOY_TIMED_REVISION_RECEIPT));
 if(digest(JSON.stringify(receipt))!==GAMEBOY_TIMED_REVISION_PIN||receipt.schemaVersion!==1||receipt.scope!=='gameboy-timed-api-default-pcm-parity'||receipt.baseCommit!==GAMEBOY_TIMED_REVISION_BASE_COMMIT||!receipt.sources||!receipt.dependencies)fail('receipt');
 for(const name of [...functional,...ui,...tools])if(!Object.hasOwn(receipt.sources,name))fail('missing reviewed source '+name);
 return receipt;
}
function validateEvidence(receipt,read){
 const restored=new Map();
 for(const [name,entry]of Object.entries(receipt.sources)){
  if((!tools.has(name)&&!/^(?:docs\/(?:js|playground)\/|tetorica_src\/runtime\/)/.test(name))||name.includes('..'))fail('source scope');
  const after=Buffer.from(read(name));if(!matches(after,entry.after))fail(name);
  const before=predecessor(after,entry);restored.set(name,before);
  if(functional.has(name)){if(entry.kind!=='gameboy-timed-default-path')fail('functional classification '+name);}
  else if(ui.has(name)){if(entry.kind!=='editor-declarations')fail('UI classification '+name);}
  else if(tools.has(name)){if(entry.kind!=='non-renderer-api-docs-tools')fail('tool classification '+name);}
  else if(entry.kind!=='import-cache-only'||!stripVersions(before).equals(stripVersions(after)))fail('non-cache renderer edit '+name);
 }
 const path='tetorica_src/runtime/playground_performance_processor.js';
 if(!Buffer.from(restored.get(path).toString().replace("['ay8910','huc6280','wonderswan']","['ay8910','huc6280','wonderswan','gameboy']")).equals(Buffer.from(read(path))))fail('shared processor scope');
 for(const [name,expected]of Object.entries(receipt.dependencies))if(!matches(Buffer.from(read(name)),expected))fail('dependency '+name);
 const proof=JSON.parse(read(GAMEBOY_TIMED_PCM_REPORT));
 if(!matches(Buffer.from(read(GAMEBOY_TIMED_PCM_REPORT)),receipt.proof)||proof.schemaVersion!==1||proof.scope!=='gameboy-timed-api-default-worklet-pcm'||proof.baseCommit!==GAMEBOY_TIMED_REVISION_BASE_COMMIT||proof.passed!==true||proof.physicalAudio!==false||proof.audioContextCreated!==false||proof.timedOperationsUsed!==false||proof.maximumDifference!==0||proof.cases?.length!==180||proof.totalStereoFrames!==737280)fail('default PCM proof');
 for(const name of ['playground_gameboy.js','playground_gameboy_worklet.js','playground_performance_processor.js']){
  const path='tetorica_src/runtime/'+name,pair=proof.sources?.[path],source=receipt.sources[path];
  if(!pair||JSON.stringify(pair.before)!==JSON.stringify(source.before)||JSON.stringify(pair.after)!==JSON.stringify(source.after))fail('proof source '+path);
 }
 for(const rate of [44100,48000])for(const clock of [4194304,4000000]){
  const cases=proof.cases.filter(row=>row.rate===rate&&row.clock===clock);
  if(cases.length!==45||new Set(cases.map(row=>row.scene)).size!==45||cases.some(row=>row.frames!==4096||row.nonzero<=0||row.maximumDifference!==0||!/^[a-f0-9]{64}$/.test(row.pcmSha256)))fail('PCM coverage');
 }
}
function restorer(read,snapshot=false){
 let receipt,verified=false;
 return(path,bytes)=>{
  const name=sourceName(path);receipt=snapshot?receipt??evidence(read):evidence(read);
  if(!Object.hasOwn(receipt.sources,name))return bytes;
  const entry=receipt.sources[name];if(!matches(bytes,entry.after))return bytes;
  if(!verified){validateEvidence(receipt,read);verified=snapshot;}
  return predecessor(Buffer.from(bytes),entry);
 };
}
export function restoreMixerCalibrationGameboyTimedRevision(path,bytes,{read=readDefault}={}){return restorer(read)(path,bytes);}
export function createGameboyTimedRevisionReadContext(readSource=url=>readFileSync(url)){
 const originals=new Map(),predecessors=new Map();
 const read=name=>{if(!originals.has(name))originals.set(name,Buffer.from(readSource(new URL(name,root))));return originals.get(name);};
 const restore=restorer(read,true);
 const reader=url=>{
  if(!(url instanceof URL)||url.protocol!=='file:')return readSource(url);
  const name=relative(fileURLToPath(root),fileURLToPath(url)).replaceAll('\\','/');
  if(!predecessors.has(name))predecessors.set(name,restore(name,read(name)));return predecessors.get(name);
 };
 return{restore,readSource:reader};
}
