import test from 'node:test';
import assert from 'node:assert/strict';
import {createVirtualFileSystem,createShell} from '../js/tetorica_virtual_files/index.js';
import {createShellFileSession} from './playground_shell_session.js';

function setup(){
  const fs=createVirtualFileSystem([{path:'/index.js',data:'initial'},{path:'/scripts/main.js',data:'script'}]);
  let active=true;const context={resolve:path=>path.startsWith('/')?path:'/scripts/'+path,assertActive(){if(!active)throw Error('ended');}};
  return {fs,session:createShellFileSession({fs,context}),end(){active=false;}};
}
test('observed reads permit writes, but concurrent human edits are retained',()=>{
  const {fs,session}=setup();
  assert.equal(session.facade.readFile('/index.js'),'initial');
  fs.writeText('/index.js','human');
  assert.throws(()=>session.facade.writeText('/index.js','script'),/changed during/);
  assert.equal(fs.get('/index.js').data,'human');
  session.facade.readFile('/index.js');session.facade.writeText('/index.js','accepted');
  assert.equal(fs.get('/index.js').data,'accepted');
});
test('facade blocks reserved paths and whole-project APIs; stale sessions cannot mutate',()=>{
  const {fs,session,end}=setup();
  assert.throws(()=>session.invoke('replace',[[]]),/Unsupported/);
  assert.throws(()=>session.facade.writeText('/sys/changed','bad'),/read-only/);
  assert.throws(()=>session.facade.remove('/index.js'),/entry point/);
  assert.throws(()=>session.facade.rename('/index.js','/other.js'),/entry point/);
  end();assert.throws(()=>session.facade.writeText('/late.js','bad'),/ended/);assert.equal(fs.has('/late.js'),false);
});
test('destructive directory operations refuse newly added human files',()=>{
  const {fs,session}=setup();fs.writeText('/scripts/new.js','human');
  assert.throws(()=>session.facade.remove('/scripts',{recursive:true}),/changed during/);
  assert.equal(fs.has('/scripts/new.js'),true);
  session.facade.writeText('/work/a.js','own');session.facade.remove('/work',{recursive:true});
  assert.equal(fs.has('/work/a.js'),false);
});
test('nested builtins use the guarded facade for writes',async()=>{
  const {fs,session}=setup();const shell=createShell({fs});
  shell.register('script',async context=>{fs.writeText('/index.js','human');return context.execute(['write','/index.js','bad'],{fs:session.facade});});
  assert.equal((await shell.execute('script')).code,1);assert.equal(fs.get('/index.js').data,'human');
});
