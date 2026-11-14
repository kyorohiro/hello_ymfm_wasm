// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('./build_spu_import_demos.mjs',import.meta.url));
const originals=fileURLToPath(new URL('../docs/playground/samples/spu-import/',import.meta.url));
async function snapshot(root,prefix='') {
  const files=[];
  for(const item of await readdir(join(root,prefix),{withFileTypes:true})) {
    const name=prefix+item.name;
    if(item.isDirectory()) files.push(...await snapshot(root,name+'/'));
    else files.push([name,await readFile(join(root,name))]);
  }
  return files.sort(([a],[b])=>a.localeCompare(b));
}

test('demo CLI generates and checks package-local files without rewriting source samples',async t=>{
  const temp=await mkdtemp(join(tmpdir(),'spu demo output '));
  t.after(()=>rm(temp,{recursive:true,force:true}));
  const before=await snapshot(originals),out=join(temp,'package samples');
  const generated=JSON.parse(execFileSync(process.execPath,[script,'--out-dir='+out],{cwd:temp,encoding:'utf8'}));
  assert.equal(generated.directory,out);assert(generated.files>0);
  assert((await snapshot(out)).some(([name])=>name==='standalone.psf'));
  assert((await snapshot(out)).some(([name])=>name==='spu-psf-demo.zip'));
  const checked=JSON.parse(execFileSync(process.execPath,[script,'--check','--out-dir='+out],{cwd:temp,encoding:'utf8'}));
  assert.equal(checked.check,true);assert.equal(checked.files,generated.files);
  assert.deepEqual(await snapshot(originals),before);
});

test('demo CLI rejects ambiguous or empty output options before creating files',async t=>{
  const temp=await mkdtemp(join(tmpdir(),'spu demo invalid '));
  t.after(()=>rm(temp,{recursive:true,force:true}));
  const out=join(temp,'must not exist');
  for(const args of [['--out-dir='],['--out-dir='+out,'--out-dir='+out],['--unknown']])
    assert.throws(()=>execFileSync(process.execPath,[script,...args],{cwd:temp,stdio:'pipe'}));
  assert.deepEqual(await readdir(temp),[]);
});
