// SPDX-License-Identifier: BSD-3-Clause
// A separate, exact review of Main/Worker API connections. This is neither a
// metadata exemption nor permission to change an audio renderer or old gains.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=new URL('../',import.meta.url);
export const GAMEBOY_PUBLIC_TIMED_RECEIPT='docs/issues/gameboy_public_timed_release_revision_20261121.json';
export const GAMEBOY_PUBLIC_TIMED_PIN='6ff97c1bac1bf51360569b3880bd39cc410a1c1e45e20bbbe5ed67bc9049c0a5';
export const GAMEBOY_PUBLIC_TIMED_BASE='33f71b326bdc51bc6d6be4e7f1394d5dc4f362e3';
const names=['playground_runtime.js','playground_performance_sender.js','playground_worker_chip.js','playground_logic_worker.js'];
const functional=new Set(names.flatMap(name=>['tetorica_src/runtime/'+name,'docs/js/'+name]));
const tools=new Set(['scripts/version_playground_runtime.mjs']);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256);
const matches=(bytes,value)=>record(value)&&bytes.length===value.bytes&&sha(bytes)===value.sha256;
const fail=message=>{throw Error('served DSP/WASM source changed; remeasure: Unreviewed Game Boy public timed connection: '+message);};
const stripVersions=bytes=>Buffer.from(bytes.toString('utf8').replace(/\?v=[A-Za-z0-9._+-]+/g,''));
function predecessor(bytes,entry){
  if(!record(entry?.before)||!record(entry.after)||!Array.isArray(entry.hunks)||!entry.hunks.length)fail('source pair');
  const parts=[];let cursor=0;
  for(const hunk of entry.hunks){
    if(!Number.isSafeInteger(hunk.afterOffset)||hunk.afterOffset<cursor||!Number.isSafeInteger(hunk.afterBytes)||hunk.afterBytes<0||hunk.afterOffset+hunk.afterBytes>bytes.length||typeof hunk.beforeBase64!=='string')fail('source hunk');
    const before=Buffer.from(hunk.beforeBase64,'base64');if(before.toString('base64')!==hunk.beforeBase64)fail('source encoding');
    parts.push(bytes.subarray(cursor,hunk.afterOffset),before);cursor=hunk.afterOffset+hunk.afterBytes;
  }
  parts.push(bytes.subarray(cursor));const restored=Buffer.concat(parts);
  if(!matches(restored,entry.before))fail('predecessor identity');
  return restored;
}

// Require exactly the reviewed wiring changes, in addition to complete source
// hashes. Existing audio-method bodies, Worklets and performance clocks remain
// untouched; only the established timed capability is exposed/transported.
function connection(name,before){
  const text=before.toString('utf8');
  if(name.endsWith('/playground_runtime.js'))return text.replace(
    'nativeApis.gameboy ?? keyboardApi(sharedGameboy)',
    'nativeApis.gameboy ?? keyboardApi(ayTimedLifecycle.wrap(sharedGameboy))');
  if(name.endsWith('/playground_performance_sender.js'))return text.replace(
    "'psgTimed','opllTimed','sidTimed'].includes(data?.method)",
    "'psgTimed','opllTimed','sidTimed','gameboyTimed'].includes(data?.method)");
  if(name.endsWith('/playground_logic_worker.js'))return text.replace(
    'native.apis.gameboy ?? keyboardApi(chip?.gameboy ?? new Proxy({}, {',
    'native.apis.gameboy ?? keyboardApi(chip?.gameboy ? ayTimedLifecycle.wrap(chip.gameboy) : new Proxy({}, {');
  if(name.endsWith('/playground_worker_chip.js'))return text
    .replace("import {GameboySynth} from './gameboysynth.js';", "import {GameboySynth} from './gameboysynth.js';\nimport {attachGameboyTimedClient} from './gameboy_timed_client.js';")
    .replace("  writeRegister(offset,value){send({method:'writeRegister',args:[offset,value]});},", `  writeRegister(offset,value){
   const state=raw._getState();
   const keyIntent=[4,9,14,19].includes(offset)&&Boolean(value&128)||offset===22&&!(value&128)
    ||offset===10&&!(value&128)||[2,7,17].includes(offset)&&!(value&0xf8);
   send({method:'writeRegister',args:[offset,value],gameboyState:{voiceValue:state.voice[offset],initialized:state.initialized},keyIntent});
  },`)
    .replace(' if(state)raw._adoptState(state);else raw.initialize();\n enabled=true;', ' if(state)raw._adoptState(state);else raw.initialize();\n attachGameboyTimedClient(raw,{},port);\n enabled=true;');
  fail('unknown connection source');
}
function versionTool(before){
  return before.toString('utf8').replace('const revisionFor=name=>sidTimedFiles.has(name)?',
    "const gameboyPublicTimedFiles=new Set(['playground_runtime.js','playground_logic_worker.js','playground_worker_chip.js','playground_performance_sender.js']);\nconst revisionFor=name=>gameboyPublicTimedFiles.has(name)?'gameboy-public-timed-1':sidTimedFiles.has(name)?")
    .replace('const targets=[...new Set([\n','const targets=[...new Set([\n  ...gameboyPublicTimedFiles,\n');
}

export function createGameboyPublicTimedRevisionReadContext(readSource=url=>readFileSync(url)){
  let receipt,verified=false;const previous=new Map(),originals=new Map();
  const read=name=>{if(!originals.has(name))originals.set(name,Buffer.from(readSource(new URL(name,root))));return originals.get(name);};
  function evidence(){
    if(receipt)return receipt;
    const value=JSON.parse(read(GAMEBOY_PUBLIC_TIMED_RECEIPT));
    if(sha(JSON.stringify(value))!==GAMEBOY_PUBLIC_TIMED_PIN||value.schemaVersion!==1||value.scope!=='gameboy-main-worker-timed-api-connection'||value.baseCommit!==GAMEBOY_PUBLIC_TIMED_BASE||!value.sources||!value.dependencies)fail('receipt');
    for(const name of functional)if(!Object.hasOwn(value.sources,name))fail('missing connection source '+name);
    receipt=value;return value;
  }
  function validate(){
    if(verified)return;
    for(const [name,entry]of Object.entries(evidence().sources)){
      if((!functional.has(name)&&!tools.has(name)&&!/^docs\/(?:js|playground)\/[^.][^\0]*\.(?:js|html)$/.test(name))||name.includes('..'))fail('source scope '+name);
      const bytes=read(name);if(!matches(bytes,entry.after))fail(name);
      const before=predecessor(bytes,entry);previous.set(name,before);
      if(functional.has(name)){
        if(entry.kind!=='gameboy-public-timed-connection'||!stripVersions(Buffer.from(connection(name,stripVersions(before)))).equals(stripVersions(bytes)))fail('connection scope '+name);
      }else if(tools.has(name)){
        if(entry.kind!=='public-api-cache-version-tool'||!Buffer.from(versionTool(before)).equals(bytes))fail('version tool scope');
      }else if(entry.kind!=='import-cache-only'||!stripVersions(before).equals(stripVersions(bytes)))fail('non-cache source edit '+name);
    }
    for(const [name,expected]of Object.entries(receipt.dependencies))if(!matches(read(name),expected))fail('dependency '+name);
    verified=true;
  }
  function restore(name,bytes){
    if(typeof name==='string')name=name.startsWith('web/')?'tetorica_src/runtime/'+name.slice(4):/^(?:js|playground)\//.test(name)?'docs/'+name:name;
    if(!Object.hasOwn(evidence().sources,name))return bytes;
    const entry=receipt.sources[name];
    if(!matches(bytes,entry.after))return bytes;
    validate();return previous.get(name);
  }
  return{restore,readSource(url){
    if(!(url instanceof URL)||url.protocol!=='file:')return readSource(url);
    const name=relative(fileURLToPath(root),fileURLToPath(url)).replaceAll('\\','/');
    return restore(name,read(name));
  }};
}
