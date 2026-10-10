import test from 'node:test';
import assert from 'node:assert/strict';
import {createVirtualFileSystem,applyTextPatch,diffSnapshots,createShell} from '../src/index.js';
const setup=()=>{const fs=createVirtualFileSystem([{path:'/index.js',data:'setBpm(120);\nplay("C4");\n'},{path:'/lib/a.js',data:'const a = 1;'}]);fs.mkdir('/empty');fs.writeBinary('/data.bin',new Uint8Array([0,255]));return fs;};
test('multi-file patch commits once, retains binary and empty directories, previews without changes',()=>{
 const fs=setup(),before=fs.snapshot();let events=0;fs.onDidChange(()=>events++);
 const edits=[{path:'/index.js',oldText:'120',newText:'140'},{path:'/lib/a.js',oldText:'1',newText:'2'},{type:'create',path:'/new/b.js',text:'new'},{type:'delete',path:'/lib/a.js',expectedText:'const a = 2;'}];
 assert.equal(applyTextPatch(fs,edits,{dryRun:true}).applied,false);assert.deepEqual(fs.snapshot(),before);assert.equal(events,0);
 assert.equal(applyTextPatch(fs,edits).changes.length,4);assert.equal(events,1);assert.match(fs.get('/index.js').data,/140/);assert.equal(fs.has('/lib/a.js'),false);assert.equal(fs.get('/new/b.js').data,'new');assert.deepEqual(fs.get('/data.bin').data,new Uint8Array([0,255]));assert(fs.listDirectories().includes('/empty'));
});
test('a later conflict, authorization or malformed operation leaves every file unchanged',()=>{
 const fs=setup(),before=fs.snapshot(),first={path:'/index.js',oldText:'120',newText:'140'};
 for(const last of [{path:'/lib/a.js',oldText:'missing',newText:'2'},{type:'create',path:'/data.bin',text:'bad'},{type:'create',path:'/lib/a.js/child',text:'bad'},{type:'delete',path:'/lib/a.js',expectedText:'stale'},{path:'/data.bin',oldText:'x',newText:'y'},{path:'/lib/a.js',oldText:'1',newText:'2',newtext:'typo'}]){
  assert.throws(()=>applyTextPatch(fs,[first,last]));assert.deepEqual(fs.snapshot(),before);
 }
 assert.throws(()=>applyTextPatch(fs,[first],{authorize(){throw Error('denied');}}));assert.deepEqual(fs.snapshot(),before);
 const calls=[];assert.throws(()=>applyTextPatch(fs,[first,{type:'delete',path:'/lib/a.js',expectedText:'const a = 1;'}],{authorize(op){calls.push(op);if(op==='rm')throw Error('protected');}}));assert.deepEqual(calls,['patch','rm']);assert.deepEqual(fs.snapshot(),before);
});
test('patch and diff shell operate with stdin, cwd, snapshots and pagination',async()=>{
 const fs=setup(),shell=createShell({fs,cwd:'/lib'});await shell.execute('snapshot baseline');
 const patch=JSON.stringify([{path:'a.js',oldText:'1',newText:'2'},{type:'create',path:'b.js',text:'const b = 3;'}]);
 const preview=await shell.execute(['patch','--json','--dry-run','-'],{stdin:patch});assert.equal(preview.code,0,preview.stderr);assert.equal(JSON.parse(preview.stdout).applied,false);
 assert.equal((await shell.execute(['patch','--json','-'],{stdin:patch})).code,0);
 const changed=await shell.execute('diff --json --limit 1 baseline /lib');const page=JSON.parse(changed.stdout);assert.equal(page.total,2);assert.equal(page.nextOffset,1);assert.match(page.entries[0].hunk,/-const a = 1;/);assert.match(page.entries[0].hunk,/\+const a = 2;/);
 const second=JSON.parse((await shell.execute('diff --json --offset 1 baseline /lib')).stdout);assert.equal(second.entries[0].status,'added');assert.equal(second.entries[0].path,'/lib/b.js');
 assert.deepEqual(JSON.parse((await shell.execute('snapshot --list')).stdout),['baseline']);shell.clearSnapshots();assert.equal((await shell.execute('diff')).code,1);
 for(let i=0;i<8;i++)assert.equal((await shell.execute(['snapshot',String(i)])).code,0);assert.equal((await shell.execute('snapshot overflow')).code,1);await shell.execute('snapshot --remove 0');assert.equal((await shell.execute('snapshot overflow')).code,0);
});
test('diff reports binary, empty-directory and text changes without touching live files',()=>{
 const fs=setup(),before=fs.snapshot();fs.writeBinary('/data.bin',new Uint8Array([7]));fs.remove('/empty');fs.mkdir('/new');fs.writeText('/index.js','changed\n');const after=fs.snapshot();
 const changes=diffSnapshots(before,after);assert.equal(changes.find(c=>c.path==='/data.bin').beforeType,'binary');assert(!changes.find(c=>c.path==='/data.bin').hunk);assert.equal(changes.find(c=>c.path==='/empty').status,'removed');assert.equal(changes.find(c=>c.path==='/new').afterType,'directory');assert.deepEqual(fs.snapshot(),after);
 assert.equal(diffSnapshots(before,before).length,0);
 fs.writeText('/index.js','x'.repeat(30000));const large=diffSnapshots(before,fs.snapshot()).find(c=>c.path==='/index.js');assert(large.hunkTruncated);assert(large.hunk.length<2200);
});
test('abort and protected shell policy reject entire patch',async()=>{
 const fs=setup(),shell=createShell({fs,authorize(op,paths){if(paths.includes('/index.js'))throw Error('protected');}}),before=fs.snapshot();
 const edits=[{path:'/lib/a.js',oldText:'1',newText:'2'},{path:'/index.js',oldText:'120',newText:'140'}];
 assert.equal((await shell.execute(['patch','-'],{stdin:JSON.stringify(edits)})).code,1);assert.deepEqual(fs.snapshot(),before);
 const controller=new AbortController();controller.abort();assert.equal((await shell.execute(['patch','-'],{stdin:JSON.stringify(edits),signal:controller.signal})).code,130);assert.deepEqual(fs.snapshot(),before);
});
test('deletion authorizes each path so legacy single-target policies also protect a later entry',()=>{
 const fs=setup(),before=fs.snapshot();const edits=[{type:'delete',path:'/lib/a.js',expectedText:'const a = 1;'},{type:'delete',path:'/index.js',expectedText:fs.get('/index.js').data}];
 assert.throws(()=>applyTextPatch(fs,edits,{authorize(op,paths){if(op==='rm'&&paths[0]==='/index.js')throw Error('entry point');}}),/entry point/);assert.deepEqual(fs.snapshot(),before);
});
