// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {packageNesSynth,validateNesSynthVersion} from './package_itch_nes_synth.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('NES Synth package version cannot escape its release directory',()=>{
  for(const value of ['../escape','/tmp/a','','.hidden','a/b','a\\b','a b','a;echo','x'.repeat(81)]) assert.throws(()=>validateNesSynthVersion(value));
  for(const value of ['dev','v1+test','2026-11-04']) assert.equal(validateNesSynthVersion(value),value);
});

test('NES + FDS ZIP is standalone and deterministic with original WASM and corresponding source receipts',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'nes-synth-package-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const a=await packageNesSynth({version:'test',releaseDir:join(directory,'a')});
  const b=await packageNesSynth({version:'test',releaseDir:join(directory,'b')});
  assert.deepEqual(await readFile(a.archive),await readFile(b.archive));assert(a.files<1000);assert.equal(a.bundles,3);
  const info=JSON.parse(execFileSync('python3',['-c',String.raw`
import json,sys,zipfile,io,hashlib
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 assert all(not name.startswith('/') and '..' not in name.split('/') for name in z.namelist())
 receipt=json.loads(z.read('sources/nes-synth-browser.json'))
 src=z.read(receipt['sourceArchive']['path'])
 assert hashlib.sha256(src).hexdigest()==receipt['sourceArchive']['sha256']
 with zipfile.ZipFile(io.BytesIO(src)) as source:
  assert set(source.namelist())==set(item['path'] for item in receipt['originalInputs'])
  for item in receipt['originalInputs']:
   data=source.read(item['path']);assert len(data)==item['bytes'] and hashlib.sha256(data).hexdigest()==item['sha256']
 print(json.dumps({'names':z.namelist(),'receipt':receipt}))
`,a.archive],{encoding:'utf8'}));
  assert.equal(info.names.length,a.files);assert(!JSON.stringify(info.receipt).includes('/Users/'));
  assert.equal(info.receipt.product,'Tetorica NES + FDS Synth');
  assert.equal(info.receipt.productId,'tetorica-nes-fds-synth');
  assert.match(a.archive,/tetorica_nes_synth_test_itch\.zip$/);
  for(const name of ['nesapu_wasm.js','nesapu_wasm.wasm']) assert.deepEqual(await readFile(join(a.stage,'generated',name)),await readFile(new URL('../tetorica_src/runtime/generated/'+name,import.meta.url)));
  const native=JSON.parse(await readFile(join(a.stage,'sources/NES-FDS.json')));
  assert.equal(native.component,'nesapu');
  assert.deepEqual(native.sdk,JSON.parse(await readFile(new URL('../third_party/soundchip-sdk.json',import.meta.url))));
  assert(native.inputs.length>5);
  for(const entry of native.inputs){const bytes=await readFile(join(a.stage,entry.path));assert.equal(bytes.length,entry.bytes);assert.equal(sha(bytes),entry.sha256);}
  for(const [name,entry] of Object.entries(native.generated)) {const bytes=await readFile(join(a.stage,'generated',name));assert.equal(bytes.length,entry.bytes);assert.equal(sha(bytes),entry.sha256);}
  const originalRecipe=await readFile(new URL('../third_party/tetorica-soundchip-native/scripts/build_nesapu_wasm.sh',import.meta.url),'utf8');
  assert.equal(await readFile(join(a.stage,'sources/scripts/build_nesapu_wasm.sh'),'utf8'),originalRecipe.replaceAll('vendor/tetorica-nes','third_party/tetorica-nes'));
  assert.deepEqual(await readFile(join(a.stage,'sources/third_party/tetorica-nes/nes_core.cpp')),await readFile(new URL('../third_party/tetorica-soundchip-native/vendor/tetorica-nes/nes_core.cpp',import.meta.url)));
  for(const bundle of info.receipt.bundles) {
    const bytes=await readFile(join(a.stage,bundle.path));assert.equal(sha(bytes),bundle.sha256);
    assert(bundle.localImports.every(path=>path==='../generated/nesapu_wasm.js'));
    assert(!bytes.toString().includes('node:fs'));
    for(const match of bytes.toString().matchAll(/new URL\("([^"?#]+)(?:[?#][^"]*)?",import\.meta\.url\)/g)) {
      const url=new URL(match[1],new URL(bundle.path,'https://zip.invalid/'));assert(info.names.includes(url.pathname.slice(1)),`${bundle.path}: ${match[1]}`);
    }
  }
  for(const entry of ['index.html','synth-nes/index.html']) {
    const html=await readFile(join(a.stage,entry),'utf8');
    assert.match(html,/<title>Tetorica NES \+ FDS Synth<\/title>/);
    assert.match(html,/<meta name="application-name" content="Tetorica NES \+ FDS Synth">/);
    for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const url=new URL(match[1],new URL(entry,'https://zip.invalid/'));
      if(url.origin==='https://zip.invalid') assert(info.names.includes(url.pathname.slice(1)),`${entry}: ${match[1]}`);
    }
  }
  assert.match(await readFile(join(a.stage,'licenses/jsnes/LICENSE'),'utf8'),/Apache License/);
  assert.match(await readFile(join(a.stage,'licenses/fixnes-fds/LICENSE'),'utf8'),/Permission is hereby granted/);
  assert.match(await readFile(join(a.stage,'licenses/tetorica-nes/LICENSE-JSNES'),'utf8'),/Apache License/);
  assert.match(await readFile(join(a.stage,'licenses/tetorica-nes/LICENSE-FDS'),'utf8'),/Permission is hereby granted/);
  const original=await readFile(a.archive);await assert.rejects(packageNesSynth({version:'test',releaseDir:join(directory,'a')}),/already exists/);assert.deepEqual(await readFile(a.archive),original);
});
