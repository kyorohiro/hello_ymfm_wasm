import test from 'node:test';
import assert from 'node:assert/strict';
import {createVirtualFileSystem,createShell,applyTextPatch,transferVirtualFiles} from '../src/index.js';

test('revisions retain deletion history and detect changes even when content returns to its original value',()=>{
 const fs=createVirtualFileSystem([{path:'/a',data:'original'},{path:'/b',data:'other'}]);
 const a=fs.get('/a').revision,b=fs.getRevision('/b');assert(a>0);assert.equal(fs.stat('/a').revision,a);
 fs.writeText('/a','original');assert.equal(fs.getRevision('/a'),a);
 fs.writeText('/a','human');fs.writeText('/a','original');assert(fs.getRevision('/a')>a);assert.equal(fs.getRevision('/b'),b);
 const last=fs.getRevision('/a');fs.delete('/a');const deleted=fs.getRevision('/a');assert(deleted>last);
 assert.throws(()=>fs.writeText('/a','bad',{expectedRevision:last}),/Revision conflict/);
 fs.writeText('/a','recreated',{expectedRevision:deleted});assert(fs.getRevision('/a')>deleted);
 assert.equal(fs.getRevision('/never'),0);fs.writeText('/never','new',{expectedRevision:0});
 assert.throws(()=>fs.writeText('/never','bad',{expectedRevision:NaN}),/Invalid/);
});
test('replace, restore, binary and directory mutations update only changed paths; failed writes leave revisions intact',()=>{
 const fs=createVirtualFileSystem([{path:'/a',data:'a'},{path:'/b',data:new Uint8Array([1])}]);const snapshot=fs.snapshot(),a=fs.getRevision('/a'),b=fs.getRevision('/b');
 fs.replace(fs.list(),fs.listDirectories());assert.equal(fs.getRevision('/a'),a);assert.equal(fs.getRevision('/b'),b);
 fs.writeBinary('/b',new Uint8Array([2]),{expectedRevision:b});assert(fs.getRevision('/b')>b);assert.equal(fs.getRevision('/a'),a);
 const changed=fs.getRevision('/b');fs.restore(snapshot);assert(fs.getRevision('/b')>changed);assert.equal(fs.getRevision('/a'),a);
 assert.throws(()=>fs.replace([{path:'/a',data:'x'},{path:'/a/child',data:'bad'}]));assert.equal(fs.getRevision('/a'),a);
 transferVirtualFiles(fs,'/a','/c');assert(fs.getRevision('/a')>a);assert(fs.get('/c').revision>0);
 fs.mkdir('/empty');const dir=fs.stat('/empty').revision;fs.remove('/empty');fs.mkdir('/empty');assert(fs.stat('/empty').revision>dir);
 // Snapshots are content, not a means to reset live revision counters.
 assert.equal('revision' in snapshot.files[0],false);
});
test('read and find expose revisions; edit rejects stale revisions even if the original matching text remains',async()=>{
 const fs=createVirtualFileSystem([{path:'/a',data:'old\n'}]),shell=createShell({fs});
 const read=JSON.parse((await shell.execute('read --json /a')).stdout);assert.equal(read.revision,fs.getRevision('/a'));
 const find=JSON.parse((await shell.execute('find --json -type f')).stdout);assert.equal(find.entries[0].revision,read.revision);
 fs.writeText('/a','old\nhuman\n');const before=fs.snapshot();
 for(const flags of [[],['--dry-run']]){const result=await shell.execute(['edit','--json',...flags,'--revision',String(read.revision),'/a','old','new']);assert.equal(result.code,1);assert.match(result.stderr,/Revision conflict/);assert.deepEqual(fs.snapshot(),before);}
 const revision=fs.getRevision('/a'),result=await shell.execute(['edit','--json','--revision',String(revision),'/a','old','new']);assert.equal(result.code,0,result.stderr);const report=JSON.parse(result.stdout);assert.equal(report.beforeRevision,revision);assert(report.revision>revision);assert.equal(fs.get('/a').data,'new\nhuman\n');
 assert.equal(JSON.parse((await shell.execute('read --json -',{stdin:'input'})).stdout).revision,null);
});
test('patch revision preconditions are atomic for replace, create and delete and use the original revision for repeated edits',()=>{
 const fs=createVirtualFileSystem([{path:'/a',data:'a'},{path:'/b',data:'b'}]);const a=fs.getRevision('/a'),b=fs.getRevision('/b');fs.writeText('/b','b human');const before=fs.snapshot();
 const edits=[{path:'/a',oldText:'a',newText:'A',expectedRevision:a},{path:'/b',oldText:'b',newText:'B',expectedRevision:b}];
 assert.throws(()=>applyTextPatch(fs,edits),/Revision conflict/);assert.deepEqual(fs.snapshot(),before);assert.equal(fs.getRevision('/a'),a);
 const result=applyTextPatch(fs,[{path:'/a',oldText:'a',newText:'A',expectedRevision:a},{path:'/a',oldText:'A',newText:'AA',expectedRevision:a}]);assert.equal(result.changes[0].beforeRevision,a);assert.equal(result.changes[0].revision,result.changes[1].revision);assert.equal(fs.get('/a').data,'AA');
 fs.writeText('/new','previous');fs.delete('/new');assert.throws(()=>applyTextPatch(fs,[{type:'create',path:'/new',text:'new',expectedRevision:0}]),/Revision conflict/);
 applyTextPatch(fs,[{type:'create',path:'/new',text:'new',expectedRevision:fs.getRevision('/new')}]);
 const revision=fs.getRevision('/new');const removed=applyTextPatch(fs,[{type:'delete',path:'/new',expectedText:'new',expectedRevision:revision}]);assert(removed.changes[0].revision>revision);
});
test('authorization-time changes and pipeline ABA changes are retained',async()=>{
 const fs=createVirtualFileSystem([{path:'/a',data:'a'}]);const shell=createShell({fs,authorize(){fs.writeText('/a','human');}});
 const result=await shell.execute(['edit','/a','a','bad']);assert.equal(result.code,1);assert.equal(fs.get('/a').data,'human');
 assert.throws(()=>applyTextPatch(fs,[{path:'/a',oldText:'human',newText:'bad'}],{authorize(){fs.writeText('/a','later');}}),/Revision conflict/);assert.equal(fs.get('/a').data,'later');
 const plain=createShell({fs});plain.register('aba',()=>{fs.writeText('/a','temporary');fs.writeText('/a','later');return 'bad';});
 const failed=await plain.execute('aba > /a');assert.equal(failed.code,1);assert.match(failed.stderr,/Redirect conflict/);assert.equal(fs.get('/a').data,'later');
});
