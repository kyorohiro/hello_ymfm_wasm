#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Supplemental model modules; never changes the fixed SDK or native receipts.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {copySid8580MachineSources} from './copy_sid8580_machine_sources.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export const SID_MODEL_RUNTIME_MODULES=Object.freeze(['sid8580.js','sid8580.d.ts','sid_waveforms.js']);
const record=bytes=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
const exportsRequired=['create','destroy','reset','run','output','output_frames','write','read','model','rate','cycles_lo','cycles_hi','calibration','cutoff_calibration'].map(n=>'sid8p_'+n);
export async function checkSidModelEndpoint(){
  const base=join(root,'docs/generated/sid8580-machine'),receipt=JSON.parse(await readFile(join(base,'sid8580-machine-build.json')));
  const bytes=await readFile(join(base,'sid8580-endpoint.wasm'));assert.deepEqual(record(bytes),receipt.outputs['sid8580-endpoint.wasm']);
  const module=await WebAssembly.compile(bytes);assert.deepEqual(WebAssembly.Module.imports(module),[]);
  const exports=new Map(WebAssembly.Module.exports(module).map(item=>[item.name,item.kind]));
  for(const name of exportsRequired)assert.equal(exports.get(name),'function',`Missing standalone SID export: ${name}`);
  return receipt;
}
export async function syncSidModelModules({check=false}={}){
  await checkSidModelEndpoint();
  for(const name of SID_MODEL_RUNTIME_MODULES){
    const source=await readFile(join(root,'tetorica_src/runtime',name)),target=join(root,'docs/js',name);
    if(check)assert(source.equals(await readFile(target)),`SID model mirror differs: ${target}`);
    else {await mkdir(dirname(target),{recursive:true});await writeFile(target,source);}
  }
  // sidsynth.js in the readable SID source kit also imports this pure helper.
  // These are browser sources, outside the thirteen compiled native inputs.
  const helper=await readFile(join(root,'tetorica_src/runtime/sid_waveforms.js'));
  const kitTarget=join(root,'docs/sources/sid/tetorica_src/runtime/sid_waveforms.js');
  if(check)assert(helper.equals(await readFile(kitTarget)),'SID source-kit waveform helper differs');
  else {await mkdir(dirname(kitTarget),{recursive:true});await writeFile(kitTarget,helper);}
}
export async function copySidModelSources(stage){
  await syncSidModelModules({check:true});const kit=await copySid8580MachineSources(stage);
  await mkdir(join(stage,'js'),{recursive:true});
  await copyFile(join(root,'docs/js/sid8580.d.ts'),join(stage,'js/sid8580.d.ts'));
  await writeFile(join(stage,'sources/SID8580.md'),`# CPU-free SID 8580 Preview\n\nThe browser chip adapter uses the existing endpoint WASM's sid8p batch API.\nIt does not instantiate the C64 machine or call JavaScript once per chip cycle.\nSee [the readable host module](../js/sid8580.js) and its\n[type declarations](../js/sid8580.d.ts). These remain separate, unminified\nfiles under the application's js/ directory in both distributions.\n\nThe unchanged matching native source kit is [sid8580-machine/README.md](sid8580-machine/README.md).\nIts 99 compiled inputs produce both checked WASMs under generated/sid8580-machine.\nBoth outputs and the receipt are retained for independent rebuilding, although\nthis Synth/Playground adapter loads only sid8580-endpoint.wasm. Profiles stay Off.\nRust/MIT, C64/zlib and Tetorica/BSD licenses and toolchain notices are preserved.\nNo Native binary, user firmware, song or PCM is included.\n`,{flag:'wx'});
  return {...kit,inputPaths:[...new Set([...kit.inputPaths,'scripts/sid_model_artifacts.mjs',...SID_MODEL_RUNTIME_MODULES.map(n=>'tetorica_src/runtime/'+n)])].sort()};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [mode,destination,...extra]=process.argv.slice(2);assert(!extra.length);
  if(mode==='--sync'&&!destination)await syncSidModelModules();
  else if(mode==='--check'&&!destination)await syncSidModelModules({check:true});
  else if(mode==='--copy-sources'&&destination)await copySidModelSources(resolve(destination));
  else throw Error('Usage: sid_model_artifacts.mjs --sync | --check | --copy-sources DIRECTORY');
  console.log('SID standalone model modules and endpoint verified.');
}
