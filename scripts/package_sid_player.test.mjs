// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {packageSidPlayer,validateSidPlayerVersion} from './package_sid_player.mjs';

const record=bytes=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});

test('SID player package version cannot escape its release directory',()=>{
  for(const value of ['',null,1,'../escape','/tmp/file','.hidden','a/b','a\\b','a b','x;echo','x'.repeat(81)])assert.throws(()=>validateSidPlayerVersion(value));
  for(const value of ['dev','0.0.1','v0.0.1+test','local-preview'])assert.equal(validateSidPlayerVersion(value),value);
});

test('SID player ZIP is deterministic, readable, self-contained and hash-checked without game music',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'sid-player-package-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  // Simulate private firmware beside earlier release artifacts. The populated
  // and empty release directories must still produce the exact same package.
  const privateMarker='PRIVATE_USER_FIRMWARE_MUST_NOT_BE_PACKAGED_91d8';
  const privateRom=Buffer.alloc(8192,0xa5);privateRom.write(privateMarker);
  await mkdir(join(directory,'first','private-roms'),{recursive:true});
  await writeFile(join(directory,'first','my-kernal.rom'),privateRom);
  await writeFile(join(directory,'first','private-roms','basic.bin'),privateRom);
  const first=await packageSidPlayer({version:'test',releaseDir:join(directory,'first')});
  const second=await packageSidPlayer({version:'test',releaseDir:join(directory,'second')});
  const archive=await readFile(first.archive);
  assert.deepEqual(archive,await readFile(second.archive));assert.deepEqual(first.archiveRecord,record(archive));
  const info=JSON.parse(execFileSync('python3',['-c',String.raw`
import hashlib,io,json,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 names=z.namelist();assert len(names)==len(set(names))
 assert all(not p.startswith('/') and '..' not in p.split('/') for p in names)
 assert not any(p.lower().endswith(('.bin','.rom')) for p in names)
 assert all(b'PRIVATE_USER_FIRMWARE_MUST_NOT_BE_PACKAGED_91d8' not in z.read(p) for p in names)
 receipt=json.loads(z.read('sources/sid-player-browser.json'))
 source=z.read(receipt['sourceArchive']['path'])
 assert hashlib.sha256(source).hexdigest()==receipt['sourceArchive']['sha256']
 assert len(source)==receipt['sourceArchive']['bytes']
 with zipfile.ZipFile(io.BytesIO(source)) as s:
  assert s.testzip() is None
  assert set(s.namelist())==set(i['path'] for i in receipt['originalInputs'])
  for i in receipt['originalInputs']:
   b=s.read(i['path']);assert len(b)==i['bytes'] and hashlib.sha256(b).hexdigest()==i['sha256']
   assert b'PRIVATE_USER_FIRMWARE_MUST_NOT_BE_PACKAGED_91d8' not in b
  assert s.read('tetorica_src/runtime/sid_psid.js')==z.read('js/sid_psid.js')
  assert s.read('tetorica_src/runtime/sid_rsid.js')==z.read('js/sid_rsid.js')
  assert s.read('test/fixtures/sid-reference/fixture.mjs')==z.read('sid-player/demos/fixture.mjs')
  assert s.read('test/helpers/rsid_fixtures.mjs')==z.read('sid-player/demos/rsid/fixture.mjs')
  assert 'test/helpers/rsid_test_roms.mjs' not in s.namelist()
 print(json.dumps({'names':names,'receipt':receipt}))
`,first.archive],{encoding:'utf8'}));
  assert.equal(info.names.length,first.files);assert(first.files<1000);
  assert(!JSON.stringify(info.receipt).includes('/Users/'));
  assert.equal(info.receipt.productId,'tetorica-sid-player');assert.equal(info.receipt.builder.minify,false);assert.equal(info.receipt.builder.bundle,false);
  assert.deepEqual(info.names.filter(name=>name.endsWith('.sid')).sort(),['sid-player/demos/melody-filter.sid','sid-player/demos/noise.sid','sid-player/demos/pulse.sid','sid-player/demos/rsid/irq.sid','sid-player/demos/tone.sid']);
  assert(!info.names.some(name=>/\.(?:bin|rom)$/i.test(name)));
  assert.deepEqual(await readFile(join(directory,'first','my-kernal.rom')),privateRom,'Private firmware is left untouched');
  assert(!info.names.some(name=>/\.test\.[cm]?js$|C64Music|libsidplayfp|libresidfp/.test(name)));
  const present=new Set(info.names),base='https://zip.invalid/';
  const resolvePath=(target,entry)=>{
    const url=new URL(target,new URL(entry,base));assert.equal(url.origin,'https://zip.invalid',`${entry}: external runtime ${target}`);
    return decodeURIComponent(url.pathname.slice(1));
  };
  for(const module of info.receipt.modules){
    const bytes=await readFile(join(first.stage,module.path));
    assert.deepEqual(bytes,await readFile(new URL('../'+module.sourcePath,import.meta.url)));
    assert.deepEqual(record(bytes),{bytes:module.bytes,sha256:module.sha256});
    assert.doesNotMatch(bytes.toString(),/(?:from\s*|import\s*\(|require\s*\()\s*['"]node:/);
    for(const specifier of module.localImports)assert(present.has(resolvePath(specifier,module.path)),`${module.path}: ${specifier}`);
    for(const [,,target] of bytes.toString().matchAll(/new URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g))assert(present.has(resolvePath(target,module.path)),`${module.path}: ${target}`);
  }
  assert.equal(info.receipt.nativeArtifacts.length,2);
  for(const component of ['sid-player','sid-rsid']){
    const native=JSON.parse(await readFile(join(first.stage,`generated/${component}/${component}-build.json`),'utf8'));
    assert.equal(native.component,component);assert.equal(native.fixedSdkArtifact,false);
    assert.deepEqual(record(await readFile(join(first.stage,`generated/${component}/${component}.wasm`))),native.output);
    for(const [path,digest] of Object.entries(native.inputs))assert.deepEqual(record(await readFile(join(first.stage,'sources',component,path))),digest,path);
    assert(info.receipt.nativeArtifacts.some(artifact=>artifact.path===`generated/${component}/${component}.wasm`&&artifact.sha256===native.output.sha256));
  }
  const rsidProvenance=JSON.parse(await readFile(join(first.stage,'sid-player/demos/rsid/provenance.json'),'utf8'));
  assert.equal(rsidProvenance.containsRomDump,false);assert.equal(rsidProvenance.containsThirdPartyMusic,false);
  assert.doesNotMatch(await readFile(join(first.stage,'sid-player/demos/rsid/fixture.mjs'),'utf8'),/createRsidTestRoms/);
  const html=await readFile(join(first.stage,'sid-player/index.html'),'utf8');
  assert.match(html,/<title>SID Player · Tetorica<\/title>/);
  assert.match(await readFile(join(first.stage,'index.html'),'utf8'),/url=sid-player\/index.html/);
  for(const [tag] of html.matchAll(/<(?:img|script|link)\b[^>]*>/g))for(const [,target] of tag.matchAll(/\b(?:src|href)="([^"]+)"/g))assert(present.has(resolvePath(target,'sid-player/index.html')));
  for(const [,target] of html.matchAll(/\bhref="([^"]+)"/g)){
    const url=new URL(target,new URL('sid-player/index.html',base));
    if(url.origin==='https://zip.invalid')assert(present.has(url.pathname.slice(1)),`Broken navigation ${target}`);
  }
  assert.match(await readFile(join(first.stage,'sources/sid-player/third_party/chips-m6502/LICENSE'),'utf8'),/zlib\/libpng/);
  assert.match(await readFile(join(first.stage,'sources/sid-player/third_party/chips-m6581/PATCHES.md'),'utf8'),/6581|SID/);
  assert.match(await readFile(join(first.stage,'sources/sid-rsid/third_party/chips-c64/LICENSE'),'utf8'),/zlib\/libpng/);
  assert.match(await readFile(join(first.stage,'sid-player/demos/rsid/LICENSE.txt'),'utf8'),/BSD 3-Clause License/);
  await assert.rejects(packageSidPlayer({version:'test',releaseDir:join(directory,'first')}),/already exists/);
  assert.deepEqual(await readFile(first.archive),archive,'Existing archive must remain unchanged');
});
