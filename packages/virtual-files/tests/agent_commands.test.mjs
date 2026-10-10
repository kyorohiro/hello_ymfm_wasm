import test from 'node:test';
import assert from 'node:assert/strict';
import {createShell,createVirtualFileSystem} from '../src/index.js';
function setup(authorize){const fs=createVirtualFileSystem([{path:'/src/a.js',data:'setBpm(120);\nconst value = 1;\nplay("C4");\n'},{path:'/src/b.js',data:'setBpm(90);\nplay("D4");'},{path:'/README.md',data:'setBpm guide'}]);fs.mkdir('/empty');fs.writeBinary('/src/sample.bin',new Uint8Array([0,255]));return {fs,shell:createShell({fs,cwd:'/src',authorize})};}
const json=async(shell,args)=>{const r=await shell.execute(args);assert.equal(r.code,0,r.stderr);return JSON.parse(r.stdout);};
test('find scopes traversal, glob and type filters; paged JSON is deterministic',async()=>{
 const {shell}=setup();const result=await json(shell,['find','-name','*.js','-type','f','--json','--limit','1']);
 assert.equal(result.total,2);assert.equal(result.truncated,true);assert.equal(result.nextOffset,1);assert.equal(result.entries[0].path,'/src/a.js');
 const next=await json(shell,['find','-name','*.js','-type','f','--json','--offset','1']);assert.equal(next.nextOffset,null);assert.equal(next.entries[0].path,'/src/b.js');
 const dirs=await json(shell,['find','/','-type','d','--json']);assert(dirs.entries.some(e=>e.path==='/empty'));
 assert.equal((await shell.execute('find /missing')).code,1);
});
test('rg uses literal matching, honors scope, skips binary and reports line numbers',async()=>{
 const {shell}=setup();const matches=await json(shell,['rg','-n','-F','--json','setBpm(']);
 assert.equal(matches.total,2);assert.deepEqual(matches.entries.map(e=>[e.path,e.line]),[['/src/a.js',1],['/src/b.js',1]]);
 const one=await json(shell,['rg','-i','--json','--limit','1','PLAY']);assert.equal(one.nextOffset,1);
 const second=await json(shell,['rg','-i','--json','--offset','1','PLAY']);assert.equal(second.entries[0].path,'/src/b.js');
 assert.deepEqual((await json(shell,['rg','-l','--json','setBpm','/'])).entries.map(e=>e.path),['/README.md','/src/a.js','/src/b.js']);
 const missing=await shell.execute('rg nonexistent');assert.equal(missing.code,1);assert.equal(missing.stderr,'');
 assert.equal((await shell.execute(['rg',''])).code,1);
});
test('search output is bounded and pagination does not lose matches',async()=>{
 const {fs,shell}=setup();fs.writeText('/many.txt',Array(80).fill('x'.repeat(2000)).join('\n'));
 const first=await json(shell,['rg','--json','x','/many.txt']);assert(first.entries.length<80);assert.equal(first.total,80);assert(first.entries.every(e=>e.textTruncated));assert(first.entries.every(e=>e.text.length===1000));assert(first.truncated);
 const next=await json(shell,['rg','--json','--offset',String(first.nextOffset),'x','/many.txt']);assert.equal(next.entries[0].line,first.entries.at(-1).line+1);
 assert(first.entries.length<=100);assert(first.entries.reduce((n,e)=>n+e.text.length,0)<=16000);
});
test('read returns exact numbered ranges, EOF and explicit truncation metadata',async()=>{
 const {fs,shell}=setup();const r=await json(shell,['read','--json','--start','2','--end','2','a.js']);assert.deepEqual(r.lines,[{line:2,text:'const value = 1;'}]);assert.equal(r.totalLines,3);assert.equal(r.nextLine,3);
 assert.equal((await json(shell,['read','--json','--start','10','a.js'])).truncated,false);
 fs.writeText('/empty.txt','');assert.deepEqual((await json(shell,['read','--json','/empty.txt'])).lines,[]);
 assert.equal((await shell.execute('read sample.bin')).code,1);
 fs.writeText('/long.txt','x'.repeat(30)+'\nend');const partial=await json(shell,['read','--json','--max-chars','10','/long.txt']);assert.equal(partial.lines[0].text.length,9);assert.equal(partial.nextLine,1);
 assert.equal((await shell.execute('read --start 0 a.js')).code,1);
});
test('edit refuses ambiguous or stale matches, previews, and preserves unrelated edits',async()=>{
 const {fs,shell}=setup();let changes=0;fs.onDidChange(()=>changes++);
 const preview=await json(shell,['edit','--dry-run','--json','a.js','120','140']);assert.equal(preview.applied,false);assert.equal(changes,0);
 const applied=await json(shell,['edit','--json','a.js','120','140']);assert.equal(applied.applied,true);assert.equal(changes,1);
 const stale=await shell.execute(['edit','a.js','120','160']);assert.equal(stale.code,1);assert.match(stale.stderr,/Edit conflict/);assert.equal(changes,1);
 fs.writeText('/dup.txt','same same');const before=fs.snapshot();assert.equal((await shell.execute(['edit','/dup.txt','same','new'])).code,1);assert.deepEqual(fs.snapshot(),before);
 await shell.execute(['edit','--expect','2','/dup.txt','same','new']);assert.equal(fs.get('/dup.txt').data,'new new');
 assert.equal((await shell.execute(['edit','a.js','','bad'])).code,1);assert.equal((await shell.execute(['edit','sample.bin','x','y'])).code,1);
});
test('edit obeys host policies, aborts, nested sessions and literal argument arrays',async()=>{
 const {fs,shell}=setup((op,paths)=>{assert.equal(op,'edit');assert.deepEqual(paths,['/src/a.js']);throw Error('read-only');});
 assert.equal((await shell.execute(['edit','a.js','120','140'])).code,1);assert.match(fs.get('/src/a.js').data,/120/);
 const controller=new AbortController();controller.abort();assert.equal((await shell.execute('read a.js',{signal:controller.signal})).code,130);
 const other=setup();let session;other.shell.register('nested',async ctx=>{session=ctx;return ctx.execute(['edit','a.js','play("C4")','play("; | D4")']);});assert.equal((await other.shell.execute('nested')).code,0);assert.match(other.fs.get('/src/a.js').data,/; \| D4/);
 assert.equal((await session.execute(['edit','a.js','120','160'])).code,1);
 const commands=await json(other.shell,['help','--json']);assert(commands.some(c=>c.name==='read'&&c.usage.includes('--start')));assert.match((await other.shell.execute('help edit')).stdout,/--expect/);
});
test('large searches can be stopped and release the shell queue',async()=>{
 const fs=createVirtualFileSystem([{path:'/large.txt',data:'match\n'.repeat(20000)}]),shell=createShell({fs});
 const controller=new AbortController();const search=shell.execute(['rg','match'],{signal:controller.signal});
 setTimeout(()=>controller.abort(),0);assert.equal((await search).code,130);assert.equal((await shell.execute('pwd')).stdout,'/\n');
});
test('search excerpts include a match beyond a long line prefix',async()=>{
 const fs=createVirtualFileSystem([{path:'/long.txt',data:'x'.repeat(3000)+'needle'+'y'.repeat(2000)}]),shell=createShell({fs});
 const r=await json(shell,['rg','--json','needle']);assert.equal(r.entries[0].column,3001);assert.equal(r.entries[0].snippetStartColumn,2801);assert(r.entries[0].text.includes('needle'));assert(r.entries[0].textTruncated);
});
