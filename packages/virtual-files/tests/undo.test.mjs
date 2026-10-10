import test from 'node:test';
import assert from 'node:assert/strict';
import {createVirtualFileSystem,createShell,undoFileChanges} from '../src/index.js';
const setup=()=>createVirtualFileSystem([{path:'/index.js',data:'old'},{path:'/other',data:'other'}]);
test('undo restores modifications, deleted files, binary data and empty directories; keeps unrelated edits',()=>{
 const fs=setup();fs.writeBinary('/bin',new Uint8Array([1,2]));fs.mkdir('/empty');const before=fs.checkpoint();
 fs.writeText('/index.js','AI');fs.delete('/bin');fs.remove('/empty');fs.writeText('/new/a','created');fs.mkdir('/new/empty');const after=fs.checkpoint();
 fs.writeText('/other','human');fs.writeText('/unrelated','human');const other=fs.getRevision('/other');let notifications=0;fs.onDidChange(()=>notifications++);
 const preview=undoFileChanges(fs,before,after,{dryRun:true});assert.equal(preview.conflicts.length,0);assert.equal(preview.applied,false);assert.equal(fs.get('/index.js').data,'AI');assert.equal(notifications,0);
 const result=undoFileChanges(fs,before,after);assert.equal(result.applied,true);assert.equal(notifications,1);assert.equal(fs.get('/index.js').data,'old');assert.deepEqual(fs.get('/bin').data,new Uint8Array([1,2]));assert.equal(fs.stat('/empty').type,'directory');assert.equal(fs.has('/new/a'),false);assert(!fs.listDirectories().includes('/new'));assert.equal(fs.get('/other').data,'human');assert.equal(fs.getRevision('/other'),other);assert.equal(fs.get('/unrelated').data,'human');
 assert(undoFileChanges(fs,before,after).conflicts.length>0);
});
test('a single later edit refuses all undo operations including edits that return to the original content',()=>{
 for(const mutate of [fs=>fs.writeText('/index.js','human'),fs=>{fs.writeText('/index.js','human');fs.writeText('/index.js','AI');},fs=>{fs.delete('/index.js');fs.writeText('/index.js','AI');}]){
 const fs=setup(),before=fs.checkpoint();fs.writeText('/index.js','AI');fs.writeText('/other','AI other');const after=fs.checkpoint();mutate(fs);const current=fs.snapshot(),revision=fs.getRevision('/other');
 const result=undoFileChanges(fs,before,after);assert.equal(result.applied,false);assert.equal(result.conflicts[0].path,'/index.js');assert.deepEqual(fs.snapshot(),current);assert.equal(fs.getRevision('/other'),revision);
 }
});
test('deleted paths retain revision preconditions and new human children prevent removing an AI directory',()=>{
 const fs=setup(),before=fs.checkpoint();fs.delete('/index.js');fs.mkdir('/AI');const after=fs.checkpoint();fs.writeText('/index.js','human');fs.delete('/index.js');fs.writeText('/AI/human','keep');const current=fs.snapshot();
 const result=undoFileChanges(fs,before,after);assert.equal(result.totalConflicts,2);assert.deepEqual(fs.snapshot(),current);
});
test('type transitions and filtered undo preserve the remaining AI changes',()=>{
 const fs=setup();fs.writeText('/kind','file');const before=fs.checkpoint();fs.delete('/kind');fs.mkdir('/kind');fs.writeBinary('/kind/data',new Uint8Array([3]));fs.writeText('/index.js','AI');const after=fs.checkpoint();
 assert.equal(undoFileChanges(fs,before,after,{path:'/kind'}).applied,true);assert.equal(fs.get('/kind').data,'file');assert.equal(fs.get('/index.js').data,'AI');
});
test('authorization, abort, foreign checkpoints, and parent conflicts do not perform partial writes',()=>{
 const fs=setup(),before=fs.checkpoint();fs.writeText('/index.js','AI');fs.writeText('/new/a','AI');const after=fs.checkpoint(),current=fs.snapshot();
 assert.throws(()=>undoFileChanges(fs,before,after,{authorize(){throw Error('denied');}}),/denied/);assert.deepEqual(fs.snapshot(),current);
 assert.throws(()=>undoFileChanges(fs,before,after,{assertActive(){throw Error('aborted');}}),/aborted/);assert.deepEqual(fs.snapshot(),current);
 assert.throws(()=>undoFileChanges(createVirtualFileSystem(),before,after),/different filesystem/);
 const calls=[];assert.throws(()=>undoFileChanges(fs,before,after,{authorize(op,paths){calls.push([op,paths]);if(op==='rm'&&paths[0]==='/new/a')throw Error('protected');}}),/protected/);assert.deepEqual(fs.snapshot(),current);assert(calls.some(([op])=>op==='rm'));
 const blocked=undoFileChanges(fs,before,after,{authorize(op){if(op==='undo')fs.writeText('/index.js','human');}});assert.equal(blocked.applied,false);assert.equal(fs.get('/index.js').data,'human');assert.equal(fs.get('/new/a').data,'AI');
 const second=setup();second.writeText('/dir/file','old');const b=second.checkpoint();second.remove('/dir',{recursive:true});const a=second.checkpoint();second.writeText('/dir','human');const snapshot=second.snapshot();assert.equal(undoFileChanges(second,b,a).applied,false);assert.deepEqual(second.snapshot(),snapshot);
});
test('shell requires two named checkpoints; dry-run, JSON, filtered undo and cleared history work',async()=>{
 const fs=setup(),shell=createShell({fs});await shell.execute('snapshot before');await shell.execute('write /index.js AI');await shell.execute('snapshot after');
 const run=cmd=>shell.execute(cmd);assert.equal((await run('undo before')).code,1);
 const preview=await run('undo --dry-run --json before after');assert.equal(preview.code,0);assert.equal(JSON.parse(preview.stdout).applied,false);
 await run('write /other human');const applied=await run('undo --json before after /index.js');assert.equal(applied.code,0,applied.stderr);assert.equal(JSON.parse(applied.stdout).applied,true);assert.equal(fs.get('/index.js').data,'old');assert.equal(fs.get('/other').data,'human');
 const conflict=await run('undo --json before after');assert.equal(conflict.code,1);assert(JSON.parse(conflict.stdout).totalConflicts>0);
 shell.clearSnapshots();assert.equal((await run('undo before after')).code,1);
});
test('unchanged checkpoints are a no-op; large reports are bounded',()=>{
 const fs=setup(),before=fs.checkpoint();let events=0;fs.onDidChange(()=>events++);assert.equal(undoFileChanges(fs,before,before).applied,false);assert.equal(events,0);
 for(let i=0;i<150;i++)fs.writeText('/'+i,'AI');const after=fs.checkpoint();const report=undoFileChanges(fs,before,after);assert.equal(report.total,150);assert.equal(report.changes.length,100);assert(report.truncated);assert.equal(fs.has('/149'),false);
});
test('undo merges unrelated changes made by authorization callbacks',()=>{
 const fs=setup(),before=fs.checkpoint();fs.writeText('/index.js','AI');const after=fs.checkpoint();
 const result=undoFileChanges(fs,before,after,{authorize(op){if(op==='undo')fs.writeText('/other','human during authorization');}});
 assert.equal(result.applied,true);assert.equal(fs.get('/index.js').data,'old');assert.equal(fs.get('/other').data,'human during authorization');
});
