import test from 'node:test';
import assert from 'node:assert/strict';
import {createVirtualFileSystem,createShell,parsePipeline} from '../src/index.js';
function setup(authorize){const fs=createVirtualFileSystem([{path:'/input.txt',data:'first\nsetBpm(120)\nlast\n'},{path:'/out.txt',data:'keep'}]);return {fs,shell:createShell({fs,authorize})};}
test('operators parse without spaces; quotes, escapes and argument arrays remain literal',async()=>{
 assert.deepEqual(parsePipeline('echo "a|b"|cat ->out.txt'),[{args:['echo','a|b'],input:null,output:null},{args:['cat','-'],input:null,output:{path:'out.txt',append:false}}]);
 for(const input of ['echo x||cat -','| cat -','echo x |','echo x >','echo x << /input','echo x > a > b','echo x;pwd','echo x && pwd','echo x | cat - < input'])assert.throws(()=>parsePipeline(input),input);
 const {fs,shell}=setup();assert.equal((await shell.execute('echo "a|b > c"')).stdout,'a|b > c\n');assert.equal((await shell.execute('echo a\\|b')).stdout,'a|b\n');assert.equal((await shell.execute(['echo','|','>','<','>>'])).stdout,'| > < >>\n');
 assert.equal((await shell.execute('echo x|cat ->/new.txt')).code,0);assert.equal(fs.get('/new.txt').data,'x\n');
});
test('stdin consumers pipe and input redirects preserve separate stderr and stage codes',async()=>{
 const {shell}=setup();const result=await shell.execute('cat /input.txt | rg -F setBpm - | cat -');assert.equal(result.code,0);assert.match(result.stdout,/setBpm\(120\)/);assert.deepEqual(result.stages.map(s=>s.code),[0,0,0]);
 const range=await shell.execute('read --start 2 --end 2 - < /input.txt');assert.equal(range.stdout,'2\tsetBpm(120)\n');
 shell.register('noisy',()=>({code:0,stdout:'stdout\n',stderr:'warning\n'}));const separated=await shell.execute('noisy | cat -');assert.equal(separated.stdout,'stdout\n');assert.equal(separated.stderr,'warning\n');
 const json=await shell.execute(['pipeline','--json','echo hello | cat -']);assert.equal(json.code,0);assert.deepEqual(JSON.parse(json.stdout).stages.map(s=>s.code),[0,0]);
 const traced=await shell.execute(['echo','literal > text'],{reportStages:true});assert.equal(traced.stages.length,1);assert.equal(traced.stdout,'literal > text\n');
});
test('redirects commit only after all stages succeed, append atomically and retain binary/empty folders',async()=>{
 const {fs,shell}=setup();fs.mkdir('/empty');fs.writeBinary('/binary',new Uint8Array([0,255]));let events=0;fs.onDidChange(()=>events++);
 assert.equal((await shell.execute('echo new > /out.txt | unknown')).code,127);assert.equal(fs.get('/out.txt').data,'keep');assert.equal(events,0);
 assert.equal((await shell.execute('echo x | rg missing - > /out.txt')).code,1);assert.equal(fs.get('/out.txt').data,'keep');
 assert.equal((await shell.execute('echo new >> /out.txt')).code,0);assert.equal(fs.get('/out.txt').data,'keepnew\n');assert.equal(events,1);
 assert.equal((await shell.execute('echo replaced > /out.txt')).stdout,'');assert.equal(fs.get('/out.txt').data,'replaced\n');
 const before=fs.snapshot();assert.equal((await shell.execute('echo x > /good | echo y > /binary/child')).code,1);assert.deepEqual(fs.snapshot(),before);
 assert.equal((await shell.execute('echo x > /binary')).code,1);assert(fs.listDirectories().includes('/empty'));assert.deepEqual(fs.get('/binary').data,new Uint8Array([0,255]));
});
test('async output conflicts, cancellation and host policies preserve output targets',async()=>{
 const {fs,shell}=setup();let release,started;const ready=new Promise(resolve=>started=resolve);shell.register('wait',async()=>{started();await new Promise(resolve=>release=resolve);return 'generated';});
 const run=shell.execute('wait > /out.txt');await ready;fs.writeText('/out.txt','human');release();const result=await run;assert.equal(result.code,1);assert.match(result.stderr,/Redirect conflict/);assert.equal(fs.get('/out.txt').data,'human');
 const controller=new AbortController();shell.register('hang',()=>new Promise(()=>{}));const cancelled=shell.execute('hang > /out.txt',{signal:controller.signal});setTimeout(()=>controller.abort(),0);assert.equal((await cancelled).code,130);assert.equal(fs.get('/out.txt').data,'human');assert.equal((await shell.execute('pwd')).stdout,'/\n');
 const denied=setup(()=>{throw Error('read-only');});assert.equal((await denied.shell.execute('echo x > /out.txt')).code,1);assert.equal(denied.fs.get('/out.txt').data,'keep');
});
test('patch reads redirected JSON and pipeline errors do not execute later consumers',async()=>{
 const {fs,shell}=setup();fs.writeText('/changes.json',JSON.stringify([{path:'/out.txt',oldText:'keep',newText:'patched'}]));assert.equal((await shell.execute('patch - < /changes.json')).code,0);assert.equal(fs.get('/out.txt').data,'patched');
 let called=false;shell.register('after',()=>{called=true;});assert.equal((await shell.execute('missing | after')).code,127);assert.equal(called,false);
 shell.register('huge',()=> 'x'.repeat(1000001));assert.equal((await shell.execute('huge > /out.txt')).code,1);assert.equal(fs.get('/out.txt').data,'patched');
});
test('unsupported file descriptors reject before execution and pipeline paths use starting cwd',async()=>{
 const {fs,shell}=setup();assert.equal((await shell.execute('echo x 2>/out.txt')).code,1);assert.equal(fs.get('/out.txt').data,'keep');
 assert.equal((await shell.execute('echo "2">/out.txt')).code,0);assert.equal(fs.get('/out.txt').data,'2\n');
 fs.mkdir('/lib');await shell.execute('cd /lib | echo changed > out.txt');assert.equal(fs.get('/out.txt').data,'changed\n');assert.equal(fs.has('/lib/out.txt'),false);assert.equal(shell.cwd,'/lib');assert.equal((await shell.execute('pwd')).stdout,'/lib\n');
});
