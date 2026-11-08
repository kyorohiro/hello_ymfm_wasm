// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {packageSidSynth, validateSidSynthVersion} from './package_itch_sid_synth.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
test('SID package version is confined to its selected release directory', () => {
  for (const value of ['', '../escape', '/tmp/a', '.hidden', 'a/b', 'a\\b', 'a b', 'a;echo', 'x'.repeat(81)]) assert.throws(() => validateSidSynthVersion(value));
  for (const value of ['dev', 'v0.0.1', 'local+test']) assert.equal(validateSidSynthVersion(value), value);
});

test('SID ZIP preserves editable modules, independent entry points and matching source provenance', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sid-synth-package-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  const a = await packageSidSynth({version:'test', releaseDir:join(directory, 'a')});
  const b = await packageSidSynth({version:'test', releaseDir:join(directory, 'b')});
  assert.deepEqual(await readFile(a.archive), await readFile(b.archive));
  assert(a.files < 1000); assert.equal(a.bundles, 3);
  const info = JSON.parse(execFileSync('python3', ['-c', String.raw`
import json,sys,zipfile,io,hashlib
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 assert all(not name.startswith('/') and '..' not in name.split('/') for name in z.namelist())
 r=json.loads(z.read('sources/sid-synth-browser.json'));src=z.read(r['sourceArchive']['path'])
 assert hashlib.sha256(src).hexdigest()==r['sourceArchive']['sha256']
 with zipfile.ZipFile(io.BytesIO(src)) as s:
  assert set(s.namelist())==set(i['path'] for i in r['originalInputs'])
  for i in r['originalInputs']:
   b=s.read(i['path']);assert len(b)==i['bytes'] and hashlib.sha256(b).hexdigest()==i['sha256']
 print(json.dumps({'names':z.namelist(),'receipt':r}))
`, a.archive], {encoding:'utf8'}));
  assert.equal(info.names.length, a.files);
  assert(!JSON.stringify(info.receipt).includes('/Users/'));
  assert.equal(info.receipt.product, 'Tetorica SID Synth');
  assert.equal(info.receipt.productId, 'tetorica-sid-synth');
  const icon = await readFile(new URL('../docs/tetorica_sid_synth.webp', import.meta.url));
  assert.deepEqual(await readFile(join(a.stage, 'tetorica_sid_synth.webp')), icon);
  for (const path of ['docs/tetorica_sid_synth.webp', 'docs/issues/tetorica_sid_icon_prompt_20261107.txt']) {
    const input = info.receipt.originalInputs.find(input => input.path === path);
    assert(input, `Missing icon provenance: ${path}`);
    const bytes = await readFile(new URL('../' + path, import.meta.url));
    assert.equal(input.bytes, bytes.length); assert.equal(input.sha256, sha(bytes));
  }
  assert(!info.names.includes('playground-favicon.ico'));
  assert.deepEqual(await readFile(join(a.stage, 'generated/sid/sid.wasm')), await readFile(new URL('../tetorica_src/runtime/generated/sid/sid.wasm', import.meta.url)));
  const native = JSON.parse(await readFile(join(a.stage, 'generated/sid/sid-build.json')));
  for (const [path, input] of Object.entries(native.inputs)) {
    const bytes = await readFile(join(a.stage, 'sources/sid', path));
    assert.equal(bytes.length, input.bytes); assert.equal(sha(bytes), input.sha256, path);
  }
  assert.equal(sha(await readFile(join(a.stage, 'generated/sid/sid.wasm'))), native.output.sha256);
  // The Preview must be rebuildable from the exact sources that produced its
  // endpoint, without assuming Rust or Emscripten is installed at package time.
  const previewRoot='generated/sid8580-machine',kit=info.receipt.previewSourceKit;
  assert.equal(kit.path,'sources/sid8580-machine');assert.equal(kit.manifest,'source-kit.json');
  const previewReceiptBytes=await readFile(join(a.stage,previewRoot,'sid8580-machine-build.json'));
  const previewReceipt=JSON.parse(previewReceiptBytes),sourceKit=JSON.parse(await readFile(join(a.stage,kit.path,kit.manifest)));
  assert.equal(previewReceipt.model,'8580');assert.equal(previewReceipt.fixedSdkArtifact,false);assert.equal(previewReceipt.clockHz,985248);
  assert.deepEqual(previewReceipt.profileDefaults,{resonance:false,cutoff:false});
  assert.deepEqual(sourceKit.compiledInputs,previewReceipt.inputs);assert.equal(sourceKit.compiledInputCount,99);assert.equal(kit.compiledInputCount,sourceKit.compiledInputCount);
  assert.equal(sourceKit.compilerInvocationPerformed,false);assert.equal(sourceKit.preview,true);
  assert.deepEqual(sourceKit.artifacts,info.receipt.previewArtifacts);assert.deepEqual(sourceKit.buildReceipt,kit.buildReceipt);
  assert.equal(sourceKit.buildReceipt.bytes,previewReceiptBytes.length);assert.equal(sourceKit.buildReceipt.sha256,sha(previewReceiptBytes));
  assert.deepEqual(await readFile(join(a.stage,kit.path,sourceKit.buildReceipt.path)),previewReceiptBytes);
  for(const artifact of sourceKit.artifacts){
    assert(artifact.path.startsWith(previewRoot+'/'));const bytes=await readFile(join(a.stage,artifact.path));
    assert.equal(bytes.length,artifact.bytes);assert.equal(sha(bytes),artifact.sha256);
    assert.deepEqual({bytes:artifact.bytes,sha256:artifact.sha256},previewReceipt.outputs[artifact.path.slice(previewRoot.length+1)]);
  }
  assert.deepEqual(sourceKit.artifacts.map(item=>item.path).sort(),[previewRoot+'/sid8580-endpoint.wasm',previewRoot+'/sid8580-machine.wasm']);
  for(const [path,input] of Object.entries(sourceKit.sources)){
    assert(!path.startsWith('/')&&!path.split('/').includes('..'));const bytes=await readFile(join(a.stage,kit.path,path));
    assert.equal(bytes.length,input.bytes);assert.equal(sha(bytes),input.sha256,path);
    assert.deepEqual(bytes,await readFile(new URL('../'+path,import.meta.url)));
    assert(info.receipt.originalInputs.some(item=>item.path===path&&item.sha256===input.sha256),`Missing browser source provenance: ${path}`);
  }
  for(const [path,input] of Object.entries(previewReceipt.inputs))assert.deepEqual(sourceKit.sources[path],input,`Missing compiled source: ${path}`);
  assert.deepEqual(sourceKit.noticeRoots,['third_party/sidera/toolchain-notices','third_party/sid8580-machine-toolchain-notices']);
  for(const root of sourceKit.noticeRoots){
    const notices=JSON.parse(await readFile(join(a.stage,kit.path,root,'SOURCES.json')));
    for(const [name,{bytes,sha256}]of Object.entries(notices.files))assert.deepEqual(sourceKit.sources[root+'/'+name],{bytes,sha256});
  }
  assert.match(await readFile(join(a.stage,kit.path,'third_party/sidera/LICENSE'),'utf8'),/MIT License/);
  assert.match(await readFile(join(a.stage,'sources/SID8580.md'),'utf8'),/CPU-free SID 8580 Preview/);
  assert(!info.names.some(name=>/\.(?:sid|psid|rsid|rom|wav|pcm|f32le|exe|dylib|rlib|o|a)$/i.test(name)),'No native binaries, user firmware or music belong in the distribution');
  const endpoint=await WebAssembly.compile(await readFile(join(a.stage,previewRoot,'sid8580-endpoint.wasm')));
  assert.deepEqual(WebAssembly.Module.imports(endpoint),[]);const endpointExports=new Map(WebAssembly.Module.exports(endpoint).map(item=>[item.name,item.kind]));
  for(const name of ['create','destroy','run','output','output_frames','write','read','model','calibration','cutoff_calibration'])assert.equal(endpointExports.get('sid8p_'+name),'function',name);
  for(const name of ['sid8580.js','sid8580.d.ts']){
    const bytes=await readFile(join(a.stage,'js',name));assert.deepEqual(bytes,await readFile(new URL('../tetorica_src/runtime/'+name,import.meta.url)));
  }
  assert.match(await readFile(join(a.stage,'js/sid8580.js'),'utf8'),/export class Sid8580Core/);
  assert(info.receipt.modules.some(module=>module.path==='js/sid8580.js'),'The 8580 adapter must remain an authored readable module');
  assert.equal(info.receipt.builder.minify, false); assert.equal(info.receipt.builder.bundle, false);
  assert(info.receipt.modules.length > info.receipt.bundles.length);
  for (const module of info.receipt.modules) {
    const bytes = await readFile(join(a.stage, module.path));
    assert.deepEqual(bytes, await readFile(new URL('../' + module.sourcePath, import.meta.url)));
    assert.equal(bytes.length, module.bytes); assert.equal(sha(bytes), module.sha256);
    for (const spec of module.localImports) {
      const url = new URL(spec, new URL(module.path, 'https://zip.invalid/'));
      assert(info.names.includes(decodeURIComponent(url.pathname.slice(1))), `${module.path}: ${spec}`);
    }
    for (const match of bytes.toString().matchAll(/new URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g)) {
      const url = new URL(match[2], new URL(module.path, 'https://zip.invalid/'));
      if (url.origin === 'https://zip.invalid') assert(info.names.includes(decodeURIComponent(url.pathname.slice(1))), `${module.path}: ${match[2]}`);
    }
  }
  for (const entry of ['index.html', 'synth-sid/index.html']) {
    const html = await readFile(join(a.stage, entry), 'utf8');
    assert.match(html, /<title>Tetorica SID Synth<\/title>/);
    const iconPath = entry === 'index.html' ? './tetorica_sid_synth.webp' : '../tetorica_sid_synth.webp';
    const iconLinks = [...html.matchAll(/<link\b[^>]*rel="(?:icon|apple-touch-icon)"[^>]*>/g)];
    assert.equal(iconLinks.length, 2, `${entry}: favicon and apple-touch icon`);
    for (const [tag] of iconLinks) assert.equal(/\bhref="([^"]+)"/.exec(tag)?.[1], iconPath);
    const images = [...html.matchAll(/<img\b[^>]*>/g)];
    assert(images.length > 0, `${entry}: product image`);
    for (const [tag] of images) assert.equal(/\bsrc="([^"]+)"/.exec(tag)?.[1], iconPath);
    assert.doesNotMatch(html, /playground-favicon\.ico/);
    // Every displayed image, script and linked asset must work without a network request.
    for (const [tag] of html.matchAll(/<(?:img|script|link)\b[^>]*>/g)) {
      for (const [, value] of tag.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
        const url = new URL(value, new URL(entry, 'https://zip.invalid/'));
        assert.equal(url.origin, 'https://zip.invalid', `${entry}: remote asset ${value}`);
        assert(info.names.includes(decodeURIComponent(url.pathname.slice(1))), `${entry}: ${value}`);
      }
    }
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const url = new URL(match[1], new URL(entry, 'https://zip.invalid/'));
      if (url.origin === 'https://zip.invalid') assert(info.names.includes(url.pathname.slice(1)), `${entry}: ${match[1]}`);
    }
  }
  assert.match(await readFile(join(a.stage, 'licenses/chips-m6581/LICENSE'), 'utf8'), /zlib\/libpng/);
  const original = await readFile(a.archive);
  await assert.rejects(packageSidSynth({version:'test', releaseDir:join(directory, 'a')}), /already exists/);
  assert.deepEqual(await readFile(a.archive), original);
});
