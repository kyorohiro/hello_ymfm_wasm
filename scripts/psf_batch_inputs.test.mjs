// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,realpath,rm,symlink,rename,truncate,utimes} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {collectPsfBatchInputs,loadPsfBatchEntry} from './psf_batch_inputs.mjs';
import {composePsfRam,psfCrc32,readPsfFileSet} from '../docs/playground/playground_ps1_psf.js';

function psf(tags='',value=1,version=1) {
  const exe=Buffer.alloc(0x804);exe.write('PS-X EXE');exe.writeUInt32LE(0x80010000,0x10);
  exe.writeUInt32LE(0x80010000,0x18);exe.writeUInt32LE(4,0x1c);exe[0x800]=value;
  const compressed=deflateSync(exe),header=Buffer.alloc(16);header.write('PSF');header[3]=version;
  header.writeUInt32LE(compressed.length,8);header.writeUInt32LE(psfCrc32(compressed),12);
  return Buffer.concat([header,compressed,Buffer.from(`[TAG]${tags}`)]);
}
async function fixture(t,values) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'psf-batch-inputs-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  for(const [name,bytes] of Object.entries(values)) {
    await mkdir(path.dirname(path.join(directory,name)),{recursive:true});
    await writeFile(path.join(directory,name),bytes);
  }
  return realpath(directory);
}
const code=value=>error=>error.code===value;

test('discovery is deterministic and bad unrelated containers remain per-entry failures',async t=>{
  const corrupt=psf();corrupt[12]^=1;
  const directory=await fixture(t,{'z.psf':psf('title=Last'),'a/one.minipsf':psf('title=First'),
    'a/base.psflib':psf(),'bad.psf':corrupt,'small.psf':new Uint8Array(2),'notes.txt':'not a PSF'});
  await writeFile(path.join(directory,'large.psf'),'');await truncate(path.join(directory,'large.psf'),4*1024*1024+1);
  const input=await collectPsfBatchInputs(directory);
  assert.equal(input.root,directory);
  assert.deepEqual(input.files.map(value=>value.path),['a/base.psflib','a/one.minipsf','bad.psf','large.psf','small.psf','z.psf']);
  assert.deepEqual(input.entries,['a/one.minipsf','bad.psf','large.psf','small.psf','z.psf']);
  assert.equal(input.visited,8);assert.equal(input.warnings.length,0);
  assert.equal(input.inputBytes-input.budgetedInputBytes,4*1024*1024+3);
  const loaded=await loadPsfBatchEntry(input.root,input.files,'a/one.minipsf');
  assert.equal(loaded.title,'First');assert.deepEqual(loaded.sources.map(value=>value.path),['a/one.minipsf']);
  const bytes=await readFile(path.join(directory,'a/one.minipsf'));
  assert.deepEqual(loaded.sources[0],{path:'a/one.minipsf',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  for(const name of ['bad.psf','large.psf','small.psf'])await assert.rejects(loadPsfBatchEntry(input.root,input.files,name),code('invalid-container'));
});

test('closure keeps existing path/casefold, contiguous auxiliary and overlay semantics',async t=>{
  const values={'songs/one.minipsf':psf('title=Song\n_lib=..\\libs\\base.PSFLIB\n_lib2=./patch.psflib\n_lib4=absent.psflib',2),
    'libs/BASE.psflib':psf('_refresh=50',1),'songs/patch.psflib':psf('',3),'unrelated.psf':Buffer.alloc(0)};
  const directory=await fixture(t,values),input=await collectPsfBatchInputs(directory);
  const loaded=await loadPsfBatchEntry(input.root,input.files,'songs/one.minipsf');
  assert.deepEqual(loaded.sources.map(value=>value.path),['libs/BASE.psflib','songs/one.minipsf','songs/patch.psflib']);
  const expected=await readPsfFileSet(Object.entries(values).filter(([name])=>name!=='unrelated.psf').map(([name,bytes])=>({
    name,webkitRelativePath:name,size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)})));
  const actualImage=await composePsfRam(loaded.set,loaded.entry),expectedImage=await composePsfRam(expected,loaded.entry);
  assert.deepEqual(actualImage,expectedImage);assert.equal(actualImage.ram[0x10000],3);assert.equal(actualImage.refresh,50);
});

test('unused case collisions stay ambiguous, while an exact requested spelling wins',async t=>{
  const directory=await fixture(t,{'one.minipsf':psf('_lib=lib.psflib'),'exact.minipsf':psf('_lib=Lib.psflib'),
    'Lib.psflib':psf('title=A')});
  const input=await collectPsfBatchInputs(directory);
  // Inject an unread unused case twin so this also runs on case-insensitive
  // filesystems. A real case-sensitive directory produces the same manifest.
  input.files.push({...input.files.find(value=>value.path==='Lib.psflib'),path:'LIB.psflib'});
  await assert.rejects(loadPsfBatchEntry(input.root,input.files,'one.minipsf'),code('ambiguous-library'));
  const exact=await loadPsfBatchEntry(input.root,input.files,'exact.minipsf');
  assert.deepEqual(exact.sources.map(value=>value.path),['Lib.psflib','exact.minipsf']);
  assert.equal(exact.set.folded.get('lib.psflib'),null);
});

test('missing, escaping, absolute and control library references fail locally',async t=>{
  const directory=await fixture(t,{'good.psf':psf(),'missing.psf':psf('_lib=absent.psflib'),
    'escape.psf':psf('_lib=../outside.psflib'),'absolute.psf':psf('_lib=/outside.psflib'),
    'control.psf':psf('_lib=bad\x01name.psflib'),'wrong.psf':psf('',1,2)});
  const input=await collectPsfBatchInputs(directory);
  await assert.rejects(loadPsfBatchEntry(input.root,input.files,'missing.psf'),code('missing-library'));
  for(const name of ['escape.psf','absolute.psf','control.psf'])await assert.rejects(loadPsfBatchEntry(input.root,input.files,name),code('invalid-path'));
  await assert.rejects(loadPsfBatchEntry(input.root,input.files,'wrong.psf'),code('unsupported-psf-version'));
  await assert.rejects(loadPsfBatchEntry(input.root,input.files,'../good.psf'),code('invalid-path'));
  await loadPsfBatchEntry(input.root,input.files,'good.psf');
});

test('cycles and depth/visit limits match the loader rather than recursion exhaustion',async t=>{
  const values={'cycle.psf':psf('_lib=cycle.psf'),'depth.psf':psf('_lib=lib0.psflib'),
    'visits.psf':psf(Array.from({length:257},(_,index)=>`_lib${index?index+1:''}=leaf.psflib`).join('\n')),
    'leaf.psflib':psf()};
  for(let index=0;index<10;index++)values[`lib${index}.psflib`]=psf(index<9?`_lib=lib${index+1}.psflib`:'');
  const directory=await fixture(t,values),input=await collectPsfBatchInputs(directory);
  await assert.rejects(loadPsfBatchEntry(input.root,input.files,'cycle.psf'),code('invalid-container'));
  for(const name of ['depth.psf','visits.psf'])await assert.rejects(loadPsfBatchEntry(input.root,input.files,name),code('input-limit'));
});

test('changed files and replaced symlink files/parents fail before reading new targets',async t=>{
  const directory=await fixture(t,{'one.psf':psf('title=Old'),'nested/two.psf':psf('title=Two'),'target.psf':psf('title=Target')});
  const input=await collectPsfBatchInputs(directory);
  await utimes(path.join(directory,'one.psf'),new Date(1000),new Date(1000));
  await assert.rejects(loadPsfBatchEntry(input.root,input.files,'one.psf'),code('input-changed'));
  await rm(path.join(directory,'target.psf'));await symlink('one.psf',path.join(directory,'target.psf'));
  await assert.rejects(loadPsfBatchEntry(input.root,input.files,'target.psf'),code('input-changed'));
  await rename(path.join(directory,'nested'),path.join(directory,'saved'));await symlink('saved',path.join(directory,'nested'));
  await assert.rejects(loadPsfBatchEntry(input.root,input.files,'nested/two.psf'),code('input-changed'));
});

test('symlink discovery is bounded and never descends into linked trees',async t=>{
  const directory=await fixture(t,{'one.psf':psf(),'nested/two.psf':psf()});
  await symlink('.',path.join(directory,'loop'));
  for(let index=0;index<70;index++)await symlink('one.psf',path.join(directory,`link${index}.psf`));
  const input=await collectPsfBatchInputs(directory);
  assert.deepEqual(input.entries,['nested/two.psf','one.psf']);assert.equal(input.warnings.length,64);
  assert.equal(input.warnings.at(-1),'Further input warnings omitted.');
});

test('matching-file, readable-byte and directory-depth budgets fail explicitly',async t=>{
  const directory=await fixture(t,{});
  await Promise.all(Array.from({length:513},(_,index)=>writeFile(path.join(directory,`${index}.psf`),'')));
  await assert.rejects(collectPsfBatchInputs(directory),code('input-limit'));
  await rm(directory,{recursive:true,force:true});await mkdir(directory);
  for(let index=0;index<17;index++) {
    const name=path.join(directory,`${index}.psf`);await writeFile(name,'');await truncate(name,4*1024*1024);
  }
  await assert.rejects(collectPsfBatchInputs(directory),code('input-limit'));
  await rm(directory,{recursive:true,force:true});await mkdir(directory);
  let nested=directory;for(let index=0;index<65;index++){nested=path.join(nested,'d');await mkdir(nested);}
  await assert.rejects(collectPsfBatchInputs(directory),code('input-limit'));
});

test('already-aborted discovery/loading performs no input work',async t=>{
  const directory=await fixture(t,{'one.psf':psf()}),input=await collectPsfBatchInputs(directory);
  const controller=new AbortController();controller.abort();
  await assert.rejects(collectPsfBatchInputs(directory,{signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(loadPsfBatchEntry(input.root,input.files,'one.psf',{signal:controller.signal}),{name:'AbortError'});
});
