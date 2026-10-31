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
test('SCSP ZIP is self-contained, deterministic and retains authenticated browser/native source',async t=>{
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
 for(const name of ['generated/scsp_wasm.js','generated/scsp_wasm.wasm'])assert.deepEqual(await readFile(join(a.stage,name)),await readFile(new URL('../docs/'+name,import.meta.url)));
 assert.deepEqual(await readFile(join(a.stage,'tetorica-spu-1254.webp')),await readFile(new URL('../docs/tetorica-spu-1254.webp',import.meta.url)));
 const native=JSON.parse(await readFile(join(a.stage,'sources/SCSP.json')));
 for(const entry of native.inputs){const data=await readFile(join(a.stage,entry.path));assert.equal(data.length,entry.bytes);assert.equal(sha(data),entry.sha256);}
 for(const [name,entry]of Object.entries(native.generated))assert.equal(sha(await readFile(join(a.stage,'generated',name))),entry.sha256);
 for(const entry of info.receipt.bundles){const data=await readFile(join(a.stage,entry.path));assert.equal(sha(data),entry.sha256);assert(entry.localImports.every(p=>p==='../generated/scsp_wasm.js'));assert(!data.toString().includes('node:fs'));
  for(const match of data.toString().matchAll(/new URL\("([^"?#]+)(?:[?#][^"]*)?",import\.meta\.url\)/g)){const url=new URL(match[1],new URL(entry.path,'https://zip.invalid/'));assert(info.names.includes(url.pathname.slice(1)),`${entry.path}: ${match[1]}`);}
 }
 for(const entry of ['index.html','synth-scsp/index.html','playground/scsp-dsp.html']){const html=await readFile(join(a.stage,entry),'utf8');for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){const url=new URL(match[1],new URL(entry,'https://zip.invalid/'));if(url.origin==='https://zip.invalid')assert(info.names.includes(url.pathname.slice(1)),`${entry}: ${match[1]}`);}}
 assert.match(await readFile(join(a.stage,'sources/SCSP.md'),'utf8'),/build_scsp_wasm/);assert.match(await readFile(join(a.stage,'licenses/mame-scsp/LICENSE'),'utf8'),/Redistribution/);
 const original=await readFile(a.archive);await assert.rejects(packageScspSynth({version:'test',releaseDir:join(dir,'a')}),/already exists/);assert.deepEqual(await readFile(a.archive),original);
});
