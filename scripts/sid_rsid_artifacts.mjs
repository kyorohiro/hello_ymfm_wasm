#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
const root=fileURLToPath(new URL('../',import.meta.url));
const canonical=join(root,'tetorica_src/runtime/generated/sid-rsid');
const digest=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
const sourcePin='00489de8a017b799c96c28395c113f2048c7f48c0cfb7ebb4c269993db63ddc8';
const headers=['chips/chips_common.h','chips/clk.h','chips/kbd.h','chips/m6522.h','chips/m6526.h','chips/m6569.h','chips/mem.h',
  'systems/c1530.h','systems/c1541.h','systems/c64.h'];
export const SID_RSID_BUILD_INPUTS=Object.freeze(['LICENSE','third_party/chips-c64/LICENSE','third_party/chips-c64/README.md',
  'third_party/chips-c64/SOURCES.json',...headers.map(p=>'third_party/chips-c64/upstream/'+p),
  'third_party/chips-m6502/LICENSE','third_party/chips-m6502/README.md','third_party/chips-m6502/upstream/m6502.h',
  'third_party/chips-m6581/LICENSE','third_party/chips-m6581/README.md','third_party/chips-m6581/PATCHES.md',
  'third_party/chips-m6581/upstream/m6581.h','third_party/chips-m6581/m6581.h',
  'tetorica_src/wasm/sid_rsid_core.h','tetorica_src/wasm/sid_rsid_wasm.cpp',
  'tetorica_src/wasm/sid_rsid_machine.c','tetorica_src/wasm/sid_rsid_chip.cpp',
  'scripts/build_sid_rsid_wasm.sh','scripts/sid_rsid_artifacts.mjs','scripts/prepare_sid_core.py']);
async function inputs(repositoryRoot=root){
  const files=Object.fromEntries(await Promise.all(SID_RSID_BUILD_INPUTS.map(async p=>[p,digest(await readFile(join(repositoryRoot,p)))])));
  if(files['third_party/chips-c64/SOURCES.json'].sha256!==sourcePin)throw new Error('Pinned C64 source manifest differs');
  const original=JSON.parse(await readFile(join(repositoryRoot,'third_party/chips-c64/SOURCES.json'),'utf8'));
  for(const[path,record]of Object.entries(original.files))if(!isDeepStrictEqual(record,files['third_party/chips-c64/upstream/'+path]))throw new Error('Pristine C64 source differs: '+path);
  for(const path of['third_party/chips-c64/LICENSE','third_party/chips-m6502/LICENSE','third_party/chips-m6581/LICENSE'])
    if(files[path].sha256!==original.licenseSha256)throw new Error('Pinned chip license differs');
  if(files['third_party/chips-m6502/upstream/m6502.h'].sha256!=='b3fc32a01f1f7cdc62f919ccba06cc20c2a333e7ca30c38189e31aa65868d46e'
    ||files['third_party/chips-m6581/upstream/m6581.h'].sha256!=='a793225ee69b91e0ea8c91b221d06ee024e45e6c8179176980abfa95d5a54cdf')throw new Error('Pristine CPU/SID source differs');
  return files;
}
function metadata(files,bytes){return{schemaVersion:1,component:'sid-rsid',fixedSdkArtifact:false,clockHz:985248,model:'6581',
  hardware:'pinned chips/c64 (CPU, two CIAs, VIC, SID)',environment:'continuous-machine-minimal-original-shim-or-user-roms',
  initPolicy:'100000-cycle preflight; nonreturning init allowed',bootCycleLimit:2000000,
  upstreamRevision:'9e88298ce56319953ac7a43213a1120359f7a3a6',pristineSourcesSha256:sourcePin,
  build:{machineLanguage:'C11',sidAndHostLanguage:'C++17',optimization:'-O2',floatingPointContraction:false},inputs:files,output:digest(bytes)};}
export async function recordSidRsidBuild(directory){
  const bytes=await readFile(join(directory,'sid-rsid.wasm'));await WebAssembly.compile(bytes);
  const receipt=metadata(await inputs(),bytes);await writeFile(join(directory,'sid-rsid-build.json'),JSON.stringify(receipt,null,2)+'\n');return receipt;
}
export async function checkSidRsidBuild({root:repositoryRoot=root,directory=join(repositoryRoot,'tetorica_src/runtime/generated/sid-rsid')}={}){
  const receipt=JSON.parse(await readFile(join(directory,'sid-rsid-build.json'),'utf8'));
  if(!isDeepStrictEqual(receipt,metadata(await inputs(repositoryRoot),await readFile(join(directory,'sid-rsid.wasm')))))throw new Error('RSID source/WASM receipt differs; rebuild with sh scripts/build_sid_rsid_wasm.sh');
  return receipt;
}
const guide='# RSID machine source kit\n\nBSD-3-Clause host and independently authored minimal boot/IRQ/NMI shim, with\npinned zlib chips C64/CPU/CIA/VIC/SID components. No original C64 ROM, game\nfile, or GPL player/stub is included. See third_party/chips-c64/README.md.\n\nWith Node.js, Python 3 and Emscripten, from this directory:\n\n```sh\nsh scripts/build_sid_rsid_wasm.sh /tmp/tetorica-rsid-rebuild\n```\n\nThe unmodified machine headers compile as C11; existing SID and host compile\nas C++17. This separate WASM does not change the PSID/Synth backend or SDK.\n';
export async function syncSidRsidArtifacts({check=false}={}){
  await checkSidRsidBuild();
  const pairs=[...['sid-rsid.wasm','sid-rsid-build.json'].map(name=>[
    `tetorica_src/runtime/generated/sid-rsid/${name}`,`docs/generated/sid-rsid/${name}`]),
    ...SID_RSID_BUILD_INPUTS.map(path=>[path,`docs/sources/sid-rsid/${path}`])];
  for(const[source,target]of pairs){
    const bytes=await readFile(join(root,source));
    if(check){if(!bytes.equals(await readFile(join(root,target))))throw new Error('RSID public source differs: '+target);}
    else{await mkdir(dirname(join(root,target)),{recursive:true});await copyFile(join(root,source),join(root,target));}
  }
  const path=join(root,'docs/sources/sid-rsid/README.md');
  if(check){if(await readFile(path,'utf8')!==guide)throw new Error('RSID source guide differs');}
  else await writeFile(path,guide);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const[action,directory]=process.argv.slice(2);
  if(action==='--record'&&directory)await recordSidRsidBuild(resolve(directory));
  else if(action==='--sync'&&!directory)await syncSidRsidArtifacts();
  else if(action==='--check'&&!directory)await syncSidRsidArtifacts({check:true});
  else throw new Error('Usage: sid_rsid_artifacts.mjs <--record DIRECTORY|--sync|--check>');
  process.stdout.write('RSID machine artifacts verified.\n');
}
