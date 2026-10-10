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
test('agent edit uses the guarded session and cannot change reserved or stale files',async()=>{
 const {fs,session,end}=setup();fs.writeText('/sys/readme.txt','reserved');const shell=createShell({fs});
 assert.equal((await shell.execute(['edit','/index.js','initial','updated'],{fs:session.facade})).code,0);
 assert.equal(fs.get('/index.js').data,'updated');
 assert.equal((await shell.execute(['edit','/sys/readme.txt','reserved','bad'],{fs:session.facade})).code,1);
 assert.equal(fs.get('/sys/readme.txt').data,'reserved');
 end();assert.equal((await shell.execute(['edit','/index.js','updated','bad'],{fs:session.facade})).code,1);
 assert.equal(fs.get('/index.js').data,'updated');
});
test('atomic patches honor session reserved paths and retain the project entry point',async()=>{
 const {fs,session}=setup();fs.writeText('/sys/locked','reserved');const shell=createShell({fs});
 const before=fs.snapshot();const failed=[{path:'/scripts/main.js',oldText:'script',newText:'changed'},{path:'/sys/locked',oldText:'reserved',newText:'bad'}];
 assert.equal((await shell.execute(['patch','-'],{stdin:JSON.stringify(failed),fs:session.facade})).code,1);assert.deepEqual(fs.snapshot(),before);
 const remove=[{type:'delete',path:'/index.js',expectedText:'initial'}];assert.equal((await shell.execute(['patch','-'],{stdin:JSON.stringify(remove),fs:session.facade})).code,1);assert.equal(fs.has('/index.js'),true);
 const edits=[{path:'/index.js',oldText:'initial',newText:'updated'},{path:'/scripts/main.js',oldText:'script',newText:'changed'}];assert.equal((await shell.execute(['patch','-'],{stdin:JSON.stringify(edits),fs:session.facade})).code,0);assert.equal(fs.get('/index.js').data,'updated');assert.equal(fs.get('/scripts/main.js').data,'changed');
});
test('pipeline redirection uses guarded files and protects /sys',async()=>{
 const {fs,session}=setup();fs.writeText('/sys/locked','reserved');const shell=createShell({fs});const before=fs.snapshot();
 assert.equal((await shell.execute('echo bad > /sys/locked',{fs:session.facade})).code,1);assert.deepEqual(fs.snapshot(),before);
 assert.equal((await shell.execute('echo good | cat - > /scripts/out.txt',{fs:session.facade})).code,0);assert.equal(fs.get('/scripts/out.txt').data,'good\n');
});
test('script sessions reject ABA and delete/recreate, including an observed missing path',()=>{
 const {fs,session}=setup();session.facade.get('/index.js');
 fs.writeText('/index.js','human');fs.writeText('/index.js','initial');
 assert.throws(()=>session.facade.writeText('/index.js','bad'),/changed during/);
 session.facade.get('/index.js');const revision=session.invoke('getRevision',['/index.js']);
 session.facade.writeText('/index.js','accepted',{expectedRevision:revision});
 session.facade.get('/scripts/main.js');fs.delete('/scripts/main.js');fs.writeText('/scripts/main.js','script');
 assert.throws(()=>session.facade.delete('/scripts/main.js'),/changed during/);
 session.facade.get('/new');fs.writeText('/new','human');fs.delete('/new');
 assert.throws(()=>session.facade.writeText('/new','bad'),/changed during/);
 session.facade.get('/new');session.facade.writeText('/new','accepted',{expectedRevision:fs.getRevision('/new')});
});
