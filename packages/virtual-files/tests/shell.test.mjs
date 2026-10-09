import test from 'node:test';
import assert from 'node:assert/strict';
import {createVirtualFileSystem,createShell,parseCommand} from '../src/index.js';
test('quoting handles empty arguments; shell operators are not evaluated',()=>{
  assert.deepEqual(parseCommand(`write '/lib/a b.js' ""`),['write','/lib/a b.js','']);
  assert.throws(()=>parseCommand('ls | cat'));
  assert.throws(()=>parseCommand(`cat 'unfinished`));
});
test('commands share files and cwd, preserve binary copies and execute sequentially',async()=>{
  const fs=createVirtualFileSystem([{path:'/index.js',data:'original'}]);fs.writeBinary('/a.bin',new Uint8Array([0,255]));
  const shell=createShell({fs});
  assert.equal((await shell.execute('mkdir /lib')).code,0);
  const cd=shell.execute('cd /lib'),write=shell.execute(`write 'a b.js' 'export const x = 1;'`);
  await cd;assert.equal((await write).code,0);
  assert.equal((await shell.execute(`cat 'a b.js'`)).stdout,'export const x = 1;');
  await shell.execute('cp /a.bin ./copy.bin');assert.deepEqual(fs.get('/lib/copy.bin').data,new Uint8Array([0,255]));
  await shell.execute('mv ./copy.bin ./renamed.bin');assert.equal(fs.has('/lib/copy.bin'),false);
  assert.equal((await shell.execute('unknown')).code,127);
  shell.register('count',({fs})=>String(fs.list().length));assert.equal((await shell.execute('count')).stdout,'4');
});
test('host policies and abort signals reject mutations',async()=>{
  const fs=createVirtualFileSystem([{path:'/index.js',data:'keep'}]);
  const shell=createShell({fs,authorize:()=>{throw Error('read-only');}});
  assert.equal((await shell.execute('rm /index.js')).code,1);assert.equal(fs.get('/index.js').data,'keep');
  const controller=new AbortController();controller.abort();
  assert.equal((await shell.execute('cat /index.js',{signal:controller.signal})).code,130);
});
test('replacing a project resets a missing cwd without leaking the subscription',async()=>{
  const fs=createVirtualFileSystem();fs.mkdir('/empty');
  const shell=createShell({fs});await shell.execute('cd /empty');
  fs.replace([{path:'/index.js',data:'new'}]);assert.equal(shell.cwd,'/');
  fs.mkdir('/temporary');await shell.execute('cd /temporary');shell.dispose();
  fs.remove('/temporary');assert.equal(shell.cwd,'/temporary');
});
