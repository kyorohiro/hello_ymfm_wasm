// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
// Export an authenticated, self-contained subset of the fixed SDK snapshot.
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function files(directory,prefix=''){
  const result=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const name=prefix+entry.name;
    if(entry.isDirectory())result.push(...await files(join(directory,entry.name),name+'/'));
    else if(entry.isFile())result.push(name);
    else throw new Error('Unsupported PS1 SDK source entry: '+name);
  }
  return result.sort();
}
function verify(bytes,record,label,size='bytes'){
  if(!record||bytes.length!==record[size]||sha(bytes)!==record.sha256)throw new Error('PS1 SPU source/build receipt mismatch: '+label);
}
export async function copyPs1Sources(stage){
  const sdk=join(root,'third_party/tetorica-soundchip-native'),pinBytes=await readFile(join(root,'third_party/soundchip-sdk.json')),pin=JSON.parse(pinBytes),manifestBytes=await readFile(join(sdk,'RELEASE-MANIFEST.json'));
  if(sha(manifestBytes)!==pin.manifestSha256)throw new Error('PS1 SDK manifest hash mismatch');
  const manifest=JSON.parse(manifestBytes),receiptBytes=await readFile(join(root,'docs/generated/ps1_spu_build.json')),build=JSON.parse(receiptBytes);
  if(build.schemaVersion!==1||build.component!=='ps1-spu'||build.fixedSdkArtifact!==true||!isDeepStrictEqual(build.sdk,pin))throw new Error('Expected a PS1 SPU build from the current fixed SDK');
  const component='vendor/mame-ps1-spu',names=[...(await files(join(sdk,component))).map(name=>component+'/'+name),
    'LICENSE','sdk.json','catalog/source_inventory.json','native/include/tetorica/ps1_spu.h','scripts/build_ps1_spu_wasm.sh','scripts/build-wasm.sh','scripts/record_wasm_build.mjs'].sort();
  if(JSON.stringify(Object.keys(build.inputs).sort())!==JSON.stringify(names))throw new Error('Incomplete PS1 SDK source/build input closure');
  const payload=new Map(),inputs=[];
  for(const path of names){
    const bytes=await readFile(join(sdk,path));verify(bytes,manifest.files[path],path,'size');verify(bytes,build.inputs[path],path);
    const bundlePath=path.startsWith(component+'/')?'native/ps1/'+path.slice(component.length+1):'sdk/'+path;
    payload.set('sources/'+bundlePath,bytes);inputs.push({path,bundlePath,bytes:bytes.length,sha256:sha(bytes)});
  }
  const recipePath='sdk/scripts/build_ps1_spu_wasm.sh',original=payload.get('sources/'+recipePath).toString('utf8');
  if(original.split(component).length!==6)throw new Error('Unexpected SDK PS1 standalone recipe paths');
  const recipe=original.replaceAll(component,'native/ps1');
  payload.set('sources/scripts/build_ps1_spu_wasm.sh',Buffer.from(recipe));
  payload.set('sources/sdk/RELEASE-MANIFEST.json',manifestBytes);payload.set('sources/sdk/soundchip-sdk.json',pinBytes);
  for(const name of ['ps1_spu_wasm.js','ps1_spu_wasm.wasm']){
    const bytes=await readFile(join(root,'docs/generated',name));verify(bytes,build.outputs[name],name);payload.set('generated/'+name,bytes);
  }
  payload.set('generated/ps1_spu_build.json',receiptBytes);
  payload.set('licenses/mame-ps1-spu/LICENSE',payload.get('sources/native/ps1/LICENSE'));
  payload.set('licenses/mame-ps1-spu/README.md',Buffer.from(`# PlayStation SPU attribution\n\nBSD-3-Clause MAME PlayStation SPU by pSXAuthor and R. Belmont, with the Tetorica standalone adaptation. See [LICENSE](LICENSE) and the complete [source and adaptation notes](../../sources/native/ps1/README.md). Pristine upstream files, revision and hashes are included under sources/native/ps1/upstream/. These sources come from the pinned tetorica-soundchip-native SDK.\n`));
  payload.set('sources/PS1-SPU.md',Buffer.from(`# PlayStation SPU source and rebuilding

The complete BSD-3-Clause standalone C++17 SPU, C API, pristine upstream MAME sources, revision, checksums, attribution and documented changes are included in [native/ps1/](native/ps1/README.md). The source is taken from fixed tetorica-soundchip-native SDK ${pin.version}. [PS1-SPU.json](PS1-SPU.json) retains the complete SDK pin, including whether it represents an unpublished local candidate, and hashes every distributed input. [sdk/RELEASE-MANIFEST.json](sdk/RELEASE-MANIFEST.json) is the genuine release manifest authenticated by that pin.

From this sources directory, run:

\`sh scripts/build_ps1_spu_wasm.sh ../generated\`

Emscripten is required. This self-contained recipe builds ps1_spu_wasm.js and ps1_spu_wasm.wasm without an SDK checkout, importer, network, MAME framework, CPU, BIOS, ROM or game recording. Only its five vendor/mame-ps1-spu paths are relocated to native/ps1. Compiler flags and exports are unchanged. The exact original recipe is retained in [sdk/scripts/build_ps1_spu_wasm.sh](sdk/scripts/build_ps1_spu_wasm.sh). The distributed generated/ps1_spu_build.json records the original SDK build; the standalone recipe does not rewrite that provenance record.

Native hosts compile ps1_spu.cpp, spu.cpp, spu_tables.cpp and spureverb.cpp under native/ps1, and include ps1_spu.h. The SDK forwarding header is retained unchanged in sdk/native/include/tetorica/ps1_spu.h for provenance; its original relative include expects the full SDK layout. Standalone consumers use native/ps1/ps1_spu.h directly. The C API renders 44,100 Hz into caller-owned stereo PCM, with 24 fixed voices and 512 KiB RAM. Samples use 16-byte / 28-frame PSX ADPCM packets. Tuning, voice allocation, output resampling and device output belong to the host.

Upstream interpolation, ADSR and reverb approximations are retained. This instrument API does not implement a PlayStation CPU, BIOS, PSF playback, XA/CD streaming or hardware-exact timing. The JavaScript Ps1Spu helper takes an explicit generated module factory and does not open an audio device.
`));
  const bundleFiles=[...payload].filter(([path])=>path.startsWith('sources/')).map(([path,bytes])=>({path:path.slice(8),bytes:bytes.length,sha256:sha(bytes)}));
  payload.set('sources/PS1-SPU.json',Buffer.from(JSON.stringify({schemaVersion:1,origin:'Pinned tetorica-soundchip-native PlayStation SPU',fixedSdkArtifact:true,sdk:pin,build,inputs,files:bundleFiles,
    modifications:['Only the five standalone recipe vendor/mame-ps1-spu paths are relocated to native/ps1. Core, forwarding header, upstream, licenses and the retained original SDK recipe are byte-exact. Distribution guide, notice summary and this bundle receipt are generated.']},null,2)+'\n'));
  // Verify every source and generated output before writing any payload.
  for(const [name,bytes]of payload){const target=join(stage,name);await mkdir(join(target,'..'),{recursive:true});await writeFile(target,bytes);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2])throw new Error('Usage: node scripts/copy_ps1_sources.mjs <stage>');
  await copyPs1Sources(resolve(process.argv[2]));
}
