// SPDX-License-Identifier: BSD-3-Clause
// Restore only this exact reviewed SID timed-API promotion. Historical source
// identities and gain policy remain intact; future renderer edits get no pass.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=new URL('../',import.meta.url);
export const SID_TIMED_REVISION_BASE_COMMIT='8f1b7563ea1d845e67f4fbdfd06aaf597936bc33';
export const SID_TIMED_REVISION_RECEIPT='docs/issues/sid_timed_source_revision_01.json';
export const SID_TIMED_REVISION_PIN='b68298ae63c79689812a0b06e95c1046eab3b4dbedeab58aa828c558bfc6cfb4';
export const SID_TIMED_PCM_REPORT='docs/issues/sid_timed_default_pcm_01.json';
const functional=new Set(['playground_sid.js','playground_sid_worklet.js','playground_runtime.js','playground_performance_processor.js','playground_performance_sender.js']
 .flatMap(name=>['tetorica_src/runtime/'+name,'docs/js/'+name]));
const ui=new Set(['docs/playground/playground_monaco_definitions.js','docs/playground/tetorica-playground-globals.d.ts',
 'tetorica_src/runtime/playground_sid.d.ts','docs/js/playground_sid.d.ts']);
const tools=new Set(['packages/fm2612/README.md','scripts/fm2612_type_sources.mjs','scripts/package_itch_playground.sh','scripts/check_playground_package.mjs','scripts/sync_web_js_to_docs.sh','scripts/version_playground_runtime.mjs','test/runtime/playground_independent_performance.test.mjs']);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const isRecord=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[a-f0-9]{64}$/.test(value.sha256);
const matches=(bytes,expected)=>isRecord(expected)&&bytes.length===expected.bytes&&digest(bytes)===expected.sha256;
const fail=message=>{throw Error('served DSP/WASM source changed; remeasure: SID timed revision '+message);};
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
 const receipt=JSON.parse(read(SID_TIMED_REVISION_RECEIPT));
 if(digest(JSON.stringify(receipt))!==SID_TIMED_REVISION_PIN||receipt.schemaVersion!==1||receipt.scope!=='sid-timed-api-default-pcm-parity'||receipt.baseCommit!==SID_TIMED_REVISION_BASE_COMMIT||!receipt.sources||!receipt.dependencies)fail('receipt');
 for(const name of [...functional,...ui])if(!Object.hasOwn(receipt.sources,name))fail('missing reviewed source '+name);
 return receipt;
}
function validateEvidence(receipt,read){
 const restored=new Map();
 for(const [name,entry]of Object.entries(receipt.sources)){
  if((!tools.has(name)&&!/^(?:docs\/(?:js|playground)\/|tetorica_src\/runtime\/)/.test(name))||name.includes('..'))fail('source scope');
  const after=Buffer.from(read(name));if(!matches(after,entry.after))fail(name);
  const before=predecessor(after,entry);restored.set(name,before);
  if(functional.has(name)){if(entry.kind!=='sid-timed-default-path')fail('functional classification '+name);}
  else if(ui.has(name)){if(entry.kind!=='editor-declarations')fail('UI classification '+name);}
  else if(tools.has(name)){if(entry.kind!=='non-renderer-api-docs-tools')fail('tool classification '+name);}
  else if(entry.kind!=='import-cache-only'||!stripVersions(before).equals(stripVersions(after)))fail('non-cache renderer edit '+name);
 }
 const shared='tetorica_src/runtime/playground_performance_processor.js';
 const expected=restored.get(shared).toString()
  .replace("if(!metadata?.preserveOwner&&!note(command,port,metadata))return false;","if(!metadata?.preserveOwner&&!(chipName()==='sid'&&command.preserveOwner===true)&&!note(command,port,metadata))return false;")
  .replace("['ay8910','huc6280','wonderswan','gameboy']","['ay8910','huc6280','wonderswan','gameboy','sid']")
  .replace("if(!event.on&&metadata&&previous&&previous.owner!==metadata.owner&&!manualOwner)return false;","if(!event.on&&metadata&&previous&&previous.owner!==metadata.owner&&!manualOwner&&\n      !(chipName()==='sid'&&metadata.timedOperation&&metadata.sidReleaseAllowed===true))return false;");
 if(!stripVersions(Buffer.from(expected)).equals(stripVersions(Buffer.from(read(shared)))))fail('shared processor SID-only scope');
 const sender='tetorica_src/runtime/playground_performance_sender.js';
 const expectedSender=restored.get(sender).toString().replace("'psgTimed','opllTimed']","'psgTimed','opllTimed','sidTimed']");
 if(!stripVersions(Buffer.from(expectedSender)).equals(stripVersions(Buffer.from(read(sender)))))fail('shared sender SID-only scope');
 for(const [name,expected]of Object.entries(receipt.dependencies))if(!matches(Buffer.from(read(name)),expected))fail('dependency '+name);
 const proof=JSON.parse(read(SID_TIMED_PCM_REPORT));
 if(!matches(Buffer.from(read(SID_TIMED_PCM_REPORT)),receipt.proof)||proof.schemaVersion!==1||proof.scope!=='sid-timed-api-default-worklet-pcm'||proof.baseCommit!==SID_TIMED_REVISION_BASE_COMMIT||proof.passed!==true||proof.physicalAudio!==false||proof.audioContextCreated!==false||proof.timedOperationsUsed!==false||proof.maximumDifference!==0||proof.cases?.length!==282||proof.totalStereoFrames!==1155072)fail('default PCM proof');
 for(const name of ['playground_sid.js','playground_sid_worklet.js','playground_performance_processor.js','playground_opn_worklet.js']){
  const path='tetorica_src/runtime/'+name,pair=proof.sources?.[path],source=receipt.sources[path];
  const before=source?.before??receipt.dependencies[path],after=source?.after??receipt.dependencies[path];
  if(!pair||!before||JSON.stringify(pair.before)!==JSON.stringify(before)||JSON.stringify(pair.after)!==JSON.stringify(after))fail('proof source '+path);
 }
 const validCases=cases=>cases.every(row=>row.frames===4096&&row.nonzero>0&&row.maximumDifference===0&&/^[a-f0-9]{64}$/.test(row.pcmSha256));
 for(const rate of [44100,48000])for(const [model,clock]of [['6581',985248],['6581',1022727],['8580',985248]]){
  const cases=proof.cases.filter(row=>row.chip==='sid'&&row.rate===rate&&row.clock===clock&&row.model===model);
  if(cases.length!==45||new Set(cases.map(row=>row.scene)).size!==45||!validCases(cases))fail('SID PCM coverage');
 }
 for(const rate of [44100,48000])for(const engine of ['ymfm','nuked']){
  const cases=proof.cases.filter(row=>row.chip==='ym2612'&&row.rate===rate&&row.engine===engine);
  if(cases.length!==3||new Set(cases.map(row=>row.scene)).size!==3||!validCases(cases))fail('primary OPN PCM coverage');
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
export function restoreMixerCalibrationSidTimedRevision(path,bytes,{read=readDefault}={}){return restorer(read)(path,bytes);}
export function createSidTimedRevisionReadContext(readSource=url=>readFileSync(url)){
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
