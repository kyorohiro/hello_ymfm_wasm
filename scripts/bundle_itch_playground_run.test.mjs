// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,access,realpath,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {bundleItchPlaygroundRun} from './bundle_itch_playground_run.mjs';

async function fixture(extra={}){
 const root=await realpath(await mkdtemp(join(tmpdir(),'itch UI bundle ')));
 const files={
  'index.html':`<script type="module">import('./playground.js?v=old');</script>`,
  'LICENSE':'Original BSD license fixture\n',
  'THIRD_PARTY_LICENSES.txt':'Original third party notices\n',
  'playground.js':`import {moduleURL,literal,VisibleName} from './ui.js?v=original-module';
import {shared} from './worker-shared.js';
import {externalURL} from './js/audio.js?v=original-audio';
import {retained} from './retained.js';
globalThis.__itchBundleTest={moduleURL,literal,name:VisibleName.name,shared,externalURL,retained,workerURL:new URL('./worker.js',import.meta.url).href,lazy:(await import('./lazy.js')).lazy};`,
  'ui.js':`/*! Fixture UI legal notice. */\nexport const moduleURL=import.meta.url;export const literal='import.meta.url';export function VisibleName(){return 1;}`,
  'worker-shared.js':`export const shared='shared worker dependency';\n`,
  'worker.js':`import {shared} from './worker-shared.js';globalThis.workerShared=shared;\n`,
  'lazy.js':`export const lazy='inlined lazy UI';\n`,
  'retained.js':`export const retained='standalone dependency';\n`,
  'standalone.js':`export const get=()=>import('./retained.js');\n`,
  'js/audio.js':`export const externalURL=import.meta.url; // keep unminified audio source\n`,
  'generated/chip.wasm':Buffer.from([0,97,115,109,1,0,0,0]),
  'sources/native/NOTICE.md':'Original native provenance\n',
  ...extra,
 };
 for(const[name,bytes]of Object.entries(files)){await mkdir(dirname(join(root,name)),{recursive:true});await writeFile(join(root,name),bytes);}
 return {root,files};
}

test('root UI bundle executes with exact original module URLs, Worker closure and byte-exact sources',async()=>{
 const {root,files}=await fixture();
 try{
  const result=await bundleItchPlaygroundRun(root);
  assert(result.passed);assert.deepEqual(result.removed,['lazy.js','ui.js']);
  assert(result.retainedBundledInputs.includes('worker-shared.js'));assert(result.retainedBundledInputs.includes('retained.js'));
  assert.match(result.entry.importURL,/^\.\/playground\.js\?v=run-bundle-[a-f0-9]{16}$/);
  const html=await readFile(join(root,'index.html'),'utf8');assert(html.includes(result.entry.importURL));assert(!html.includes('?v=old'));
  await import(pathToFileURL(join(root,'playground.js')).href+'?v=fixture');
  const actual=globalThis.__itchBundleTest;
  assert.equal(actual.moduleURL,pathToFileURL(join(root,'ui.js')).href+'?v=original-module');
  assert.equal(actual.literal,'import.meta.url');assert.equal(actual.name,'VisibleName');assert.equal(actual.lazy,'inlined lazy UI');
  assert.equal(actual.externalURL,pathToFileURL(join(root,'js/audio.js')).href+'?v=original-audio');
  assert.equal(actual.workerURL,pathToFileURL(join(root,'worker.js')).href);
  for(const name of ['LICENSE','THIRD_PARTY_LICENSES.txt','worker.js','worker-shared.js','retained.js','standalone.js','js/audio.js','generated/chip.wasm','sources/native/NOTICE.md'])assert.deepEqual(await readFile(join(root,name)),Buffer.from(files[name]),name);
  for(const name of result.removed)await assert.rejects(access(join(root,name)),{code:'ENOENT'});
  const originals=JSON.parse(execFileSync(process.env.PYTHON||'python3',['-c','import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:print(json.dumps({i.filename:z.read(i).decode() for i in z.infolist()}))',join(root,result.sourceArchive.path)],{encoding:'utf8'}));
  assert.deepEqual(Object.keys(originals).sort(),[...result.inputs.map(input=>input.path),'LICENSE','THIRD_PARTY_LICENSES.txt'].sort());
  for(const[name,source]of Object.entries(originals))assert.equal(source,files[name],'Archived original '+name);
  assert.match(await readFile(join(root,'playground.js.LEGAL.txt'),'utf8'),/Fixture UI legal notice/);
  const receipt=await readFile(join(root,'sources/browser-bundle.json'),'utf8');assert(!receipt.includes(root),'No temporary absolute paths in receipt');
  assert(!String(await readFile(join(root,'playground.js'))).includes(root),'No temporary absolute paths in output');
  await assert.rejects(bundleItchPlaygroundRun(root),/already bundled/);
 }finally{delete globalThis.__itchBundleTest;await rm(root,{recursive:true,force:true});}
});

test('an unknown root nonliteral import conservatively retains all bundled root inputs',async()=>{
 const {root,files}=await fixture({'unknown-worker.js':`export async function load(url){return import(url);}\n`});
 try{
  const result=await bundleItchPlaygroundRun(root);assert.deepEqual(result.removed,[]);
  assert(result.nonliteralDynamicImports.some(item=>item.path==='unknown-worker.js'&&item.policy==='retain all bundled root inputs'));
  for(const input of result.inputs.filter(input=>input.path!=='playground.js'))assert.deepEqual(await readFile(join(root,input.path)),Buffer.from(files[input.path]),input.path);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('stage symlinks and ambiguous startup imports are rejected',async()=>{
 const first=await fixture();
 try{await symlink(join(first.root,'ui.js'),join(first.root,'linked.js'));await assert.rejects(bundleItchPlaygroundRun(first.root),/symlinks/);assert.equal(await readFile(join(first.root,'playground.js'),'utf8'),first.files['playground.js']);}
 finally{await rm(first.root,{recursive:true,force:true});}
 const second=await fixture({'index.html':`<script type="module">import('./playground.js');import('./playground.js?v=two');</script>`});
 try{await assert.rejects(bundleItchPlaygroundRun(second.root),/exactly one/);assert.equal(await readFile(join(second.root,'playground.js'),'utf8'),second.files['playground.js']);}
 finally{await rm(second.root,{recursive:true,force:true});}
});
