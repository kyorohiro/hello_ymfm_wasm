import test from 'node:test';
import assert from 'node:assert/strict';
import {createVirtualFileSystem,createShell,parseCommand} from '../src/index.js';
import {parseRmArgs} from '../src/shell.js';
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
test('nested commands execute without waiting for their parent and accept safe argument arrays',async()=>{
  const fs=createVirtualFileSystem();const shell=createShell({fs});
  let context;
  shell.register('script',async ctx=>{context=ctx;return ctx.execute(['write','/a b.js','literal ; | text']);});
  assert.equal((await shell.execute('script')).code,0);
  assert.equal(fs.get('/a b.js').data,'literal ; | text');
  assert.equal((await context.execute(['write','/late','bad'])).code,1);assert.equal(fs.has('/late'),false);
});
test('abort releases the command queue even when a custom command never settles',async()=>{
  const fs=createVirtualFileSystem();const shell=createShell({fs});
  let started=false;shell.register('hang',()=>{started=true;return new Promise(()=>{});});
  const controller=new AbortController();const pending=shell.execute('hang',{signal:controller.signal});
  while(!started)await Promise.resolve();controller.abort();
  assert.equal((await pending).code,130);assert.equal((await shell.execute('pwd')).code,0);
});
test('rm accepts recursive and force aliases, including grouped flags',async()=>{
  for(const flags of ['-r','-R','--recursive','-rf','-fr','-Rf','-fR','-r --force','--force --recursive']){
    const fs=createVirtualFileSystem([{path:'/lib/nested/file.txt',data:'remove'}]);
    fs.writeBinary('/lib/data.bin',new Uint8Array([0,255]));
    const shell=createShell({fs});
    assert.equal((await shell.execute(`rm ${flags} /lib`)).code,0,flags);
    assert.equal(fs.has('/lib/nested/file.txt'),false,flags);
    assert.equal(fs.has('/lib/data.bin'),false,flags);
    assert.equal(fs.listDirectories().includes('/lib'),false,flags);
    shell.dispose();
  }
  assert.deepEqual(parseRmArgs(['file','-fr']),{path:'file',recursive:true,force:true});
});
test('rm force ignores missing paths without hiding real filesystem errors',async()=>{
  const fs=createVirtualFileSystem([{path:'/nonempty/file.txt',data:'keep'}]);
  const shell=createShell({fs});
  assert.equal((await shell.execute('rm -f /missing')).code,0);
  assert.equal((await shell.execute('rm --force /missing/child')).code,0);
  assert.equal((await shell.execute('rm -rf /missing')).code,0);
  assert.equal((await shell.execute('rm /missing')).code,1);
  assert.equal((await shell.execute('rm -f /nonempty')).code,1);
  assert.equal((await shell.execute('rm -rf /')).code,1);
  assert.equal(fs.get('/nonempty/file.txt').data,'keep');
});
test('rm validates all options and arity before authorizing or removing a target',async()=>{
  const fs=createVirtualFileSystem([{path:'/keep.txt',data:'keep'}]);let authorized=0;
  const shell=createShell({fs,authorize:()=>{authorized++;}});
  for(const args of [[],['-f'],['-rf'],[''],['/keep.txt','/second'],['/keep.txt','--bogus'],['-rv','/keep.txt'],['--force=1','/keep.txt']]){
    assert.equal((await shell.execute(['rm',...args])).code,1,JSON.stringify(args));
    assert.equal(fs.get('/keep.txt').data,'keep');
  }
  assert.equal(authorized,0);
});
test('rm -- permits paths that begin with an option character',async()=>{
  const fs=createVirtualFileSystem([{path:'/-rf',data:'first'},{path:'/-',data:'second'}]);
  const shell=createShell({fs});
  assert.equal((await shell.execute('rm -- -rf')).code,0);
  assert.equal(fs.has('/-rf'),false);
  assert.equal((await shell.execute('rm -')).code,0);
  assert.equal(fs.has('/-'),false);
  assert.deepEqual(parseRmArgs(['--','--force']),{path:'--force',recursive:false,force:false});
});
test('rm force still authorizes an existing normalized target before removal',async()=>{
  const fs=createVirtualFileSystem([{path:'/lib/file.txt',data:'keep'}]);const calls=[];
  const shell=createShell({fs,authorize:(operation,paths)=>{calls.push({operation,paths});throw Error('protected');}});
  assert.equal((await shell.execute('rm -rf /lib/../lib')).stderr,'protected');
  assert.equal(fs.get('/lib/file.txt').data,'keep');
  assert.deepEqual(calls,[{operation:'rm',paths:['/lib']}]);
  assert.equal((await shell.execute('rm -f /missing')).code,0);
  assert.equal(calls.length,1);
});
