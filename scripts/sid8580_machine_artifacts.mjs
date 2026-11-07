#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Separate research receipt. Never updates a production artifact or catalog.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,lstat,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {probeSourceRecords} from './sid8580_probe_artifacts.mjs';
import {SID_RSID_BUILD_INPUTS} from './sid_rsid_artifacts.mjs';

export const machineRoot=fileURLToPath(new URL('../',import.meta.url));
export const machineDigest=bytes=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
export const MACHINE_OUTPUTS=Object.freeze(['sid8580-endpoint.wasm','sid8580-machine.wasm','sid8580-machine']);
export const MACHINE_SID_IMPORTS=Object.freeze(['sid8e_create','sid8e_destroy','sid8e_reset','sid8e_stop','sid8e_tick','sid8e_set_profiles','sid8e_error']);
export const MACHINE_NEW_INPUTS=Object.freeze([
  'tetorica_src/wasm/sid8580-machine/endpoint.rs',
  'tetorica_src/wasm/sid8580-machine/sid_endpoint.h',
  'tetorica_src/wasm/sid8580-machine/sid_endpoint.cpp',
  'tetorica_src/wasm/sid8580-machine/machine.c',
  'tetorica_src/wasm/sid8580-machine/machine_wasm.cpp',
  'tetorica_src/wasm/sid8580-machine/machine_native.cpp',
  'tetorica_src/wasm/sid8580-machine/generated/sid8580_machine_core.h',
  'tetorica_src/wasm/sid8580-machine/generated/source-manifest.json',
  'scripts/prepare_sid8580_machine_core.mjs','scripts/build_sid8580_machine.sh',
  'scripts/sid8580_machine_artifacts.mjs',
]);
async function regularBytes(root,path){
  assert(typeof path==='string'&&!path.startsWith('/')&&!path.includes('\\')&&!/[\x00-\x1f\x7f]/.test(path));
  const parts=path.split('/');assert(parts.every(p=>p&&p!=='.'&&p!=='..'));
  let at=root;
  for(let i=0;i<parts.length;i++){
    at=join(at,parts[i]);const s=await lstat(at);
    assert(!s.isSymbolicLink()&&(i===parts.length-1?s.isFile():s.isDirectory()),`Not a regular research input: ${path}`);
  }
  return readFile(at);
}
export async function machineSourceRecords(){
  const records=await probeSourceRecords();
  for(const name of [...SID_RSID_BUILD_INPUTS,...MACHINE_NEW_INPUTS])records[name]=machineDigest(await regularBytes(machineRoot,name));
  const manifestBytes=await regularBytes(machineRoot,'third_party/chips-c64/SOURCES.json');
  assert.equal(machineDigest(manifestBytes).sha256,'00489de8a017b799c96c28395c113f2048c7f48c0cfb7ebb4c269993db63ddc8','Pristine C64 manifest changed');
  const manifest=JSON.parse(manifestBytes);
  for(const [name,expected]of Object.entries(manifest.files))assert.deepEqual(records['third_party/chips-c64/upstream/'+name],expected,`Pristine C64 source differs: ${name}`);
  for(const name of ['chips-c64','chips-m6502','chips-m6581'])assert.equal(records[`third_party/${name}/LICENSE`].sha256,manifest.licenseSha256);
  assert.equal(records['third_party/chips-m6502/upstream/m6502.h'].sha256,'b3fc32a01f1f7cdc62f919ccba06cc20c2a333e7ca30c38189e31aa65868d46e');
  assert.equal(records['third_party/chips-m6581/upstream/m6581.h'].sha256,'a793225ee69b91e0ea8c91b221d06ee024e45e6c8179176980abfa95d5a54cdf');
  execFileSync(process.execPath,['scripts/prepare_sid8580_machine_core.mjs','--check'],{cwd:machineRoot,stdio:'pipe'});
  return Object.fromEntries(Object.entries(records).sort(([a],[b])=>a.localeCompare(b)));
}
export async function machineWasmInterface(directory){
  const sid=await WebAssembly.compile(await regularBytes(directory,'sid8580-endpoint.wasm'));
  const machine=await WebAssembly.compile(await regularBytes(directory,'sid8580-machine.wasm'));
  const endpointImports=WebAssembly.Module.imports(sid),machineImports=WebAssembly.Module.imports(machine);
  assert.deepEqual(endpointImports,[],'Research SID must not import per-cycle host callbacks');
  const exported=new Map(WebAssembly.Module.exports(sid).map(x=>[x.name,x.kind]));
  for(const name of MACHINE_SID_IMPORTS)assert.equal(exported.get(name),'function',`Missing direct SID export: ${name}`);
  const runtime=new Set(['env.emscripten_notify_memory_growth','wasi_snapshot_preview1.fd_close','wasi_snapshot_preview1.fd_seek','wasi_snapshot_preview1.fd_write','wasi_snapshot_preview1.proc_exit']);
  const direct=[];
  for(const value of machineImports){
    assert.equal(value.kind,'function','Research machine may only import functions');
    if(value.module==='env'&&MACHINE_SID_IMPORTS.includes(value.name))direct.push(value.name);
    else assert(runtime.has(value.module+'.'+value.name),`Unexpected research machine import: ${value.module}.${value.name}`);
  }
  assert.deepEqual(direct.sort(),[...MACHINE_SID_IMPORTS].sort(),'Direct cross-WASM SID import contract differs');
  return {endpointImports,machineImports,directSidImports:MACHINE_SID_IMPORTS,perCycleJavaScriptCallbacks:false,separateLinearMemories:true};
}
const version=command=>execFileSync(command,['--version'],{encoding:'utf8'}).trim();
async function machineReceipt(directory){
  directory=resolve(directory);
  const inputs=await machineSourceRecords(),outputs={};
  for(const name of MACHINE_OUTPUTS)outputs[name]=machineDigest(await regularBytes(directory,name));
  const receipt={format:'tetorica-sid8580-research-machine-build',version:1,production:false,fixedSdkArtifact:false,
    clockHz:985248,model:'8580',models:['8580'],profileDefaults:{resonance:false,cutoff:false},
    machine:'pinned chips C64 CPU/CIA/VIC; independent minimal host or user ROMs',
    sourcePolicy:'pristine C64 and old host unchanged; marked generated research host',
    outputChain:'candidate SID sample followed by existing 12Hz software DC blocker',
    buildProfile:{rust:{edition:'2021',optimization:3,panic:'abort',codegenUnits:1,wasmTarget:'wasm32-unknown-unknown',remappedSourceRoot:'tetorica'},
      c:{standard:'c11',optimization:2,ndebug:true,floatingPointContraction:false,remappedSourceRoot:'tetorica'},
      cxx:{standard:'c++17',optimization:2,ndebug:true,floatingPointContraction:false,remappedSourceRoot:'tetorica'},
      nativeLinkFlags:process.platform==='darwin'?['-liconv','-Wl,-S']:['-ldl','-lpthread','-lm','-lrt','-lutil'],
      machineWasm:{standalone:true,memoryGrowth:true,initialMemory:4194304,maximumMemory:67108864,stackSize:65536,errorOnUndefinedSymbols:false,noEntry:true}},
    compilers:{rust:execFileSync(process.env.RUSTC||'rustc',['--version','--verbose'],{encoding:'utf8'}).trim(),
      nativeC:version(process.env.CC||'clang'),nativeCxx:version(process.env.CXX||'clang++'),wasmC:version(process.env.EMCC||'emcc'),wasmCxx:version(process.env.EMXX||'em++')},
    inputs,outputs,wasmInterface:await machineWasmInterface(directory)};
  return receipt;
}
export async function recordSid8580MachineBuild(directory){
  directory=resolve(directory);const receipt=await machineReceipt(directory);
  await writeFile(join(directory,'sid8580-machine-build.json'),JSON.stringify(receipt,null,2)+'\n');return receipt;
}
export async function checkSid8580MachineBuild({directory=join(machineRoot,'build/sid8580-machine')}={}){
  directory=resolve(directory);const receipt=JSON.parse(await regularBytes(directory,'sid8580-machine-build.json'));
  assert.deepEqual(receipt,await machineReceipt(directory),'Stale research source/output/toolchain/interface receipt');return receipt;
}
export async function stageSid8580Machine(directory=join(machineRoot,'build/sid8580-machine')){
  directory=resolve(directory);const receipt=await checkSid8580MachineBuild({directory});
  let target=machineRoot;
  for(const part of ['docs','generated','sid8580-machine']){
    target=join(target,part);
    try{const s=await lstat(target);assert(s.isDirectory()&&!s.isSymbolicLink(),'Research stage directory must not be a symlink');}
    catch(error){if(error.code!=='ENOENT')throw error;await mkdir(target);}
  }
  for(const name of ['sid8580-endpoint.wasm','sid8580-machine.wasm','sid8580-machine-build.json']){
    try{const s=await lstat(join(target,name));assert(s.isFile()&&!s.isSymbolicLink(),'Research stage target must be a regular file');}
    catch(error){if(error.code!=='ENOENT')throw error;}
    await copyFile(join(directory,name),join(target,name));
  }
  return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [mode,path,...extra]=process.argv.slice(2);assert(!extra.length);
  const directory=resolve(path||join(machineRoot,'build/sid8580-machine'));
  if(mode==='--record')await recordSid8580MachineBuild(directory);
  else if(mode==='--check')await checkSid8580MachineBuild({directory});
  else if(mode==='--stage')await stageSid8580Machine(directory);
  else throw Error('Usage: sid8580_machine_artifacts.mjs <--record|--check|--stage> [DIRECTORY]');
  console.log('SID8580 research machine '+mode.slice(2)+' passed');
}
