// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
// Audit only staged/installed bytes. --build rebuilds without a repository SDK.
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const safe=path=>typeof path==='string'&&!path.startsWith('/')&&!path.split('/').includes('..')&&/^[\w./-]+$/.test(path);
export async function checkPs1SourceBundle(stage,{build:rebuild=false}={}){
  const receipt=JSON.parse(await readFile(join(stage,'sources/PS1-SPU.json'),'utf8'));
  assert.equal(receipt.schemaVersion,1);assert.equal(receipt.fixedSdkArtifact,true);
  const {build,sdk}=receipt;
  assert.equal(build.component,'ps1-spu');assert.equal(build.fixedSdkArtifact,true);assert.deepEqual(build.sdk,sdk);
  assert.equal(build.sampleRate,44100);assert.equal(build.voices,24);assert.equal(build.ramBytes,524288);
  assert.deepEqual(JSON.parse(await readFile(join(stage,'generated/ps1_spu_build.json'),'utf8')),build);
  assert.deepEqual(JSON.parse(await readFile(join(stage,'sources/sdk/soundchip-sdk.json'),'utf8')),sdk);
  const manifestBytes=await readFile(join(stage,'sources/sdk/RELEASE-MANIFEST.json'));assert.equal(sha(manifestBytes),sdk.manifestSha256);
  const manifest=JSON.parse(manifestBytes);assert.equal(manifest.name,sdk.name);assert.equal(manifest.version,sdk.version);assert.equal(Object.keys(manifest.files).length+1,sdk.fileCount);
  const sdkMetadata=JSON.parse(await readFile(join(stage,'sources/sdk/sdk.json'),'utf8'));assert.equal(sdkMetadata.name,sdk.name);assert.equal(sdkMetadata.version,sdk.version);
  const vendor=['ps1_spu.cpp','ps1_spu.h','spu.cpp','spu.h','spu_tables.cpp','spureverb.cpp','spureverb.h','standalone_support.h','LICENSE','README.md',
    ...['spu.cpp','spu.h','spu_tables.cpp','spureverb.cpp','spureverb.h','REVISION','SHA256SUMS'].map(name=>'upstream/'+name)];
  const required=vendor.map(name=>'vendor/mame-ps1-spu/'+name).concat('LICENSE','sdk.json','catalog/source_inventory.json','native/include/tetorica/ps1_spu.h','scripts/build_ps1_spu_wasm.sh','scripts/build-wasm.sh','scripts/record_wasm_build.mjs').sort();
  assert.deepEqual(Object.keys(build.inputs).sort(),required,'complete fixed SDK source/build input closure');
  assert.deepEqual(receipt.inputs.map(record=>record.path).sort(),required,'unique bundle SDK input closure');
  for(const record of receipt.inputs){
    assert(safe(record.path)&&safe(record.bundlePath));const expected=manifest.files[record.path],bytes=await readFile(join(stage,'sources',record.bundlePath));
    assert(expected,'SDK input is authenticated by the release manifest');assert.equal(bytes.length,expected.size,record.path);assert.equal(sha(bytes),expected.sha256,record.path);
    assert.deepEqual({bytes:bytes.length,sha256:sha(bytes)},build.inputs[record.path]);assert.equal(record.bytes,bytes.length);assert.equal(record.sha256,sha(bytes));
    assert.equal(record.bundlePath,record.path.startsWith('vendor/mame-ps1-spu/')?'native/ps1/'+record.path.slice('vendor/mame-ps1-spu/'.length):'sdk/'+record.path);
  }
  const sourceFiles=vendor.map(name=>'native/ps1/'+name).concat(required.filter(name=>!name.startsWith('vendor/mame-ps1-spu/')).map(name=>'sdk/'+name),'sdk/RELEASE-MANIFEST.json','sdk/soundchip-sdk.json','scripts/build_ps1_spu_wasm.sh','PS1-SPU.md').sort();
  assert.deepEqual(receipt.files.map(record=>record.path).sort(),sourceFiles,'complete exported file closure');
  for(const record of receipt.files){assert(safe(record.path));const bytes=await readFile(join(stage,'sources',record.path));assert.equal(bytes.length,record.bytes,record.path);assert.equal(sha(bytes),record.sha256,record.path);}
  assert.deepEqual(Object.keys(build.outputs).sort(),['ps1_spu_wasm.js','ps1_spu_wasm.wasm']);
  for(const [name,record]of Object.entries(build.outputs)){const bytes=await readFile(join(stage,'generated',name));assert.equal(bytes.length,record.bytes,name);assert.equal(sha(bytes),record.sha256,name);}
  assert.match(await readFile(join(stage,'sources/sdk/native/include/tetorica/ps1_spu.h'),'utf8'),/#include "\.\.\/\.\.\/\.\.\/vendor\/mame-ps1-spu\/ps1_spu\.h"/);
  assert.deepEqual(await readFile(join(stage,'licenses/mame-ps1-spu/LICENSE')),await readFile(join(stage,'sources/native/ps1/LICENSE')));
  assert.match(await readFile(join(stage,'sources/native/ps1/LICENSE'),'utf8'),/pSXAuthor/);assert.match(await readFile(join(stage,'sources/native/ps1/LICENSE'),'utf8'),/R\. Belmont/);
  const sums=await readFile(join(stage,'sources/native/ps1/upstream/SHA256SUMS'),'utf8'),revision=(await readFile(join(stage,'sources/native/ps1/upstream/REVISION'),'utf8')).trim();
  assert.equal(build.upstream,'MAME '+revision);
  for(const line of sums.trim().split('\n')){const match=/^([a-f0-9]{64})\s+([\w.-]+)$/.exec(line);assert(match,'upstream checksum format');assert.equal(sha(await readFile(join(stage,'sources/native/ps1/upstream',match[2]))),match[1]);}
  const original=await readFile(join(stage,'sources/sdk/scripts/build_ps1_spu_wasm.sh'),'utf8'),recipe=await readFile(join(stage,'sources/scripts/build_ps1_spu_wasm.sh'),'utf8');
  assert.equal(original.split('vendor/mame-ps1-spu').length,6);assert.equal(recipe,original.replaceAll('vendor/mame-ps1-spu','native/ps1'),'only five recipe paths are relocated');
  assert.match(recipe,/EMXX/);assert.match(recipe,/native\/ps1\/spu_tables\.cpp/);assert.doesNotMatch(recipe,/import_soundchip_sdk|third_party\/tetorica-soundchip-native/);
  for(const match of (await readFile(join(stage,'sources/PS1-SPU.md'),'utf8')).matchAll(/\[[^\]]*\]\(([^)]+)\)/g))if(!/^[a-z]+:|^#/.test(match[1]))await readFile(resolve(dirname(join(stage,'sources/PS1-SPU.md')),match[1]));
  let rebuilt=null;
  if(rebuild){
    const output=await mkdtemp(join(tmpdir(),'ps1-sdk-source-rebuild-'));execFileSync('sh',['scripts/build_ps1_spu_wasm.sh',output],{cwd:join(stage,'sources'),stdio:'inherit'});
    for(const name of ['ps1_spu_wasm.js','ps1_spu_wasm.wasm'])assert.deepEqual(await readFile(join(output,name)),await readFile(join(stage,'generated',name)),'standalone rebuilt '+name);
    rebuilt={output,descriptorAndWasmExact:true};
  }
  return {passed:true,sourceInputs:required.length,bundleFiles:sourceFiles.length,fixedSdkArtifact:true,sdkVersion:sdk.version,upstream:build.upstream,rebuilt};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),rebuild=args.includes('--build'),paths=args.filter(arg=>arg!=='--build');
  if(paths.length!==1||paths[0].startsWith('--'))throw new Error('Usage: node scripts/check_ps1_source_bundle.mjs <stage> [--build]');
  console.log(JSON.stringify(await checkPs1SourceBundle(resolve(paths[0]),{build:rebuild})));
}
