// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createScspCodeProject} from './code_project.js';

test('fresh projects include readable Self code while existing project files remain user-owned',async()=>{
  const paths=['/examples/self-feedback.js','/examples/self-feedback-6op.js'];
  const fresh=createScspCodeProject({getStarterCode:()=> '// unchanged melody'});
  for(const path of paths){
    const source=await readFile(new URL('.'+path,import.meta.url),'utf8');
    assert.equal(fresh.fs.get(path).data,source);fresh.fs.writeText(path,'// user edit '+path);
  }
  assert.equal(fresh.fs.get('/index.js').data,'// unchanged melody');
  const copy=createScspCodeProject({snapshot:fresh.snapshot(),getStarterCode:()=>assert.fail('No reseeding')});
  for(const path of paths)assert.equal(copy.fs.get(path).data,'// user edit '+path);
  const empty=createScspCodeProject();
  const old=createScspCodeProject({snapshot:empty.snapshot(),getStarterCode:()=>assert.fail('No reseeding')});
  for(const path of paths)assert(!old.fs.has(path));
});
