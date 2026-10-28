// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
// Audit only the staged/installed payload: no repository source fallback.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const safe=path=>typeof path==='string'&&!path.startsWith('/')&&!path.split('/').includes('..')&&/^[\w./-]+$/.test(path);

export async function checkPs1SourceBundle(stage) {
  const receipt=JSON.parse(await readFile(join(stage,'sources/PS1-SPU.json'),'utf8'));
  assert.equal(receipt.schemaVersion,1);assert.equal(receipt.fixedSdkArtifact,false);
  const build=receipt.build;
  assert.equal(build.component,'experimental-ps1-spu');assert.equal(build.fixedSdkArtifact,false);
  assert.equal(build.sampleRate,44100);assert.equal(build.voices,24);assert.equal(build.ramBytes,524288);
  assert.deepEqual(JSON.parse(await readFile(join(stage,'generated/ps1_spu_build.json'),'utf8')),build);
  const required=['ps1_spu.cpp','ps1_spu.h','spu.cpp','spu.h','spu_tables.cpp','spureverb.cpp','spureverb.h','standalone_support.h','LICENSE','README.md',
    ...['spu.cpp','spu.h','spu_tables.cpp','spureverb.cpp','spureverb.h','REVISION','SHA256SUMS'].map(name=>'upstream/'+name)]
    .map(name=>'native/ps1/'+name).concat('scripts/build_ps1_spu_wasm.sh').sort();
  assert.deepEqual(Object.keys(build.inputs).sort(),required,'complete experimental core/upstream/recipe closure');
  for(const [path,record] of Object.entries(build.inputs)) {
    assert.ok(safe(path));const bytes=await readFile(join(stage,'sources',path));
    assert.equal(bytes.length,record.bytes,path);assert.equal(sha(bytes),record.sha256,path);
  }
  assert.deepEqual(Object.keys(build.outputs).sort(),['ps1_spu_wasm.js','ps1_spu_wasm.wasm']);
  for(const [name,record] of Object.entries(build.outputs)) {
    const bytes=await readFile(join(stage,'generated',name));assert.equal(bytes.length,record.bytes,name);assert.equal(sha(bytes),record.sha256,name);
  }
  assert.deepEqual(await readFile(join(stage,'licenses/mame-ps1-spu/LICENSE')),await readFile(join(stage,'sources/native/ps1/LICENSE')));
  assert.match(await readFile(join(stage,'sources/native/ps1/LICENSE'),'utf8'),/pSXAuthor/);
  assert.match(await readFile(join(stage,'sources/native/ps1/LICENSE'),'utf8'),/R\. Belmont/);
  const sums=await readFile(join(stage,'sources/native/ps1/upstream/SHA256SUMS'),'utf8');
  const revision=(await readFile(join(stage,'sources/native/ps1/upstream/REVISION'),'utf8')).trim();
  assert.equal(build.upstream,'MAME '+revision,'build receipt retains the pristine upstream revision');
  for(const line of sums.trim().split('\n')) {
    const match=/^([a-f0-9]{64})\s+([\w.-]+)$/.exec(line);assert.ok(match,'upstream checksum format');
    assert.equal(sha(await readFile(join(stage,'sources/native/ps1/upstream',match[2]))),match[1]);
  }
  const recipe=await readFile(join(stage,'sources/scripts/build_ps1_spu_wasm.sh'),'utf8');
  assert.match(recipe,/EMXX/);assert.match(recipe,/native\/ps1\/spu_tables\.cpp/);assert.doesNotMatch(recipe,/third_party\/tetorica-soundchip-native/);
  assert.match(await readFile(join(stage,'sources/PS1-SPU.md'),'utf8'),/not.*fixed/i);
  return {passed:true,sourceInputs:required.length,fixedSdkArtifact:false,upstream:build.upstream};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv[2])throw new Error('Usage: node scripts/check_ps1_source_bundle.mjs <stage>');
  console.log(JSON.stringify(await checkPs1SourceBundle(resolve(process.argv[2]))));
}
