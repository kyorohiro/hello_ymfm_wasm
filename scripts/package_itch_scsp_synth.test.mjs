// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {packageScspSynth,validateScspSynthVersion} from './package_itch_scsp_synth.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('package versions cannot escape the release directory',()=>{
 for(const value of ['../escape','/tmp/a','','.hidden','a/b','a\\b','a b','a;echo','x'.repeat(81)])assert.throws(()=>validateScspSynthVersion(value));
 for(const value of ['dev','v1+test','2026-10-30'])assert.equal(validateScspSynthVersion(value),value);
});
test('SCSP ZIP is deterministic and runs byte-exact editable modules with authenticated browser/native source',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'scsp-synth-package-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const a=await packageScspSynth({version:'test',releaseDir:join(dir,'a')}),b=await packageScspSynth({version:'test',releaseDir:join(dir,'b')});
 assert.deepEqual(await readFile(a.archive),await readFile(b.archive));assert(a.files<1000);assert.equal(a.bundles,3);
 const info=JSON.parse(execFileSync('python3',['-c',String.raw`
import json,sys,zipfile,io,hashlib
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 assert all(not name.endswith('/') and not name.startswith('/') and '..' not in name.split('/') for name in z.namelist())
 receipt=json.loads(z.read('sources/scsp-synth-browser.json'))
 src=z.read(receipt['sourceArchive']['path'])
 assert hashlib.sha256(src).hexdigest()==receipt['sourceArchive']['sha256']
 with zipfile.ZipFile(io.BytesIO(src)) as source:
  assert set(source.namelist())==set(item['path'] for item in receipt['originalInputs'])
  for item in receipt['originalInputs']:
   data=source.read(item['path']);assert len(data)==item['bytes'] and hashlib.sha256(data).hexdigest()==item['sha256']
 print(json.dumps({'names':z.namelist(),'receipt':receipt}))
`,a.archive],{encoding:'utf8'}));
 assert.equal(info.names.length,a.files);assert(!JSON.stringify(info.receipt).includes('/Users/'));
 assert.deepEqual(info.receipt.builder,{name:'source-copy',minify:false,bundle:false,dependencyAnalyzer:{name:'esbuild',version:info.receipt.builder.dependencyAnalyzer.version}});
 assert.match(info.receipt.builder.dependencyAnalyzer.version,/^\d+\.\d+\.\d+/);
 for(const name of ['generated/scsp_wasm.js','generated/scsp_wasm.wasm'])assert.deepEqual(await readFile(join(a.stage,name)),await readFile(new URL('../tetorica_src/runtime/'+name,import.meta.url)));
 assert(info.receipt.originalInputs.some(input=>input.path==='tetorica_src/runtime/generated/scsp_wasm.js'));
 assert(!info.receipt.originalInputs.some(input=>input.path==='docs/generated/scsp_wasm.js'));
 assert(info.receipt.originalInputs.some(input=>input.path==='scripts/copy_readable_modules.mjs'));
 assert.deepEqual(await readFile(join(a.stage,'tetorica-spu-1254.webp')),await readFile(new URL('../docs/tetorica-spu-1254.webp',import.meta.url)));
 const native=JSON.parse(await readFile(join(a.stage,'sources/SCSP.json')));
 for(const entry of native.inputs){const data=await readFile(join(a.stage,entry.path));assert.equal(data.length,entry.bytes);assert.equal(sha(data),entry.sha256);}
 for(const [name,entry]of Object.entries(native.generated))assert.equal(sha(await readFile(join(a.stage,'generated',name))),entry.sha256);
 assert.deepEqual(info.receipt.bundles.map(entry=>entry.path),['synth-scsp/synth.js','synth-scsp/processor.js','playground/scsp_dsp_lab.js']);
 assert(info.receipt.modules.length>info.receipt.bundles.length);
 assert(!info.names.includes('synth-scsp/lab.js'),'the Lab keeps its authored path');
 for(const module of info.receipt.modules){
  assert.equal(module.path,module.sourcePath.slice('docs/'.length));
  const data=await readFile(join(a.stage,module.path));assert.equal(data.length,module.bytes);assert.equal(sha(data),module.sha256);
  assert.deepEqual(data,await readFile(new URL('../'+module.sourcePath,import.meta.url)),`${module.path}: shipped live source is directly editable and unchanged`);
  const source=info.receipt.originalInputs.find(input=>input.path===module.sourcePath);assert(source);assert.equal(source.sha256,module.sha256);
  for(const specifier of module.localImports){assert(/^\.\.?\//.test(specifier));const url=new URL(specifier,new URL(module.path,'https://zip.invalid/'));assert(info.names.includes(decodeURIComponent(url.pathname.slice(1))),`${module.path}: local import ${specifier}`);}
  for(const match of data.toString().matchAll(/new\s+URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g)){const url=new URL(match[2],new URL(module.path,'https://zip.invalid/'));assert(info.names.includes(decodeURIComponent(url.pathname.slice(1))),`${module.path}: runtime asset ${match[2]}`);}
 }
 assert(info.receipt.modules.some(module=>module.path==='synth-scsp/synth.css'));
 for(const entry of info.receipt.bundles)assert.deepEqual(entry,info.receipt.modules.find(module=>module.path===entry.path));
 for(const entry of ['index.html','synth-scsp/index.html','playground/scsp-dsp.html']){const html=await readFile(join(a.stage,entry),'utf8');for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){const url=new URL(match[1],new URL(entry,'https://zip.invalid/'));if(url.origin==='https://zip.invalid')assert(info.names.includes(url.pathname.slice(1)),`${entry}: ${match[1]}`);}}
 assert.match(await readFile(join(a.stage,'sources/SCSP.md'),'utf8'),/build_scsp_wasm/);assert.match(await readFile(join(a.stage,'licenses/mame-scsp/LICENSE'),'utf8'),/Redistribution/);
 assert.match(await readFile(join(a.stage,'playground/scsp-dsp.html'),'utf8'),/src="scsp_dsp_lab\.js\?v=delay-1"/);
 assert.match(await readFile(join(a.stage,'README.md'),'utf8'),/copied byte-for-byte/);
 const original=await readFile(a.archive);await assert.rejects(packageScspSynth({version:'test',releaseDir:join(dir,'a')}),/already exists/);assert.deepEqual(await readFile(a.archive),original);
});
