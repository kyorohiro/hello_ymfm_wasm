// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {packageSnesSynth,validateSnesSynthVersion,verifySnesSourceReceipt} from './package_itch_snes_synth.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const root=new URL('../',import.meta.url);

test('S-DSP package versions cannot escape or overwrite arbitrary release paths',()=>{
  for(const value of ['../escape','/tmp/a','','.hidden','a/b','a\\b','a b','a;echo','x'.repeat(81)])assert.throws(()=>validateSnesSynthVersion(value));
  for(const value of ['dev','0.0.1','v1+test','2026-11-06'])assert.equal(validateSnesSynthVersion(value),value);
});

test('S-DSP ZIP preserves readable dependency closure, matching WASM and complete LGPL rebuilding sources',async t=>{
  const temporary=await mkdtemp(join(tmpdir(),'sdsp-synth-package-'));t.after(()=>rm(temporary,{recursive:true,force:true}));
  const a=await packageSnesSynth({version:'test',releaseDir:join(temporary,'a')});
  const b=await packageSnesSynth({version:'test',releaseDir:join(temporary,'b')});
  assert.deepEqual(await readFile(a.archive),await readFile(b.archive));assert(a.files<1000);assert.equal(a.bundles,3);
  const info=JSON.parse(execFileSync('python3',['-c',String.raw`
import json,sys,zipfile,io,hashlib
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 assert all(not name.startswith('/') and '..' not in name.split('/') for name in z.namelist())
 receipt=json.loads(z.read('sources/sdsp-synth-browser.json'))
 source_bytes=z.read(receipt['sourceArchive']['path'])
 assert hashlib.sha256(source_bytes).hexdigest()==receipt['sourceArchive']['sha256']
 with zipfile.ZipFile(io.BytesIO(source_bytes)) as source:
  assert set(source.namelist())==set(item['path'] for item in receipt['originalInputs'])
  for item in receipt['originalInputs']:
   data=source.read(item['path'])
   assert len(data)==item['bytes'] and hashlib.sha256(data).hexdigest()==item['sha256']
 print(json.dumps({'names':z.namelist(),'receipt':receipt}))
`,a.archive],{encoding:'utf8'}));
  assert.equal(info.names.length,a.files);assert(!JSON.stringify(info.receipt).includes('/Users/'));
  assert.equal(info.receipt.product,'Tetorica S-DSP Synth');assert.equal(info.receipt.productId,'tetorica-sdsp-synth');
  assert.match(a.archive,/tetorica_sdsp_synth_test_itch\.zip$/);
  assert.equal(info.receipt.builder.name,'source-copy');assert.equal(info.receipt.builder.minify,false);assert.equal(info.receipt.builder.bundle,false);
  assert.equal(info.receipt.builder.dependencyAnalyzer.name,'esbuild');
  assert(info.receipt.modules.length>info.receipt.bundles.length);
  let assets=0;
  for(const module of info.receipt.modules) {
    assert.equal(module.path,module.sourcePath.slice('docs/'.length));
    const bytes=await readFile(join(a.stage,module.path));
    assert.deepEqual(bytes,await readFile(new URL(module.sourcePath,root)),`${module.path}: original comments, names and imports`);
    assert.equal(bytes.length,module.bytes);assert.equal(sha(bytes),module.sha256);
    for(const specifier of module.localImports) {
      assert.match(specifier,/^\.\.?\//);
      const url=new URL(specifier,new URL(module.path,'https://zip.invalid/'));
      assert(info.names.includes(decodeURIComponent(url.pathname.slice(1))),`${module.path}: ${specifier}`);
    }
    for(const match of bytes.toString().matchAll(/new URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g)) {
      const url=new URL(match[2],new URL(module.path,'https://zip.invalid/'));
      if(url.origin!=='https://zip.invalid')continue;
      assert(info.names.includes(decodeURIComponent(url.pathname.slice(1))),`${module.path}: ${match[2]}`);assets++;
    }
  }
  assert(assets>=2,'audio references retain the local WASM and processor assets');
  for(const entry of info.receipt.bundles)assert.deepEqual(entry,info.receipt.modules.find(module=>module.path===entry.path));
  for(const name of ['preset.js','instrument.js','sample.js','audio_import.js','editor.js'])assert(info.receipt.modules.some(module=>module.path==='synth-snes/'+name));
  for(const name of ['snessynth.js','spc.js','spc_resampler.js','snes_brr.js','snes_brr_encoder.js'])assert(info.receipt.modules.some(module=>module.path==='js/'+name));
  const main=await readFile(join(a.stage,'synth-snes/synth.js'),'utf8');assert(main.split('\n').length>100);
  assert.match(main,/import \{createAudio\} from '\.\/audio\.js'/);
  assert.match(await readFile(join(a.stage,'synth-snes/synth.css'),'utf8'),/@import url\('\.\.\/synth-spu\/synth\.css'\)/);
  assert(info.receipt.modules.some(module=>module.path==='synth-spu/synth.css'));
  for(const name of ['spc_wasm.js','spc_wasm.wasm'])assert.deepEqual(await readFile(join(a.stage,'generated',name)),await readFile(new URL('tetorica_src/runtime/generated/'+name,root)));
  const native=JSON.parse(await readFile(join(a.stage,'sources/SNES-SPC.json')));
  await verifySnesSourceReceipt(a.stage,native);assert.equal(native.component,'spc');
  for(const entry of native.inputs) {
    const bytes=await readFile(join(a.stage,entry.path));assert.equal(bytes.length,entry.bytes);assert.equal(sha(bytes),entry.sha256);
  }
  const manifest=JSON.parse(await readFile(new URL('third_party/tetorica-soundchip-native/RELEASE-MANIFEST.json',root)));
  const upstream=Object.keys(manifest.files).filter(path=>path.startsWith('vendor/snes-spc/'));
  assert(upstream.length>10);
  for(const path of upstream) {
    const shipped='sources/'+path.replace(/^vendor\//,'third_party/');
    assert(info.names.includes(shipped));
    assert.deepEqual(await readFile(join(a.stage,shipped)),await readFile(new URL('third_party/tetorica-soundchip-native/'+path,root)));
  }
  const recipe=await readFile(join(a.stage,'sources/scripts/build_spc_wasm.sh'),'utf8');
  const originalRecipe=await readFile(new URL('third_party/tetorica-soundchip-native/scripts/build_spc_wasm.sh',root),'utf8');
  assert.equal(recipe,originalRecipe.replaceAll('vendor/snes-spc','third_party/snes-spc'));
  assert.match(recipe,/Accurate DSP/);assert.match(recipe,/wasm\/spc_wasm\.cpp/);
  assert.match(await readFile(join(a.stage,'licenses/snes-spc/LICENSE'),'utf8'),/GNU LESSER GENERAL PUBLIC LICENSE/);
  assert.match(await readFile(join(a.stage,'sources/SNES-SPC.md'),'utf8'),/No Nintendo IPL ROM or game/);
  for(const entry of ['index.html','synth-snes/index.html']) {
    const html=await readFile(join(a.stage,entry),'utf8');assert.match(html,/<title>Tetorica S-DSP Synth<\/title>/);
    assert.match(html,/<meta name="application-name" content="Tetorica S-DSP Synth">/);
    for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const url=new URL(match[1],new URL(entry,'https://zip.invalid/'));
      if(url.origin==='https://zip.invalid')assert(info.names.includes(url.pathname.slice(1)),`${entry}: ${match[1]}`);
    }
  }
  const target=join(a.stage,'sources/third_party/snes-spc/snes_spc/SPC_DSP.cpp'),original=await readFile(target);
  await writeFile(target,Buffer.concat([original,Buffer.from('\n// changed\n')]));
  await assert.rejects(verifySnesSourceReceipt(a.stage,native),/receipt mismatch/);await writeFile(target,original);
  const missing=structuredClone(native);missing.inputs=missing.inputs.filter(input=>input.path!=='sources/wasm/spc_wasm.cpp');
  await assert.rejects(verifySnesSourceReceipt(a.stage,missing),/Incomplete/);
  const unsafe=structuredClone(native);unsafe.inputs[0].path='../outside';await assert.rejects(verifySnesSourceReceipt(a.stage,unsafe),/Unsafe/);
  await verifySnesSourceReceipt(a.stage,native);
  const archive=await readFile(a.archive);await assert.rejects(packageSnesSynth({version:'test',releaseDir:join(temporary,'a')}),/already exists/);
  assert.deepEqual(await readFile(a.archive),archive);
});
