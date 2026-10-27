// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
// Audit the distributed sources; --build also rebuilds them without the SDK.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {copyCddaSources} from './copy_cdda_sources.mjs';
import {copyMsm5205Sources} from './copy_msm5205_sources.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const safePath=value=>typeof value==='string'&&!isAbsolute(value)&&!value.split(/[\\/]/).includes('..');

export async function checkApplicationAudioSourceBundles(stage,{build=false}={}){
  const sdk=join(root,'third_party/tetorica-soundchip-native');
  const pin=JSON.parse(await readFile(join(root,'third_party/soundchip-sdk.json'),'utf8'));
  const manifestBytes=await readFile(join(sdk,'RELEASE-MANIFEST.json'));
  assert.equal(sha(manifestBytes),pin.manifestSha256,'Fixed SDK manifest');
  const manifest=JSON.parse(manifestBytes),results=[];
  const scratch=build?await mkdtemp(join(tmpdir(),'application-audio-source-rebuild-')):null;
  for(const [id,label]of [['cdda','CDDA'],['msm5205','MSM5205']]){
    const receipt=JSON.parse(await readFile(join(stage,'sources',label+'.json'),'utf8'));
    assert.equal(receipt.schemaVersion,1);
    assert.deepEqual(receipt.sdk,pin,id+': distributed SDK identity');
    const requiredInputs=[`vendor/tetorica-${id}/${id}_pcm.c`,`vendor/tetorica-${id}/${id}_pcm.h`,
      `vendor/tetorica-${id}/LICENSE`,`vendor/tetorica-${id}/NOTICE.md`,
      `wasm/${id}_wasm.c`,`scripts/build_${id}_wasm.sh`];
    assert.equal(receipt.inputs.length,requiredInputs.length,id+': complete unique SDK input closure');
    assert.deepEqual(receipt.inputs.map(file=>file.path).sort(),requiredInputs.sort(),id+': required SDK inputs');
    for(const record of receipt.inputs){
      assert(safePath(record.path));
      const expected=manifest.files[record.path],bytes=await readFile(join(sdk,record.path));
      assert(expected,id+': source in release manifest');
      assert.equal(record.size,expected.size);assert.equal(record.sha256,expected.sha256);
      assert.equal(bytes.length,record.size);assert.equal(sha(bytes),record.sha256);
    }
    const expectedFiles=[`${id}_pcm.c`,`${id}_pcm.h`,`${id}_wasm.c`,'LICENSE','NOTICE.md','README.md']
      .map(file=>`native/${id}/${file}`).concat(`scripts/build_${id}_wasm.sh`,label+'.md').sort();
    assert.deepEqual(receipt.files.map(file=>file.path).sort(),expectedFiles,id+': bundled file closure');
    for(const record of receipt.files){
      assert(safePath(record.path));const bytes=await readFile(join(stage,'sources',record.path));
      assert.equal(bytes.length,record.bytes);assert.equal(sha(bytes),record.sha256,id+': bundle hash '+record.path);
    }
    for(const file of [`${id}_pcm.c`,`${id}_pcm.h`,'LICENSE','NOTICE.md']){
      assert.deepEqual(await readFile(join(stage,'sources/native',id,file)),
        await readFile(join(sdk,`vendor/tetorica-${id}`,file)),id+': unchanged SDK '+file);
    }
    assert.deepEqual(await readFile(join(stage,`sources/native/${id}/${id}_wasm.c`)),
      await readFile(join(sdk,`wasm/${id}_wasm.c`)),id+': unchanged SDK bridge');
    for(const file of ['LICENSE','NOTICE.md'])assert.deepEqual(await readFile(join(stage,`licenses/tetorica-${id}`,file)),
      await readFile(join(stage,'sources/native',id,file)),id+': retained notice '+file);
    const recipe=await readFile(join(stage,`sources/scripts/build_${id}_wasm.sh`),'utf8');
    assert(!/import_soundchip_sdk|third_party\/tetorica-soundchip-native|vendor\/tetorica-|build-wasm\.sh/.test(recipe),id+': self-contained recipe');
    assert(recipe.includes(`"$ROOT_DIR/native/${id}/${id}_pcm.c"`)&&recipe.includes(`"$ROOT_DIR/native/${id}/${id}_wasm.c"`),id+': local bundled compiler inputs');
    assert(recipe.includes('-std=c11 -O2 -ffp-contract=off'),id+': original numeric compiler flags');
    for(const file of [`sources/native/${id}/README.md`,`sources/${label}.md`]){
      const text=await readFile(join(stage,file),'utf8');
      for(const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){
        if(!/^[a-z]+:|^#/.test(match[1]))await readFile(resolve(dirname(join(stage,file)),match[1]));
      }
    }
    const binary=await readFile(join(stage,`generated/${id}_wasm.wasm`));
    const module=new WebAssembly.Module(binary);assert.deepEqual(WebAssembly.Module.imports(module),[]);
    const instance=new WebAssembly.Instance(module,{});
    assert.equal(instance.exports.memory.buffer.byteLength,131072);
    assert.throws(()=>instance.exports.memory.grow(1),RangeError,id+': no memory growth');
    let rebuilt=null;
    if(build){
      // Run with only this source bundle as cwd; no SDK or importer is present.
      const output=join(scratch,id);
      execFileSync('sh',[`scripts/build_${id}_wasm.sh`,output],{cwd:join(stage,'sources'),stdio:'inherit'});
      for(const extension of ['js','wasm'])assert.deepEqual(await readFile(join(output,`${id}_wasm.${extension}`)),
        await readFile(join(stage,`generated/${id}_wasm.${extension}`)),id+': standalone rebuilt '+extension);
      const core=join(stage,`sources/native/${id}/${id}_pcm.c`);
      execFileSync(process.env.CC||'cc',['-std=c11','-Wall','-Wextra','-Werror','-c',core,'-o',join(output,'core-c11.o')],{stdio:'inherit'});
      execFileSync(process.env.CXX||'c++',['-std=c++14','-Wall','-Wextra','-Werror','-x','c++','-c',core,'-o',join(output,'core-cpp14.o')],{stdio:'inherit'});
      rebuilt={directory:output,descriptorAndWasmExact:true,c11:true,cpp14:true};
    }
    results.push({id,sdkInputs:receipt.inputs.length,bundleFiles:receipt.files.length,wasmSha256:sha(binary),rebuilt});
  }
  return {passed:true,stage:resolve(stage),sdkVersion:pin.version,sourceCommit:pin.sourceCommit,results};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),build=args.includes('--build');
  const paths=args.filter(arg=>arg!=='--build');
  if(paths.length>1||paths.some(arg=>arg.startsWith('--')))throw new Error('Usage: node scripts/check_application_audio_source_bundles.mjs [stage] [--build]');
  const stage=paths[0]?resolve(paths[0]):await mkdtemp(join(tmpdir(),'application-audio-source-bundle-'));
  if(!paths.length){await copyCddaSources(stage);await copyMsm5205Sources(stage);}
  console.log(JSON.stringify(await checkApplicationAudioSourceBundles(stage,{build}),null,2));
}
