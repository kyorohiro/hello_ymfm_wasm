// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
// This experimental source bundle comes from local native/ps1, not the fixed SDK.
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function files(directory,prefix='') {
  const result=[];
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const name=prefix+entry.name;
    if(entry.isDirectory())result.push(...await files(join(directory,entry.name),name+'/'));
    else if(entry.isFile())result.push(name);
    else throw new Error('Unsupported PS1 source entry: '+name);
  }
  return result.sort();
}
function verify(bytes,record,label) {
  if(!record||bytes.length!==record.bytes||sha(bytes)!==record.sha256)throw new Error('PS1 SPU build receipt mismatch: '+label);
}

export async function copyPs1Sources(stage) {
  const receiptBytes=await readFile(join(root,'docs/generated/ps1_spu_build.json'));
  const build=JSON.parse(receiptBytes);
  if(build.schemaVersion!==1||build.component!=='experimental-ps1-spu'||build.fixedSdkArtifact!==false)
    throw new Error('Expected an experimental local PS1 SPU build receipt, not a fixed SDK artifact');
  const nativeFiles=await files(join(root,'native/ps1'));
  const names=[...nativeFiles.map(path=>'native/ps1/'+path),'scripts/build_ps1_spu_wasm.sh'].sort();
  if(JSON.stringify(Object.keys(build.inputs).sort())!==JSON.stringify(names))throw new Error('Incomplete PS1 SPU source/build input closure');
  const payload=new Map();
  for(const path of names) {
    const bytes=await readFile(join(root,path));verify(bytes,build.inputs[path],path);
    payload.set('sources/'+path,bytes);
  }
  for(const name of ['ps1_spu_wasm.js','ps1_spu_wasm.wasm']) {
    const bytes=await readFile(join(root,'docs/generated',name));verify(bytes,build.outputs[name],name);
    payload.set('generated/'+name,bytes);
  }
  payload.set('generated/ps1_spu_build.json',receiptBytes);
  payload.set('licenses/mame-ps1-spu/LICENSE',payload.get('sources/native/ps1/LICENSE'));
  payload.set('licenses/mame-ps1-spu/README.md',Buffer.from(`# PlayStation SPU attribution\n\nBSD-3-Clause MAME PlayStation SPU by pSXAuthor and R. Belmont, with the Tetorica standalone adaptation. See [LICENSE](LICENSE) and the complete [source and adaptation notes](../../sources/native/ps1/README.md). Pristine upstream files, revision and hashes are included under sources/native/ps1/upstream/. This experimental port is not part of the fixed sound-chip SDK.\n`));
  payload.set('sources/PS1-SPU.md',Buffer.from(`# Experimental PlayStation SPU source and rebuilding\n\nThe complete BSD-3-Clause standalone C++17 core, C API, original MAME source files, revision, hashes, attribution and documented changes are included in [native/ps1/](native/ps1/README.md). This local experimental instrument port is **not** a fixed tetorica-soundchip-native SDK artifact. It is not a generic createSoundChip() name or a Playground mode.\n\nFrom this sources directory, run:\n\n\`sh scripts/build_ps1_spu_wasm.sh ../generated\`\n\nEmscripten and Python 3 are required. No SDK checkout, importer, network, MAME framework, CPU, BIOS, ROM or game recording is required. The unchanged recipe produces ps1_spu_wasm.js, ps1_spu_wasm.wasm and its source/build receipt. Native hosts compile ps1_spu.cpp, spu.cpp, spu_tables.cpp and spureverb.cpp under native/ps1, and include ps1_spu.h.\n\nThe ES-module helper Ps1Spu requires an explicit generated module factory. It renders at 44,100 Hz into caller-owned stereo PCM, with 24 voices and 512 KiB RAM. Sample uploads expect already encoded 16-byte / 28-frame PSX ADPCM packets. Instrument tuning, voice allocation and audio-device output belong to the host. Upstream interpolation, ADSR and reverb approximations are retained; this is not a hardware-exact timing or soundtrack-compatibility claim.\n\n[PS1-SPU.json](PS1-SPU.json) preserves the exact local source/build receipt; generated/ps1_spu_build.json is also included beside the generated pair. Every core, upstream, notice and recipe byte is unchanged from the verified build inputs.\n`));
  payload.set('sources/PS1-SPU.json',Buffer.from(JSON.stringify({schemaVersion:1,
    origin:'Experimental local PlayStation SPU standalone port',fixedSdkArtifact:false,build,
    modifications:['No source, recipe, upstream or license bytes were modified. Only the distribution guide, notice summary and this receipt were generated.']},null,2)+'\n'));
  // No distribution file is written until every source and binary is verified.
  for(const [name,bytes] of payload) {
    const target=join(stage,name);await mkdir(join(target,'..'),{recursive:true});await writeFile(target,bytes);
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv[2])throw new Error('Usage: node scripts/copy_ps1_sources.mjs <stage>');
  await copyPs1Sources(resolve(process.argv[2]));
}
