#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Application-local bounded PSID player; no fixed SDK/catalog/old SID changes.
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
const root=fileURLToPath(new URL('../',import.meta.url));
const canonical=join(root,'tetorica_src/runtime/generated/sid-player');
const digest=bytes=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
export const SID_PLAYER_BUILD_INPUTS=Object.freeze([
  'LICENSE','third_party/chips-m6502/LICENSE','third_party/chips-m6502/README.md',
  'third_party/chips-m6502/upstream/m6502.h','third_party/chips-m6581/LICENSE',
  'third_party/chips-m6581/README.md','third_party/chips-m6581/PATCHES.md',
  'third_party/chips-m6581/upstream/m6581.h','third_party/chips-m6581/m6581.h',
  'tetorica_src/wasm/sid_player_core.h','tetorica_src/wasm/sid_player_wasm.cpp',
  'scripts/build_sid_player_wasm.sh','scripts/sid_player_artifacts.mjs','scripts/prepare_sid_core.py'
]);
const upstream={revision:'9e88298ce56319953ac7a43213a1120359f7a3a6',
  cpuHeaderSha256:'b3fc32a01f1f7cdc62f919ccba06cc20c2a333e7ca30c38189e31aa65868d46e',
  sidHeaderSha256:'a793225ee69b91e0ea8c91b221d06ee024e45e6c8179176980abfa95d5a54cdf',
  licenseSha256:'0c692ece632a8ec6d2a566c9234fdabda655644e6abc70027da9ff7c35e48634'};
async function inputs(repositoryRoot=root){
  const files=Object.fromEntries(await Promise.all(SID_PLAYER_BUILD_INPUTS.map(async path=>[path,digest(await readFile(join(repositoryRoot,path)))])));
  if(files['third_party/chips-m6502/upstream/m6502.h'].sha256!==upstream.cpuHeaderSha256
    ||files['third_party/chips-m6581/upstream/m6581.h'].sha256!==upstream.sidHeaderSha256
    ||files['third_party/chips-m6502/LICENSE'].sha256!==upstream.licenseSha256
    ||files['third_party/chips-m6581/LICENSE'].sha256!==upstream.licenseSha256)throw new Error('PSID player pristine upstream differs');
  return files;
}
function metadata(files,wasm){return{schemaVersion:1,component:'sid-player',fixedSdkArtifact:false,
  model:'6581',clockHz:985248,frameCycles:19656,initCycleLimit:100000,playCycleLimit:16000,
  cpu:'chips/m6502',environment:'bounded-psid-init-play-no-rom-cia-vic-irq',upstream,inputs:files,output:digest(wasm)};}
export async function recordSidPlayerBuild(directory){
  const wasm=await readFile(join(directory,'sid-player.wasm'));await WebAssembly.compile(wasm);
  const receipt=metadata(await inputs(),wasm);
  await writeFile(join(directory,'sid-player-build.json'),JSON.stringify(receipt,null,2)+'\n');return receipt;
}
export async function checkSidPlayerBuild({root:repositoryRoot=root,directory=join(repositoryRoot,'tetorica_src/runtime/generated/sid-player')}={}){
  const receipt=JSON.parse(await readFile(join(directory,'sid-player-build.json'),'utf8'));
  const expected=metadata(await inputs(repositoryRoot),await readFile(join(directory,'sid-player.wasm')));
  if(!isDeepStrictEqual(receipt,expected))throw new Error('PSID player source/WASM receipt differs; run sh scripts/build_sid_player_wasm.sh');
  return receipt;
}
const sourceReadme='# Bounded browser PSID source kit\n\nBSD-3-Clause host with pinned zlib chips/m6502 and chips/m6581 components.\nNo C64 ROMs, GPL playback engine or game music are included. This is a direct\ninit/play subroutine host, not a complete C64 emulator. Read the component\nREADME for CPU, memory, timing and execution-limit details.\n\nWith Node.js, Python 3 and Emscripten, from this source directory:\n\n```sh\nsh scripts/build_sid_player_wasm.sh /tmp/tetorica-sid-player-rebuild\n```\n\nThe separate WASM/receipt does not change the existing SID Synth or fixed SDK.\n';
export async function syncSidPlayerArtifacts({check=false}={}){
  await checkSidPlayerBuild();
  const copies=[...['sid-player.wasm','sid-player-build.json'].map(name=>[
    `tetorica_src/runtime/generated/sid-player/${name}`,`docs/generated/sid-player/${name}`]),
    ...SID_PLAYER_BUILD_INPUTS.map(path=>[path,`docs/sources/sid-player/${path}`])];
  for(const[source,target]of copies){
    const bytes=await readFile(join(root,source));
    if(check){if(!bytes.equals(await readFile(join(root,target))))throw new Error(`PSID player public copy differs: ${target}`);}
    else{await mkdir(dirname(join(root,target)),{recursive:true});await copyFile(join(root,source),join(root,target));}
  }
  const target=join(root,'docs/sources/sid-player/README.md');
  if(check){if(await readFile(target,'utf8')!==sourceReadme)throw new Error('PSID player source guide differs');}
  else await writeFile(target,sourceReadme);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const[action,directory]=process.argv.slice(2);
  if(action==='--record'&&directory)await recordSidPlayerBuild(resolve(directory));
  else if(action==='--sync'&&!directory)await syncSidPlayerArtifacts();
  else if(action==='--check'&&!directory)await syncSidPlayerArtifacts({check:true});
  else throw new Error('Usage: sid_player_artifacts.mjs <--record DIRECTORY|--sync|--check>');
  process.stdout.write('Bounded PSID player artifacts verified.\n');
}
