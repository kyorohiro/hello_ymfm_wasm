// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createScspCodeProject} from './code_project.js';

test('fresh projects include readable Self code while existing project files remain user-owned',async()=>{
  const path='/examples/self-feedback.js';
  const source=await readFile(new URL('./examples/self-feedback.js',import.meta.url),'utf8');
  const fresh=createScspCodeProject({getStarterCode:()=> '// unchanged melody'});
  assert.equal(fresh.fs.get(path).data,source);assert.equal(fresh.fs.get('/index.js').data,'// unchanged melody');
  fresh.fs.writeText(path,'// user edit');
  const copy=createScspCodeProject({snapshot:fresh.snapshot(),getStarterCode:()=>assert.fail('No reseeding')});
  assert.equal(copy.fs.get(path).data,'// user edit');
  const empty=createScspCodeProject();
  const old=createScspCodeProject({snapshot:empty.snapshot(),getStarterCode:()=>assert.fail('No reseeding')});
  assert(!old.fs.has(path));
});
